import { io } from "socket.io-client";

const SOCKET_BASE_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");
const HEARTBEAT_INTERVAL_MS = Number(import.meta.env.VITE_SOCKET_HEARTBEAT_MS) || 25000;
const HEARTBEAT_EVENT =
  import.meta.env.VITE_SOCKET_HEARTBEAT_EVENT ||
  import.meta.env.SOCKET_HEARTBEAT_EVENT ||
  "heartbeat";

const globalScope =
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : global;

const sharedState =
  globalScope.__incampusSocketState ||
  (globalScope.__incampusSocketState = {
    socket: null,
    roomSubscriptions: new Set(),
    listenersBound: false,
    heartbeatId: null,
    heartbeatBound: false,
    userId: null,
  });

const getSharedSocket = () => sharedState.socket;
const setSharedSocket = (next) => {
  sharedState.socket = next;
};
const getRoomSubscriptions = () => sharedState.roomSubscriptions;
const isListenersBound = () => sharedState.listenersBound;
const setListenersBound = (value) => {
  sharedState.listenersBound = value;
};
const isHeartbeatBound = () => sharedState.heartbeatBound;
const setHeartbeatBound = (value) => {
  sharedState.heartbeatBound = value;
};
const getUserId = () => sharedState.userId;
const setUserId = (value) => {
  sharedState.userId = value ? String(value) : null;
};

const shouldLog = () => {
  try {
    return localStorage.getItem("socketDebug") === "1";
  } catch {
    return false;
  }
};

const log = (...args) => {
  if (shouldLog()) {
    console.debug("[socket]", ...args);
  }
};

const getAuthToken = () => {
  try {
    return localStorage.getItem("authToken");
  } catch {
    return null;
  }
};

const startHeartbeat = (socket) => {
  if (!socket || HEARTBEAT_INTERVAL_MS <= 0) return;
  if (sharedState.heartbeatId) return;
  sharedState.heartbeatId = setInterval(() => {
    if (socket.connected) {
      socket.emit(HEARTBEAT_EVENT);
    }
  }, HEARTBEAT_INTERVAL_MS);
};

const stopHeartbeat = () => {
  if (!sharedState.heartbeatId) return;
  clearInterval(sharedState.heartbeatId);
  sharedState.heartbeatId = null;
};

const bindHeartbeat = (socket) => {
  if (!socket || isHeartbeatBound()) return;
  setHeartbeatBound(true);
  socket.on("connect", () => startHeartbeat(socket));
  socket.on("disconnect", () => stopHeartbeat());
  if (socket.connected) {
    startHeartbeat(socket);
  }
};

const emitRegister = (socket) => {
  if (!socket) return;
  const userId = getUserId();
  if (!userId) return;
  socket.emit("register", userId);
  socket.emit("register-user", { userId });
};

const emitPresence = (socket, status) => {
  if (!socket) return;
  const userId = getUserId();
  if (!userId) return;
  const payload = { userId, lastSeen: new Date().toISOString() };
  if (status === "offline") {
    socket.emit("user-offline", payload);
    socket.emit("user_offline", payload);
    return;
  }
  socket.emit("user-online", payload);
  socket.emit("user_online", payload);
};

export const initSocket = (userId, rooms = []) => {
  if (userId) {
    setUserId(userId);
    getRoomSubscriptions().add(String(userId));
  }
  if (Array.isArray(rooms)) {
    rooms.forEach((room) => {
      if (room) getRoomSubscriptions().add(room);
    });
  }

  const existingSocket = getSharedSocket();
  if (existingSocket) {
    existingSocket.auth = { token: getAuthToken() };
    if (existingSocket.connected) {
      getRoomSubscriptions().forEach((room) => {
        if (room.startsWith("group:")) {
          existingSocket.emit("join", { groupId: room });
        } else {
          existingSocket.emit("join", { chatId: room, userId: room });
        }
      });
      emitRegister(existingSocket);
      emitPresence(existingSocket, "online");
    } else {
      existingSocket.connect();
    }
    bindConnectionGuards();
    bindHeartbeat(existingSocket);
    return existingSocket;
  }

  const socket = io(SOCKET_BASE_URL, {
    autoConnect: false,
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    withCredentials: true,
  });
  socket.auth = { token: getAuthToken() };
  setSharedSocket(socket);

  socket.on("connect", () => {
    log("connected", socket.id);
    log("transport", socket.io.engine?.transport?.name);
    getRoomSubscriptions().forEach((room) => {
      if (room.startsWith("group:")) {
        socket.emit("join", { groupId: room });
      } else {
        socket.emit("join", { chatId: room, userId: room });
      }
    });
    emitRegister(socket);
    emitPresence(socket, "online");
  });

  socket.on("disconnect", (reason) => {
    log("disconnected", reason);
  });

  socket.on("connect_error", () => {
    // Refresh auth token for next reconnect attempt.
    socket.auth = { token: getAuthToken() };
    log("connect_error");
  });

  socket.io.on("reconnect_attempt", (attempt) => {
    log("reconnect_attempt", attempt);
  });
  socket.io.on("reconnect", (attempt) => {
    log("reconnect", attempt);
  });
  socket.io.on("reconnect_failed", () => {
    log("reconnect_failed");
  });

  socket.connect();
  bindConnectionGuards();
  bindHeartbeat(socket);
  return socket;
};

export const getSocket = () => {
  return getSharedSocket();
};

export const disconnectSocket = () => {
  const current = getSharedSocket();
  if (current) {
    emitPresence(current, "offline");
    current.disconnect();
    setSharedSocket(null);
  }
  getRoomSubscriptions().clear();
  stopHeartbeat();
  setHeartbeatBound(false);
};

export const joinSocket = (room) => {
  if (!room) return;
  getRoomSubscriptions().add(room);
  const current = getSharedSocket();
  if (current && current.connected) {
    if (room.startsWith("group:")) {
      current.emit("join", { groupId: room });
    } else {
      current.emit("join", { chatId: room, userId: room });
    }
  }
};

export const leaveSocket = (room) => {
  if (!room) return;
  getRoomSubscriptions().delete(room);
  const current = getSharedSocket();
  if (current && current.connected) {
    if (room.startsWith("group:")) {
      current.emit("leave", { groupId: room });
    } else {
      current.emit("leave", { chatId: room, userId: room });
    }
  }
};

export const ensureSocketConnected = () => {
  const current = getSharedSocket();
  if (!current) return false;
  if (!current.connected) {
    current.auth = { token: getAuthToken() };
    current.connect();
    log("reconnect_manual");
  }
  return current.connected;
};

const bindConnectionGuards = () => {
  if (isListenersBound() || typeof window === "undefined") return;
  setListenersBound(true);

  const tryReconnect = () => {
    const current = getSharedSocket();
    if (!current) return;
    if (!current.connected) {
      current.auth = { token: getAuthToken() };
      current.connect();
      log("reconnect_attempt");
    }
  };

  window.addEventListener("focus", tryReconnect);
  window.addEventListener("online", tryReconnect);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      tryReconnect();
    }
  });
};

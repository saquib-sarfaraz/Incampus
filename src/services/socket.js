import { io } from "socket.io-client";

const normalizeBaseUrl = (base) => {
  if (!base) return "";
  return String(base).endsWith("/") ? String(base).slice(0, -1) : String(base);
};

const resolveSocketBaseUrl = () => {
  const raw = import.meta.env.VITE_SOCKET_URL || "";
  const base = normalizeBaseUrl(raw);

  if (typeof window === "undefined") return base;
  if (!base) return window.location.origin;

  // In dev, if env points to localhost, prefer same-origin and rely on Vite's
  // websocket proxy (`/socket.io`) to avoid CORS headaches.
  if (
    import.meta.env.DEV &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)
  ) {
    return window.location.origin;
  }

  return base;
};

const SOCKET_BASE_URL = resolveSocketBaseUrl();
const HEARTBEAT_INTERVAL_MS = Number(import.meta.env.VITE_SOCKET_HEARTBEAT_MS) || 25000;
const HEARTBEAT_EVENT =
  import.meta.env.VITE_SOCKET_HEARTBEAT_EVENT ||
  import.meta.env.SOCKET_HEARTBEAT_EVENT ||
  "heartbeat";

const globalScope =
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : {};

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
  socket.emit("user:register", { userId });
};

export const initSocket = (userId, rooms = []) => {
  if (userId) {
    setUserId(userId);
    if (typeof window !== "undefined") {
      window.__currentUserId = String(userId);
    }
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
    } else {
      existingSocket.connect();
    }
    bindConnectionGuards();
    bindHeartbeat(existingSocket);
    return existingSocket;
  }

  const socket = io(SOCKET_BASE_URL, {
    autoConnect: false,
    transports: ["websocket", "polling"],
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
    if (typeof window !== "undefined" && window.__activeChatRoom) {
      socket.emit("chat:joinRoom", { roomId: window.__activeChatRoom });
    }
    getRoomSubscriptions().forEach((room) => {
      if (room.startsWith("group:")) {
        socket.emit("join", { groupId: room });
      } else {
        socket.emit("join", { chatId: room, userId: room });
      }
    });
    emitRegister(socket);
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

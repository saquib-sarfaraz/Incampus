import { io } from "socket.io-client";

const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

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

const shouldLog = () => {
  try {
    return localStorage.getItem("socketDebug") === "1";
  } catch {
    return false;
  }
};

const log = (...args) => {
  if (shouldLog()) {
    console.log("[socket]", ...args);
  }
};

const getAuthToken = () => {
  try {
    return localStorage.getItem("authToken");
  } catch {
    return null;
  }
};

export const initSocket = (userId, rooms = []) => {
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
          existingSocket.emit("join", { chatId: room });
        }
      });
    } else {
      existingSocket.connect();
    }
    bindConnectionGuards();
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
  });
  socket.auth = { token: getAuthToken() };
  setSharedSocket(socket);

  socket.on("connect", () => {
    log("connected", socket.id);
    getRoomSubscriptions().forEach((room) => {
      if (room.startsWith("group:")) {
        socket.emit("join", { groupId: room });
      } else {
        socket.emit("join", { chatId: room });
      }
    });
  });

  socket.on("disconnect", (reason) => {
    log("disconnected", reason);
  });

  socket.on("connect_error", () => {
    // Refresh auth token for next reconnect attempt.
    socket.auth = { token: getAuthToken() };
    log("connect_error");
  });

  socket.connect();
  bindConnectionGuards();
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
};

export const joinSocket = (room) => {
  if (!room) return;
  getRoomSubscriptions().add(room);
  const current = getSharedSocket();
  if (current && current.connected) {
    if (room.startsWith("group:")) {
      current.emit("join", { groupId: room });
    } else {
      current.emit("join", { chatId: room });
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
      current.emit("leave", { chatId: room });
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

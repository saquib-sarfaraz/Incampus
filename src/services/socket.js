import { io } from "socket.io-client";

const SOCKET_BASE_URL =
  import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

let socket = null;
const roomSubscriptions = new Set();
let listenersBound = false;

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
      if (room) roomSubscriptions.add(room);
    });
  }

  if (socket) {
    socket.auth = { token: getAuthToken() };
    if (socket.connected) {
      roomSubscriptions.forEach((room) => {
        if (room.startsWith("group:")) {
          socket.emit("join", { groupId: room });
        } else {
          socket.emit("join", { chatId: room });
        }
      });
    } else {
      socket.connect();
    }
    bindConnectionGuards();
    return socket;
  }

  socket = io(SOCKET_BASE_URL, {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });
  socket.auth = { token: getAuthToken() };

  socket.on("connect", () => {
    log("connected", socket.id);
    roomSubscriptions.forEach((room) => {
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
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  roomSubscriptions.clear();
};

export const joinSocket = (room) => {
  if (!room) return;
  roomSubscriptions.add(room);
  if (socket && socket.connected) {
    if (room.startsWith("group:")) {
      socket.emit("join", { groupId: room });
    } else {
      socket.emit("join", { chatId: room });
    }
  }
};

export const leaveSocket = (room) => {
  if (!room) return;
  roomSubscriptions.delete(room);
  if (socket && socket.connected) {
    if (room.startsWith("group:")) {
      socket.emit("leave", { groupId: room });
    } else {
      socket.emit("leave", { chatId: room });
    }
  }
};

export const ensureSocketConnected = () => {
  if (!socket) return false;
  if (!socket.connected) {
    socket.auth = { token: getAuthToken() };
    socket.connect();
    log("reconnect_manual");
  }
  return socket.connected;
};

const bindConnectionGuards = () => {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;

  const tryReconnect = () => {
    if (!socket) return;
    if (!socket.connected) {
      socket.auth = { token: getAuthToken() };
      socket.connect();
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

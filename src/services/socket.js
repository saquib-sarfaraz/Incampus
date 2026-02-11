import { io } from "socket.io-client";

const SOCKET_BASE_URL =
  import.meta.env.VITE_SOCKET_URL || "http://localhost:8000";

let socket = null;
let isConnected = false;

const getAuthToken = () => {
  try {
    return localStorage.getItem("authToken");
  } catch {
    return null;
  }
};

export const initSocket = (userId, rooms = []) => {
  if (socket && isConnected) {
    return socket;
  }

  socket = io(SOCKET_BASE_URL, {
    autoConnect: false,
  });

  socket.auth = { token: getAuthToken() };

  socket.on("connect", () => {
    isConnected = true;
    if (userId) {
      socket.emit("join", userId);
    }
    if (Array.isArray(rooms)) {
      rooms.forEach((room) => {
        if (room) socket.emit("join", room);
      });
    }
  });

  socket.on("disconnect", () => {
    isConnected = false;
  });

  socket.on("connect_error", () => {
    // Refresh auth token for next reconnect attempt.
    socket.auth = { token: getAuthToken() };
  });

  socket.connect();
  return socket;
};

export const getSocket = () => {
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
    isConnected = false;
  }
};

export const joinSocket = (room) => {
  if (socket && isConnected && room) {
    socket.emit("join", room);
  }
};

export const leaveSocket = (room) => {
  if (socket && isConnected && room) {
    socket.emit("leave", room);
  }
};

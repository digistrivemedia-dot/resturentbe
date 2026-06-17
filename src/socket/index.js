const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Restaurant = require("../models/Restaurant");

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      credentials: true,
    },
  });

  // Authenticate socket and join restaurant room
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next();

    try {
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const restaurant = await Restaurant.findOne({
        $or: [{ owner: decoded.userId }, { managers: decoded.userId }],
      }).select("_id");

      if (restaurant) {
        socket.restaurantId = restaurant._id.toString();
      }
    } catch (e) {
      // Auth failure — allow connection anyway but without restaurant room
    }
    next();
  });

  io.on("connection", (socket) => {
    if (socket.restaurantId) {
      socket.join(`restaurant:${socket.restaurantId}`);
    }

    socket.on("disconnect", () => {});
  });

  return io;
};

// Safe getter — returns null if socket not yet initialized
const getIo = () => io || null;

module.exports = { initSocket, getIo };

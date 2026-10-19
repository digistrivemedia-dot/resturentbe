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

  // Authenticate socket — identify both restaurant staff and customers
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next();

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id;
      socket.userId = userId;

      const restaurant = await Restaurant.findOne({
        $or: [{ owner: userId }, { managers: userId }, { staff: userId }],
      }).select("_id");

      if (restaurant) {
        socket.restaurantId = restaurant._id.toString();
      }
    } catch (e) {
      // Auth failure — allow connection anyway but without rooms
    }
    next();
  });

  io.on("connection", (socket) => {
    if (socket.restaurantId) {
      socket.join(`restaurant:${socket.restaurantId}`);
    }
    if (socket.userId) {
      socket.join(`customer:${socket.userId}`);
      // Role-neutral per-user room. `customer:<id>` happens to work for any
      // user, but emitting a waiter's "food ready" alert to a room called
      // "customer:" is the kind of thing nobody can decode at 3am.
      socket.join(`user:${socket.userId}`);
    }

    socket.on("disconnect", () => {});
  });

  return io;
};

// Safe getter — returns null if socket not yet initialized
const getIo = () => io || null;

module.exports = { initSocket, getIo };

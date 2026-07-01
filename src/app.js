const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const errorMiddleware = require("./middlewares/error.middleware");
const ApiResponse = require("./utils/ApiResponse");

const app = express();

// Rate limiter — per IP, generous enough for dashboard polling + normal usage
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, try again later" },
  skip: (req) => req.path === "/health" || req.path.startsWith("/socket.io"),
});

// Middlewares — CORS must come before helmet
const allowedOrigins = [
  process.env.CLIENT_URL || "http://localhost:3000",
  /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/, // local network (mobile dev)
  /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,  // local network alt range
  /^exp:\/\//,                              // Expo Go deep links
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (React Native, Postman, server-to-server)
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.some((o) =>
      typeof o === "string" ? o === origin : o.test(origin)
    );
    if (allowed) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(limiter);

// Serve uploaded images as static files (development only)
// In production, Nginx serves /var/www/uploads/ directly at /uploads/
if (process.env.NODE_ENV !== "production") {
  const path = require("path");
  // Must set Cross-Origin-Resource-Policy: cross-origin so browsers allow
  // <img> tags on localhost:3000 (Next.js) to load images from localhost:8000 (Express).
  // Helmet sets same-origin by default which silently blocks cross-port image loads.
  app.use(
    "/uploads",
    (req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(path.join(__dirname, "../../uploads"))
  );
}

// Health check
app.get("/api/v1/health", (req, res) => {
  ApiResponse.send(res, 200, "Server is running", {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Routes
const authRoutes = require("./routes/auth.routes");
const customerRoutes = require("./routes/customer.routes");
const publicRoutes = require("./routes/public.routes");
const orderRoutes = require("./routes/order.routes");
const couponRoutes = require("./routes/coupon.routes");
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/customer", customerRoutes);
app.use("/api/v1", publicRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/coupons", couponRoutes);
const restaurantRoutes = require("./routes/restaurant.routes");
app.use("/api/v1/restaurant", restaurantRoutes);
const adminRoutes = require("./routes/admin.routes");
app.use("/api/v1/admin", adminRoutes);
const uploadRoutes = require("./routes/upload.routes");
app.use("/api/v1/upload", uploadRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    error: "NOT_FOUND",
  });
});

// Global error handler
app.use(errorMiddleware);

module.exports = app;

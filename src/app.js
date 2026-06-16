const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const errorMiddleware = require("./middlewares/error.middleware");
const ApiResponse = require("./utils/ApiResponse");

const app = express();

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: "Too many requests, try again later" },
});

// Middlewares — CORS must come before helmet
const corsOptions = {
  origin: process.env.CLIENT_URL || "http://localhost:3000",
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

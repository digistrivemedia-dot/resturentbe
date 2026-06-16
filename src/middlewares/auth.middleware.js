const jwt = require("jsonwebtoken");
const ApiError = require("../utils/ApiError");
const User = require("../models/User");

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new ApiError(401, "Access denied. No token provided", "AUTH_ERROR");
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      throw new ApiError(401, "User not found", "AUTH_ERROR");
    }

    if (user.status === "blocked") {
      throw new ApiError(403, "Your account has been blocked", "ACCOUNT_BLOCKED");
    }

    if (user.status === "deleted") {
      throw new ApiError(401, "Account no longer exists", "ACCOUNT_DELETED");
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }
    next(new ApiError(401, "Invalid or expired token", "AUTH_ERROR"));
  }
};

module.exports = auth;

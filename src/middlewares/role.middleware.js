const ApiError = require("../utils/ApiError");

const role = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required", "AUTH_ERROR"));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, "You don't have permission to access this resource", "FORBIDDEN"));
    }

    next();
  };
};

module.exports = role;

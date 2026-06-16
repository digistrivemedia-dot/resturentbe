const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const validate = require("../middlewares/validate.middleware");
const auth = require("../middlewares/auth.middleware");
const {
  registerValidator,
  loginValidator,
  sendOtpValidator,
  verifyOtpValidator,
  googleLoginValidator,
  updateProfileValidator,
} = require("../validators/auth.validator");

// Public routes
router.post("/register", ...registerValidator, validate, authController.register);
router.post("/login", ...loginValidator, validate, authController.login);
router.post("/send-otp", ...sendOtpValidator, validate, authController.sendOtp);
router.post("/verify-otp", ...verifyOtpValidator, validate, authController.verifyOtp);
router.post("/google", ...googleLoginValidator, validate, authController.googleLogin);
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logout);

// Protected routes
router.get("/me", auth, authController.getMe);

module.exports = router;

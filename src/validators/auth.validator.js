const { body } = require("express-validator");

const registerValidator = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").trim().isEmail().withMessage("Valid email is required"),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("role")
    .optional()
    .isIn(["restaurant_owner", "super_admin"])
    .withMessage("Invalid role"),
];

const loginValidator = [
  body("email").trim().isEmail().withMessage("Valid email is required"),
  body("password").notEmpty().withMessage("Password is required"),
];

const sendOtpValidator = [
  body("email").trim().isEmail().withMessage("Valid email is required"),
];

const verifyOtpValidator = [
  body("email").trim().isEmail().withMessage("Valid email is required"),
  body("otp")
    .trim()
    .isLength({ min: 6, max: 6 })
    .withMessage("OTP must be 6 digits"),
];

const googleLoginValidator = [
  body("idToken").notEmpty().withMessage("Google ID token is required"),
];

const updateProfileValidator = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage("Name must be at least 2 characters"),
  body("email")
    .optional()
    .trim()
    .isEmail()
    .withMessage("Valid email is required"),
  body("phone")
    .optional()
    .trim()
    .matches(/^\d{10}$/)
    .withMessage("Phone must be 10 digits"),
];

module.exports = {
  registerValidator,
  loginValidator,
  sendOtpValidator,
  verifyOtpValidator,
  googleLoginValidator,
  updateProfileValidator,
};

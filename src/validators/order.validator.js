const { body } = require("express-validator");

const placeOrderValidator = [
  body("restaurantId")
    .notEmpty()
    .withMessage("Restaurant is required")
    .isMongoId()
    .withMessage("Invalid restaurant ID"),
  body("items")
    .isArray({ min: 1 })
    .withMessage("At least one item is required"),
  body("items.*.menuItemId")
    .notEmpty()
    .withMessage("Menu item ID is required"),
  body("items.*.quantity")
    .isInt({ min: 1 })
    .withMessage("Quantity must be at least 1"),
  body("deliveryAddress.fullAddress")
    .notEmpty()
    .withMessage("Delivery address is required"),
  body("paymentMethod")
    .optional()
    .isIn(["online", "cod", "wallet"])
    .withMessage("Invalid payment method"),
];

const cancelOrderValidator = [
  body("reason")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Reason must be under 500 characters"),
];

const rateOrderValidator = [
  body("foodRating")
    .isInt({ min: 1, max: 5 })
    .withMessage("Food rating must be between 1 and 5"),
  body("deliveryRating")
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage("Delivery rating must be between 1 and 5"),
  body("review")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Review must be under 1000 characters"),
];

const validateCouponValidator = [
  body("code").notEmpty().withMessage("Coupon code is required"),
  body("restaurantId")
    .notEmpty()
    .withMessage("Restaurant is required")
    .isMongoId()
    .withMessage("Invalid restaurant ID"),
  body("subtotal")
    .isNumeric()
    .withMessage("Subtotal is required"),
];

const addAddressValidator = [
  body("label")
    .notEmpty()
    .withMessage("Label is required (e.g. Home, Work)")
    .isIn(["home", "work", "other"])
    .withMessage("Label must be home, work, or other"),
  body("fullAddress")
    .notEmpty()
    .withMessage("Full address is required")
    .isLength({ min: 10 })
    .withMessage("Address is too short"),
];

module.exports = {
  placeOrderValidator,
  cancelOrderValidator,
  rateOrderValidator,
  validateCouponValidator,
  addAddressValidator,
};

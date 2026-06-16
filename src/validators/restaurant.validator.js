const { body } = require("express-validator");
const { ORDER_STATUS, COUPON_TYPE } = require("../utils/constants");

const addMenuItemValidator = [
  body("name")
    .notEmpty()
    .withMessage("Item name is required")
    .trim(),
  body("price")
    .notEmpty()
    .withMessage("Price is required")
    .isNumeric()
    .withMessage("Price must be a number"),
  body("category")
    .notEmpty()
    .withMessage("Category is required")
    .trim(),
];

const updateOrderStatusValidator = [
  body("status")
    .notEmpty()
    .withMessage("Status is required")
    .isIn([
      ORDER_STATUS.PREPARING,
      ORDER_STATUS.READY,
      ORDER_STATUS.PICKED_UP,
      ORDER_STATUS.OUT_FOR_DELIVERY,
      ORDER_STATUS.DELIVERED,
    ])
    .withMessage("Invalid status value"),
];

const createCouponValidator = [
  body("code")
    .notEmpty()
    .withMessage("Coupon code is required")
    .trim(),
  body("title")
    .notEmpty()
    .withMessage("Coupon title is required")
    .trim(),
  body("type")
    .notEmpty()
    .withMessage("Coupon type is required")
    .isIn(Object.values(COUPON_TYPE))
    .withMessage("Invalid coupon type"),
  body("value")
    .notEmpty()
    .withMessage("Coupon value is required")
    .isNumeric()
    .withMessage("Value must be a number"),
  body("validUntil")
    .notEmpty()
    .withMessage("Valid until date is required")
    .isISO8601()
    .withMessage("Valid until must be a valid date"),
];

const replyToReviewValidator = [
  body("text")
    .notEmpty()
    .withMessage("Reply text is required")
    .trim(),
];

module.exports = {
  addMenuItemValidator,
  updateOrderStatusValidator,
  createCouponValidator,
  replyToReviewValidator,
};

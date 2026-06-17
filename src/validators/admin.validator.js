const { body } = require("express-validator");

const onboardRestaurantValidator = [
  body("owner.name").notEmpty().withMessage("Owner name is required"),
  body("owner.email").isEmail().withMessage("Valid owner email is required"),
  body("name").notEmpty().withMessage("Restaurant name is required"),
];

const createCouponValidator = [
  body("code").notEmpty().withMessage("Coupon code is required"),
  body("title").notEmpty().withMessage("Coupon title is required"),
  body("type").isIn(["percentage", "flat"]).withMessage("Invalid coupon type"),
  body("value").isNumeric().withMessage("Coupon value is required"),
  body("validUntil").notEmpty().withMessage("Valid until date is required"),
];

const createBannerValidator = [
  body("title").notEmpty().withMessage("Banner title is required"),
  body("image").notEmpty().withMessage("Banner image is required"),
];

const sendNotificationValidator = [
  body("title").notEmpty().withMessage("Notification title is required"),
  body("message").notEmpty().withMessage("Notification message is required"),
  body("target")
    .isIn(["all", "all_customers", "all_restaurants", "specific"])
    .withMessage("Invalid target"),
];

const updateSettingsValidator = [
  body("settings").isObject().withMessage("Settings must be an object"),
];

const processRefundValidator = [
  body("reason").optional().isString(),
  body("amount").optional().isNumeric().withMessage("Amount must be a number"),
];

module.exports = {
  onboardRestaurantValidator,
  createCouponValidator,
  createBannerValidator,
  sendNotificationValidator,
  updateSettingsValidator,
  processRefundValidator,
};

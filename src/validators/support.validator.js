const { body } = require("express-validator");

const createTicketValidator = [
  body("orderId")
    .notEmpty()
    .withMessage("Order is required")
    .isMongoId()
    .withMessage("Invalid order ID"),
  body("category")
    .notEmpty()
    .withMessage("Category is required"),
  body("subCategory")
    .notEmpty()
    .withMessage("Sub-category is required"),
  body("affectedItems")
    .optional()
    .isArray()
    .withMessage("affectedItems must be an array"),
  body("customMessage")
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage("Message is too long"),
];

const addMessageValidator = [
  body("text")
    .notEmpty()
    .withMessage("Message is required")
    .isLength({ max: 1000 })
    .withMessage("Message is too long"),
];

module.exports = { createTicketValidator, addMessageValidator };

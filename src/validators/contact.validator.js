const { body } = require("express-validator");

const createContactMessageValidator = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").trim().isEmail().withMessage("Valid email is required"),
  body("phone").optional({ checkFalsy: true }).isString(),
  body("subject").optional({ checkFalsy: true }).isString(),
  body("message").trim().notEmpty().withMessage("Message is required"),
];

module.exports = { createContactMessageValidator };

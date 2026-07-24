const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const validate = require("../middlewares/validate.middleware");
const {
  placeOrderValidator,
  cancelOrderValidator,
  rateOrderValidator,
  verifyPaymentValidator,
} = require("../validators/order.validator");
const {
  placeOrder,
  verifyPayment,
  getMyOrders,
  getOrderById,
  cancelOrder,
  rateOrder,
} = require("../controllers/order.controller");

// All order routes require auth
router.use(auth);

router.post("/", ...placeOrderValidator, validate, placeOrder);
router.post("/verify-payment", ...verifyPaymentValidator, validate, verifyPayment);
router.get("/", getMyOrders);
router.get("/:id", getOrderById);
router.post("/:id/cancel", ...cancelOrderValidator, validate, cancelOrder);
router.post("/:id/rate", ...rateOrderValidator, validate, rateOrder);

module.exports = router;

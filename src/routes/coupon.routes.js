const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const validate = require("../middlewares/validate.middleware");
const { validateCouponValidator } = require("../validators/order.validator");
const {
  getAvailableCoupons,
  validateCoupon,
} = require("../controllers/coupon.controller");

// All coupon routes require auth
router.use(auth);

router.get("/", getAvailableCoupons);
router.post("/validate", validateCouponValidator, validate, validateCoupon);

module.exports = router;

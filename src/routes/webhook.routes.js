const express = require("express");
const {
  handleFlashWebhook,
  handleRazorpayWebhook,
  handlePetpoojaOrderCallback,
  handlePetpoojaMenuPush,
} = require("../controllers/webhook.controller");

const router = express.Router();

// Public — Flash calls this with no auth token, so no auth middleware
router.post("/flash", handleFlashWebhook);

// Public — Razorpay calls this for payment status updates
router.post("/razorpay", handleRazorpayWebhook);

// Public — Petpooja calls this with order status updates (this is the
// callback_url given in every Save Order request)
router.post("/petpooja/order-callback", handlePetpoojaOrderCallback);

// Public — Petpooja calls this when their catalogue is pushed ("Menu
// Trigger" on their dashboard). Set as the "Menu Sharing Endpoint" (with
// Base URL) on their Configuration page.
router.post("/petpooja/menu-push", handlePetpoojaMenuPush);

module.exports = router;

const express = require("express");
const { handleFlashWebhook, handleRazorpayWebhook } = require("../controllers/webhook.controller");

const router = express.Router();

// Public — Flash calls this with no auth token, so no auth middleware
router.post("/flash", handleFlashWebhook);

// Public — Razorpay calls this for payment status updates
router.post("/razorpay", handleRazorpayWebhook);

module.exports = router;

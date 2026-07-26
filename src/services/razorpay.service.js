const Razorpay = require("razorpay");
const crypto = require("crypto");

let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
} else {
  console.warn("[Razorpay] RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set — payment features disabled");
}

// Create a Razorpay order
async function createRazorpayOrder(amountInRupees, receipt, notes = {}) {
  const order = await razorpay.orders.create({
    amount: Math.round(amountInRupees * 100), // Razorpay expects paise
    currency: "INR",
    receipt: String(receipt),
    notes,
  });
  return order;
}

// Verify payment signature (HMAC SHA256)
function verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, signature) {
  const body = razorpayOrderId + "|" + razorpayPaymentId;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");
  return expectedSignature === signature;
}

// Process refund via Razorpay API
async function createRefund(paymentId, amountInRupees, notes = {}) {
  const refund = await razorpay.payments.refund(paymentId, {
    amount: Math.round(amountInRupees * 100),
    notes,
  });
  return refund;
}

module.exports = { razorpay, createRazorpayOrder, verifyPaymentSignature, createRefund };

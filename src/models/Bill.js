const mongoose = require("mongoose");

// One bill covers every unbilled order a table accumulated during one sitting.
// Creating the Bill is what "closes" the table: the orders get bill set, so
// they stop counting as unbilled and the table reads free again once paid.
const billSchema = new mongoose.Schema(
  {
    billNumber: {
      type: String,
      unique: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    table: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Table",
      required: true,
      index: true,
    },
    // Snapshot of the table's name at billing time — a table renamed from "7"
    // to "Patio 2" later must not rewrite history on a printed bill.
    tableNumber: String,
    orders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
    pricing: {
      subtotal: { type: Number, required: true },
      taxAmount: { type: Number, default: 0 },
      taxPercentage: { type: Number, default: 5 },
      discount: { type: Number, default: 0 },
      discountReason: String,
      total: { type: Number, required: true },
    },
    // "qr"  — Razorpay dynamic QR, confirmed by the qr_code.credited webhook.
    //          Staff can never set this by hand; only the webhook may.
    // "upi" — the fallback UPI-intent QR. Money goes straight to the
    //          restaurant's VPA with nothing to call back, so a waiter
    //          confirms it manually, same as cash.
    paymentMethod: {
      type: String,
      enum: ["qr", "upi", "cash", "card", "other"],
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
    },
    paidAt: Date,
    // Who marked it paid — only set for cash/card, since those are a staff
    // claim rather than a verified payment. QR payments are confirmed by
    // Razorpay's qr_code.credited webhook instead (see webhook.controller.js).
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // The scannable payment QR printed on the bill. Named razorpayQr for
    // continuity, but `provider` says which kind it actually is:
    //   "razorpay" — dynamic QR locked to the amount, self-confirming
    //   "upi"      — plain upi:// intent QR, needs manual confirmation
    razorpayQr: {
      provider: { type: String, enum: ["razorpay", "upi"] },
      qrId: String,       // razorpay only
      imageUrl: String,   // hosted URL (razorpay) or data: URI (upi)
      upiUrl: String,     // upi only — the raw upi://pay link the QR encodes
      upiId: String,      // upi only — the VPA money went to, kept for reconciliation
      paymentId: String,
      amountPaid: Number,
      createdAt: Date,
      failedReason: String, // set when no QR could be made, so the UI can explain why
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    printedAt: Date,
  },
  { timestamps: true }
);

// Auto-generate bill number: BILL-YYYYMMDD-XXX. Mirrors Order.orderNumber's
// scheme (see Order.js) so staff reading both recognize the format.
billSchema.pre("save", async function () {
  if (this.isNew && !this.billNumber) {
    const today = new Date();
    const dateStr =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    const prefix = `BILL-${dateStr}-`;
    const last = await mongoose
      .model("Bill")
      .findOne({ billNumber: { $regex: `^${prefix}` } })
      .sort({ billNumber: -1 })
      .lean();

    const seq = last ? parseInt(last.billNumber.split("-").pop(), 10) + 1 : 1;
    this.billNumber = `${prefix}${String(seq).padStart(3, "0")}`;
  }
});

billSchema.index({ restaurant: 1, createdAt: -1 });
billSchema.index({ "razorpayQr.qrId": 1 });

module.exports = mongoose.model("Bill", billSchema);

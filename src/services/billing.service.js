const QRCode = require("qrcode");
const { razorpay } = require("./razorpay.service");
const { BRAND_NAME } = require("../utils/constants");

// Dine-in bills are deliberately simpler than delivery orders: no delivery
// fee, no platform fee, no tip, no coupons. Just the food plus GST, with an
// optional manual discount the owner/waiter can apply at the table.
function computeBillTotals(orders, gstPercentage, discount = 0) {
  const subtotal = orders.reduce((sum, o) => sum + (o.pricing?.subtotal || 0), 0);

  // Discount applies before tax, and can never exceed the subtotal — a
  // ₹500 discount on a ₹300 tab must not produce a negative bill.
  const appliedDiscount = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const taxable = subtotal - appliedDiscount;

  const taxPercentage = Number.isFinite(gstPercentage) ? gstPercentage : 5;
  const taxAmount = round2(taxable * (taxPercentage / 100));
  const total = round2(taxable + taxAmount);

  return {
    subtotal: round2(subtotal),
    discount: appliedDiscount,
    taxPercentage,
    taxAmount,
    total,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Builds the payment QR for a bill, preferring the Razorpay dynamic QR and
// falling back to a plain UPI QR drawn from the restaurant's own UPI ID.
//
// The two are NOT equivalent and the caller must not treat them as such:
//   provider "razorpay" — Razorpay watches the QR and tells us via the
//     qr_code.credited webhook, so the bill settles itself.
//   provider "upi"      — just an encoded upi:// link. The money goes straight
//     to the restaurant's VPA and nobody tells us, so a human has to confirm.
//
// Never throws: a bill must always print and stay payable by cash even when
// no QR can be made at all.
async function createBillQr(bill, restaurant) {
  const viaRazorpay = await tryRazorpayQr(bill, BRAND_NAME);
  if (viaRazorpay.qrId) return { ...viaRazorpay, provider: "razorpay" };

  const viaUpi = await tryUpiQr(bill, restaurant);
  if (viaUpi.imageUrl) return { ...viaUpi, provider: "upi" };

  // Both unavailable — surface the more actionable of the two reasons.
  return { error: viaUpi.error || viaRazorpay.error };
}

async function tryRazorpayQr(bill, restaurantName = BRAND_NAME) {
  if (!razorpay) {
    return { error: "Razorpay is not configured on this server" };
  }

  try {
    const qr = await razorpay.qrCode.create({
      type: "upi_qr",
      name: String(restaurantName || BRAND_NAME).slice(0, 40),
      usage: "single_use",
      fixed_amount: true,
      payment_amount: Math.round(bill.pricing.total * 100), // paise
      description: `Bill ${bill.billNumber} · Table ${bill.tableNumber}`,
      // Razorpay requires close_by to be at least 15 minutes out; 6 hours
      // comfortably covers a guest paying at the end of a long meal.
      close_by: Math.floor(Date.now() / 1000) + 6 * 60 * 60,
      notes: {
        billId: bill._id.toString(),
        billNumber: bill.billNumber,
      },
    });

    return { qrId: qr.id, imageUrl: qr.image_url };
  } catch (err) {
    // Razorpay SDK errors carry their text in err.error.description and leave
    // err.message undefined — logging .message alone prints "undefined".
    // A 400 "requested URL was not found" here means the QR Codes product
    // isn't provisioned on the account (confirmed: even LISTING qr_codes
    // 400s). Razorpay support has to enable it; until then we fall back.
    const reason = err.error?.description || err.message || "Could not generate QR";
    console.warn(`[Billing] Razorpay QR unavailable for ${bill.billNumber} (${reason}) — falling back to UPI QR`);
    return { error: `Razorpay QR unavailable: ${reason}` };
  }
}

// A static-amount UPI intent QR encoding the restaurant's own VPA. Any UPI app
// reads it and pre-fills the exact bill amount; the money lands directly in the
// restaurant's account without touching Razorpay.
//
// The trade-off is deliberate and visible to staff: no webhook confirms this,
// so the waiter settles the bill by hand once the guest shows their receipt.
async function createUpiQr(upiId, payeeName, amount, note) {
  // Amount must be a plain 2dp decimal — UPI apps reject "441" formatted as
  // "441.00000001" or with thousands separators.
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName || "Restaurant",
    am: amount.toFixed(2),
    cu: "INR",
    tn: note,
  });
  const upiUrl = `upi://pay?${params.toString()}`;

  // Rendered server-side to a data URI so the bill page stays self-contained
  // — it prints and works on a tablet with no internet.
  const imageUrl = await QRCode.toDataURL(upiUrl, { width: 320, margin: 1, errorCorrectionLevel: "M" });
  return { imageUrl, upiUrl };
}

async function tryUpiQr(bill, restaurant) {
  const upiId = restaurant?.bankDetails?.upiId?.trim();
  if (!upiId) {
    return {
      error: "No UPI ID set — add one under Settings › Payments to show a scannable QR on bills",
    };
  }
  // A VPA is name@handle. Catching an obviously malformed one here beats
  // printing a QR that every UPI app silently refuses at the table.
  if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) {
    return { error: `"${upiId}" doesn't look like a valid UPI ID (expected something like cafe@okhdfcbank)` };
  }

  try {
    // Payee shown as the brand, not the outlet — a guest scanning sees
    // "Sri Isha Cafe", not the internal branch name "SIC Varthur", which
    // would look like a stranger's account and get the payment abandoned.
    const { imageUrl, upiUrl } = await createUpiQr(
      upiId,
      BRAND_NAME,
      bill.pricing.total,
      `Bill ${bill.billNumber} Table ${bill.tableNumber}`
    );
    return { imageUrl, upiUrl, upiId };
  } catch (err) {
    console.error(`[Billing] UPI QR render failed for ${bill.billNumber}:`, err.message);
    return { error: "Could not render the UPI QR" };
  }
}

// Best-effort close of a QR once the bill is settled another way (cash/card),
// so a half-scanned QR can't be paid after the fact.
async function closeBillQr(qrId) {
  if (!razorpay || !qrId) return;
  try {
    await razorpay.qrCode.close(qrId);
  } catch (err) {
    console.warn(`[Billing] Could not close QR ${qrId}:`, err.message);
  }
}

module.exports = { computeBillTotals, createBillQr, createUpiQr, closeBillQr, round2 };

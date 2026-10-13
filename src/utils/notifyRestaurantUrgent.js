// Alerts a restaurant about something that needs a human NOW: an order that
// never reached their POS, or a delivery with no rider assigned.
//
// This exists because of the Petpooja cutover. Previously every problem was
// visible on our restaurant dashboard, which staff watched all day. Once
// orders land on the Petpooja POS they stop opening our dashboard at all, so
// a dashboard badge nobody looks at is the same as no alert.
//
// Notifications go to the owner AND every manager. The owner reference can be
// stale — the Sri Isha records point at user ids that no longer exist and the
// real logins are managers — so sending only to the owner would reach nobody.
const Notification = require("../models/Notification");
const { getIo } = require("../socket");
const sendSms = require("./sendSms");

async function notifyRestaurantUrgent({ restaurant, order, title, message, event }) {
  console.error(`[Urgent] ${restaurant?.name} — ${title}: ${message}`);
  if (!restaurant) return;

  const recipients = [restaurant.owner, ...(restaurant.managers || [])].filter(Boolean);
  await Promise.allSettled(
    recipients.map((user) =>
      Notification.create({
        user,
        title,
        message,
        type: "order",
        data: { orderId: order?._id, restaurantId: restaurant._id },
      })
    )
  );

  try {
    const io = getIo();
    if (io) {
      io.to(`restaurant:${restaurant._id}`).emit(event || "urgent_alert", {
        title,
        message,
        orderNumber: order?.orderNumber,
      });
    }
  } catch (e) {}

  // SMS is the only channel that reaches someone who isn't looking at a
  // screen, which is the whole point here. India's DLT rules reject any text
  // that doesn't match the template registered against the content id used,
  // so this stays dormant until a template for these alerts is registered and
  // its id set in SMARTPING_DLT_ALERT_CONTENT_ID. Everything above still
  // fires either way — this is additive, never the only channel.
  const alertTemplateId = process.env.SMARTPING_DLT_ALERT_CONTENT_ID;
  if (alertTemplateId && restaurant.contact?.phone) {
    try {
      await sendSms({
        to: restaurant.contact.phone,
        text: message,
        dltContentId: alertTemplateId,
      });
    } catch (err) {
      console.error(`[Urgent] SMS failed for ${order?.orderNumber}: ${err.message}`);
    }
  }
}

module.exports = notifyRestaurantUrgent;

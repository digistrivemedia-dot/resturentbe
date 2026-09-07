const PlatformSettings = require("../models/PlatformSettings");
const sendEmail = require("./sendEmail");

// Fires an admin notification email if the admin has both configured a
// recipient address and left the given toggle on (Settings > Notifications).
// Silently no-ops when unconfigured — never blocks the caller's flow.
const notifyAdmin = async (toggleKey, { subject, html }) => {
  try {
    const [togglesSetting, emailSetting] = await Promise.all([
      PlatformSettings.findOne({ key: "emailToggles" }).lean(),
      PlatformSettings.findOne({ key: "notificationEmail" }).lean(),
    ]);
    const to = emailSetting?.value;
    const toggles = togglesSetting?.value || {};
    if (!to || toggles[toggleKey] === false) return;

    await sendEmail({ to, subject, html });
  } catch (err) {
    console.error(`[notifyAdmin] Failed to send "${toggleKey}" email:`, err.message);
  }
};

module.exports = notifyAdmin;

const ContactMessage = require("../models/ContactMessage");
const Notification = require("../models/Notification");
const User = require("../models/User");
const ApiResponse = require("../utils/ApiResponse");

// POST /contact — public contact form submission
const createContactMessage = async (req, res, next) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    const contactMessage = await ContactMessage.create({
      name,
      email,
      phone,
      subject,
      message,
    });

    // Notify every super admin / app owner
    const superAdmins = await User.find({ role: "super_admin" }).select("_id").lean();
    if (superAdmins.length > 0) {
      await Notification.insertMany(
        superAdmins.map((admin) => ({
          user: admin._id,
          title: subject?.trim() ? `New contact message: ${subject.trim()}` : "New contact message",
          message: `${name} (${email}) — ${message.slice(0, 140)}`,
          type: "system",
        }))
      );
    }

    return ApiResponse.send(res, 201, "Thanks for reaching out. We'll get back to you soon.", {
      contactMessage,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { createContactMessage };

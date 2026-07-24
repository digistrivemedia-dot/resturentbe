const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const validate = require("../middlewares/validate.middleware");
const { updateProfileValidator } = require("../validators/auth.validator");
const { addAddressValidator, updateAddressValidator } = require("../validators/order.validator");
const { updateProfile } = require("../controllers/auth.controller");
const {
  addAddress,
  updateAddress,
  deleteAddress,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/customer.controller");

// All customer routes require auth
router.use(auth);

// Profile
router.put("/profile", ...updateProfileValidator, validate, updateProfile);

// Addresses
router.post("/address", ...addAddressValidator, validate, addAddress);
router.put("/address/:id", ...updateAddressValidator, validate, updateAddress);
router.delete("/address/:id", deleteAddress);

// Notifications
router.get("/notifications", getNotifications);
router.put("/notifications/:id/read", markNotificationRead);
router.put("/notifications/read-all", markAllNotificationsRead);

module.exports = router;

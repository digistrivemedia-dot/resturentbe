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
  markMembershipPopupSeen,
} = require("../controllers/customer.controller");
const {
  getMembershipStatus,
  createMembershipOrder,
  verifyMembershipPayment,
} = require("../controllers/membership.controller");
const {
  getCategories: getSupportCategories,
  createTicket,
  getMyTickets,
  getTicketsForOrder,
  getTicketById,
  addCustomerMessage,
} = require("../controllers/support.controller");
const { createTicketValidator, addMessageValidator } = require("../validators/support.validator");
const { getCart, syncCart, clearCartRemote } = require("../controllers/customer.cart.controller");

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

// Membership
router.get("/membership", getMembershipStatus);
router.post("/membership/checkout", createMembershipOrder);
router.post("/membership/verify", verifyMembershipPayment);
router.put("/membership-popup/seen", markMembershipPopupSeen);

// Cart (server-side mirror — enables cross-device recovery and abandoned-cart automations)
router.get("/cart", getCart);
router.put("/cart", syncCart);
router.delete("/cart", clearCartRemote);

// Support tickets
router.get("/support/categories", getSupportCategories);
router.post("/support/tickets", ...createTicketValidator, validate, createTicket);
router.get("/support/tickets", getMyTickets);
router.get("/support/tickets/order/:orderId", getTicketsForOrder);
router.get("/support/tickets/:id", getTicketById);
router.post("/support/tickets/:id/messages", ...addMessageValidator, validate, addCustomerMessage);

module.exports = router;

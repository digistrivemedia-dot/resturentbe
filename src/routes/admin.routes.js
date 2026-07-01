const express = require("express");
const router = express.Router();

// Middlewares
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");
const validate = require("../middlewares/validate.middleware");
const adminLog = require("../middlewares/adminLog.middleware");

// Validators
const {
  onboardRestaurantValidator,
  createCouponValidator,
  createBannerValidator,
  sendNotificationValidator,
  updateSettingsValidator,
  processRefundValidator,
} = require("../validators/admin.validator");

// Controllers
const { getDashboardStats } = require("../controllers/admin.dashboard.controller");
const {
  getRestaurants,
  getRestaurantById,
  onboardRestaurant,
  updateRestaurant,
  verifyRestaurant,
  suspendRestaurant,
  reactivateRestaurant,
  deleteRestaurant,
} = require("../controllers/admin.restaurant.controller");
const {
  getCustomers,
  getCustomerById,
  blockCustomer,
} = require("../controllers/admin.customer.controller");
const {
  getOrders,
  getOrderById,
  processRefund,
} = require("../controllers/admin.order.controller");
const {
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} = require("../controllers/admin.coupon.controller");
const {
  getBanners,
  createBanner,
  updateBanner,
  deleteBanner,
} = require("../controllers/admin.banner.controller");
const { sendNotification } = require("../controllers/admin.notification.controller");
const { getSettings, updateSettings } = require("../controllers/admin.settings.controller");
const { getLogs } = require("../controllers/admin.log.controller");
const { getRestaurantLogins, addRestaurantLogin, resetLoginPassword, getImpersonateToken } = require("../controllers/admin.login.controller");

// Apply auth + super_admin role to all routes
router.use(auth, role("super_admin"));

// Dashboard
router.get("/dashboard", getDashboardStats);

// Restaurants
router.get("/restaurants", getRestaurants);
router.post("/restaurants", ...onboardRestaurantValidator, validate, adminLog("onboarded", "restaurant"), onboardRestaurant);
router.get("/restaurants/:id", getRestaurantById);
router.put("/restaurants/:id", adminLog("updated", "restaurant"), updateRestaurant);
router.put("/restaurants/:id/verify", adminLog("verified", "restaurant"), verifyRestaurant);
router.put("/restaurants/:id/suspend", adminLog("suspended", "restaurant"), suspendRestaurant);
router.put("/restaurants/:id/reactivate", adminLog("reactivated", "restaurant"), reactivateRestaurant);
router.delete("/restaurants/:id", adminLog("deleted", "restaurant"), deleteRestaurant);
router.get("/restaurants/:id/logins", getRestaurantLogins);
router.post("/restaurants/:id/logins", addRestaurantLogin);
router.put("/restaurants/:id/logins/:userId/reset-password", resetLoginPassword);
router.get("/restaurants/:id/logins/:userId/impersonate-token", getImpersonateToken);

// Customers
router.get("/customers", getCustomers);
router.get("/customers/:id", getCustomerById);
router.put("/customers/:id/block", adminLog("toggled_block", "customer"), blockCustomer);

// Orders
router.get("/orders", getOrders);
router.get("/orders/:id", getOrderById);
router.put("/orders/:id/refund", ...processRefundValidator, validate, adminLog("refunded", "order"), processRefund);

// Coupons
router.get("/coupons", getCoupons);
router.post("/coupons", ...createCouponValidator, validate, adminLog("created", "coupon"), createCoupon);
router.put("/coupons/:id", adminLog("updated", "coupon"), updateCoupon);
router.delete("/coupons/:id", adminLog("deleted", "coupon"), deleteCoupon);

// Banners (CMS)
router.get("/banners", getBanners);
router.post("/banners", ...createBannerValidator, validate, adminLog("created", "banner"), createBanner);
router.put("/banners/:id", adminLog("updated", "banner"), updateBanner);
router.delete("/banners/:id", adminLog("deleted", "banner"), deleteBanner);

// Notifications
router.post("/notifications/send", ...sendNotificationValidator, validate, adminLog("sent", "notification"), sendNotification);

// Platform Settings
router.get("/settings", getSettings);
router.put("/settings", ...updateSettingsValidator, validate, adminLog("updated", "settings"), updateSettings);

// Activity Logs
router.get("/logs", getLogs);

module.exports = router;

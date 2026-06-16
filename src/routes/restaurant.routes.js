const express = require("express");
const router = express.Router();

// Middlewares
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");
const restaurantMiddleware = require("../middlewares/restaurant.middleware");
const validate = require("../middlewares/validate.middleware");

// Validators
const {
  addMenuItemValidator,
  updateOrderStatusValidator,
  createCouponValidator,
  replyToReviewValidator,
} = require("../validators/restaurant.validator");

// Controllers
const { getDashboardStats } = require("../controllers/restaurant.dashboard.controller");
const {
  getOrders,
  getOrderById,
  acceptOrder,
  rejectOrder,
  updateOrderStatus,
} = require("../controllers/restaurant.order.controller");
const {
  getMenu,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleAvailability,
  bulkToggle,
} = require("../controllers/restaurant.menu.controller");
const {
  getCategories,
  addCategory,
  updateCategory,
  reorderCategories,
  deleteCategory,
} = require("../controllers/restaurant.category.controller");
const {
  getAddons,
  addAddonGroup,
  updateAddonGroup,
  deleteAddonGroup,
} = require("../controllers/restaurant.addon.controller");
const {
  getCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} = require("../controllers/restaurant.coupon.controller");
const { getReviews, replyToReview } = require("../controllers/restaurant.review.controller");
const {
  getProfile,
  updateProfile,
  updateSettings,
  getPayouts,
} = require("../controllers/restaurant.profile.controller");

// Apply auth, role, and restaurant middleware to all routes
router.use(auth, role("restaurant_owner"), restaurantMiddleware);

// Dashboard
router.get("/dashboard", getDashboardStats);

// Orders
router.get("/orders", getOrders);
router.get("/orders/:id", getOrderById);
router.put("/orders/:id/accept", acceptOrder);
router.put("/orders/:id/reject", rejectOrder);
router.put("/orders/:id/status", updateOrderStatusValidator, validate, updateOrderStatus);

// Menu
router.get("/menu", getMenu);
router.post("/menu", addMenuItemValidator, validate, addMenuItem);
router.put("/menu/bulk-toggle", bulkToggle);
router.put("/menu/:id", updateMenuItem);
router.put("/menu/:id/toggle", toggleAvailability);
router.delete("/menu/:id", deleteMenuItem);

// Categories
router.get("/categories", getCategories);
router.post("/categories", addCategory);
router.put("/categories/reorder", reorderCategories);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

// Addons
router.get("/addons", getAddons);
router.post("/addons", addAddonGroup);
router.put("/addons/:id", updateAddonGroup);
router.delete("/addons/:id", deleteAddonGroup);

// Coupons
router.get("/coupons", getCoupons);
router.post("/coupons", createCouponValidator, validate, createCoupon);
router.put("/coupons/:id", updateCoupon);
router.delete("/coupons/:id", deleteCoupon);

// Reviews
router.get("/reviews", getReviews);
router.post("/reviews/:id/reply", replyToReviewValidator, validate, replyToReview);

// Profile
router.get("/profile", getProfile);
router.put("/profile", updateProfile);
router.put("/settings", updateSettings);
router.get("/payouts", getPayouts);

module.exports = router;

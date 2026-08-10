const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const validate = require("../middlewares/validate.middleware");
const {
  getRestaurants,
  getRestaurantBySlug,
  getRestaurantMenu,
  getRestaurantReviews,
  toggleFavorite,
  toggleFavoriteDish,
  search,
  searchSuggestions,
} = require("../controllers/restaurant.public.controller");
const { getHomeFeed, getLandingShowcase } = require("../controllers/home.controller");
const { getPlatformFee, getOrderTypes } = require("../controllers/public.settings.controller");
const { createContactMessage } = require("../controllers/contact.controller");
const { createContactMessageValidator } = require("../validators/contact.validator");

// Home feed (nearby restaurants + food items)
router.get("/home/feed", getHomeFeed);

// Landing page showcase (real categories + real dishes, for the public marketing page)
router.get("/home/showcase", getLandingShowcase);

// Platform fee (enabled/amount) — public, used by cart/checkout
router.get("/settings/platform-fee", getPlatformFee);

// Order types enabled platform-wide (delivery/pickup/dine_in/self_service) — public
router.get("/settings/order-types", getOrderTypes);

// Search (public)
router.get("/search", search);
router.get("/search/suggestions", searchSuggestions);

// Restaurants (public)
router.get("/restaurants", getRestaurants);
router.get("/restaurants/:slug", getRestaurantBySlug);
router.get("/restaurants/:id/menu", getRestaurantMenu);
router.get("/restaurants/:id/reviews", getRestaurantReviews);

// Favorite restaurant (auth required)
router.post("/restaurants/:id/favorite", auth, toggleFavorite);

// Favorite dish (auth required)
router.post("/dishes/:id/favorite", auth, toggleFavoriteDish);

// Contact form (public) — notifies super admin
router.post("/contact", createContactMessageValidator, validate, createContactMessage);

module.exports = router;

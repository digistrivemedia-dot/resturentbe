const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const {
  getRestaurants,
  getRestaurantBySlug,
  getRestaurantMenu,
  getRestaurantReviews,
  toggleFavorite,
  search,
  searchSuggestions,
} = require("../controllers/restaurant.public.controller");
const { getHomeFeed } = require("../controllers/home.controller");

// Home feed (nearby restaurants + food items)
router.get("/home/feed", getHomeFeed);

// Search (public)
router.get("/search", search);
router.get("/search/suggestions", searchSuggestions);

// Restaurants (public)
router.get("/restaurants", getRestaurants);
router.get("/restaurants/:slug", getRestaurantBySlug);
router.get("/restaurants/:id/menu", getRestaurantMenu);
router.get("/restaurants/:id/reviews", getRestaurantReviews);

// Favorite (auth required)
router.post("/restaurants/:id/favorite", auth, toggleFavorite);

module.exports = router;

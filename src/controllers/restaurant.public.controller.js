const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const Review = require("../models/Review");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

// GET /restaurants — List restaurants with filters, sort, pagination
const getRestaurants = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 12,
      cuisines,
      isVeg,
      rating,
      priceRange,
      deliveryTime,
      sort = "relevance",
      search,
      featured,
      offers,
      freeDelivery,
      lat,
      lng,
    } = req.query;

    const filter = { status: "active" };

    // Cuisine filter (comma-separated)
    if (cuisines) {
      filter.cuisines = { $in: cuisines.split(",").map((c) => c.trim()) };
    }

    // Veg only
    if (isVeg === "true") {
      filter.categories = { $in: ["Veg"] };
    }

    // Minimum rating
    if (rating) {
      filter["rating.average"] = { $gte: Number(rating) };
    }

    // Price range (costForTwo)
    if (priceRange) {
      const [min, max] = priceRange.split("-").map(Number);
      filter.costForTwo = {};
      if (min) filter.costForTwo.$gte = min;
      if (max) filter.costForTwo.$lte = max;
    }

    // Delivery time filter
    if (deliveryTime) {
      filter["deliverySettings.avgDeliveryTime"] = { $lte: Number(deliveryTime) };
    }

    // Featured only
    if (featured === "true") {
      filter.isFeatured = true;
    }

    // Has offers
    if (offers === "true") {
      filter["offers.0"] = { $exists: true };
    }

    // Free delivery
    if (freeDelivery === "true") {
      filter["deliverySettings.deliveryFee"] = 0;
    }

    // Text search
    if (search) {
      filter.$text = { $search: search };
    }

    // Sort options
    let sortOption = {};
    switch (sort) {
      case "rating":
        sortOption = { "rating.average": -1 };
        break;
      case "deliveryTime":
        sortOption = { "deliverySettings.avgDeliveryTime": 1 };
        break;
      case "costLowToHigh":
        sortOption = { costForTwo: 1 };
        break;
      case "costHighToLow":
        sortOption = { costForTwo: -1 };
        break;
      case "newest":
        sortOption = { createdAt: -1 };
        break;
      default:
        sortOption = { isFeatured: -1, "rating.average": -1 };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [restaurants, total] = await Promise.all([
      Restaurant.find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Restaurant.countDocuments(filter),
    ]);

    ApiResponse.send(res, 200, "Restaurants fetched", {
      restaurants,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /restaurants/:slug — Restaurant detail by slug
const getRestaurantBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const restaurant = await Restaurant.findOne({ slug, status: "active" }).lean();
    if (!restaurant) {
      throw new ApiError(404, "Restaurant not found");
    }

    ApiResponse.send(res, 200, "Restaurant fetched", { restaurant });
  } catch (error) {
    next(error);
  }
};

// GET /restaurants/:id/menu — Full menu grouped by category
const getRestaurantMenu = async (req, res, next) => {
  try {
    const { id } = req.params;

    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      throw new ApiError(404, "Restaurant not found");
    }

    const menuItems = await MenuItem.find({
      restaurant: id,
      status: "active",
    })
      .sort({ category: 1, sortOrder: 1 })
      .lean();

    // Group by category
    const categories = [];
    const categoryMap = {};

    for (const item of menuItems) {
      if (!categoryMap[item.category]) {
        categoryMap[item.category] = [];
        categories.push(item.category);
      }
      categoryMap[item.category].push(item);
    }

    const menu = categories.map((cat) => ({
      category: cat,
      items: categoryMap[cat],
    }));

    ApiResponse.send(res, 200, "Menu fetched", {
      menu,
      categories,
      totalItems: menuItems.length,
    });
  } catch (error) {
    next(error);
  }
};

// GET /restaurants/:id/reviews — Reviews with pagination
const getRestaurantReviews = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, rating } = req.query;

    const filter = { restaurant: id, isVisible: true };
    if (rating) {
      filter.foodRating = Number(rating);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .populate("customer", "name avatar")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Review.countDocuments(filter),
    ]);

    ApiResponse.send(res, 200, "Reviews fetched", {
      reviews,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /restaurants/:id/favorite — Toggle favorite (auth required)
const toggleFavorite = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      throw new ApiError(404, "Restaurant not found");
    }

    const user = await User.findById(userId);
    const index = user.favorites.indexOf(id);

    let isFavorite;
    if (index > -1) {
      user.favorites.splice(index, 1);
      isFavorite = false;
    } else {
      user.favorites.push(id);
      isFavorite = true;
    }

    await user.save();

    ApiResponse.send(res, 200, isFavorite ? "Added to favorites" : "Removed from favorites", {
      isFavorite,
      favorites: user.favorites,
    });
  } catch (error) {
    next(error);
  }
};

// GET /search — Search restaurants & dishes
const search = async (req, res, next) => {
  try {
    const { q, type = "all", page = 1, limit = 12, sort = "relevance" } = req.query;

    if (!q || q.trim().length < 2) {
      return ApiResponse.send(res, 200, "Search results", {
        restaurants: [],
        dishes: [],
      });
    }

    const query = q.trim();
    const skip = (Number(page) - 1) * Number(limit);

    let sortOption = {};
    switch (sort) {
      case "rating":
        sortOption = { "rating.average": -1 };
        break;
      case "deliveryTime":
        sortOption = { "deliverySettings.avgDeliveryTime": 1 };
        break;
      case "costLowToHigh":
        sortOption = { costForTwo: 1 };
        break;
      case "costHighToLow":
        sortOption = { costForTwo: -1 };
        break;
      default:
        sortOption = { "rating.average": -1 };
    }

    let restaurants = [];
    let dishes = [];

    // Search restaurants
    if (type === "all" || type === "restaurants") {
      const regex = new RegExp(query, "i");
      restaurants = await Restaurant.find({
        status: "active",
        $or: [
          { name: regex },
          { cuisines: regex },
          { description: regex },
        ],
      })
        .sort(sortOption)
        .skip(skip)
        .limit(Number(limit))
        .lean();
    }

    // Search dishes (only from active restaurants)
    if (type === "all" || type === "dishes") {
      const regex = new RegExp(query, "i");
      const activeRestaurantIds = await Restaurant.find({ status: "active" }).distinct("_id");
      dishes = await MenuItem.find({
        status: "active",
        isAvailable: true,
        restaurant: { $in: activeRestaurantIds },
        $or: [
          { name: regex },
          { category: regex },
          { description: regex },
        ],
      })
        .populate("restaurant", "name slug rating deliverySettings costForTwo")
        .sort({ isBestseller: -1, price: 1 })
        .skip(skip)
        .limit(Number(limit))
        .lean();
    }

    ApiResponse.send(res, 200, "Search results", {
      restaurants,
      dishes,
      query,
    });
  } catch (error) {
    next(error);
  }
};

// GET /search/suggestions — Autocomplete
const searchSuggestions = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 1) {
      return ApiResponse.send(res, 200, "Suggestions", { suggestions: [] });
    }

    const regex = new RegExp(q.trim(), "i");

    const [restaurantNames, dishNames] = await Promise.all([
      Restaurant.find({ status: "active", name: regex })
        .select("name slug")
        .limit(5)
        .lean(),
      MenuItem.find({ status: "active", name: regex })
        .select("name category")
        .limit(5)
        .lean(),
    ]);

    const suggestions = [
      ...restaurantNames.map((r) => ({ type: "restaurant", name: r.name, slug: r.slug })),
      ...dishNames.map((d) => ({ type: "dish", name: d.name, category: d.category })),
    ];

    ApiResponse.send(res, 200, "Suggestions", { suggestions });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRestaurants,
  getRestaurantBySlug,
  getRestaurantMenu,
  getRestaurantReviews,
  toggleFavorite,
  search,
  searchSuggestions,
};

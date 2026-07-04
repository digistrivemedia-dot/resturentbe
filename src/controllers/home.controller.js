const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const PlatformCategory = require("../models/PlatformCategory");
const Coupon = require("../models/Coupon");
const ApiResponse = require("../utils/ApiResponse");

// GET /home/feed?lat=X&lng=Y&category=Biryani
const getHomeFeed = async (req, res, next) => {
  try {
    const { lat, lng, category } = req.query;

    // Always return active categories
    const categories = await PlatformCategory.find({ isActive: true })
      .sort({ displayOrder: 1, createdAt: 1 })
      .lean();

    const hasLocation = lat && lng;
    let restaurants = [];
    let items = [];

    if (hasLocation) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);

      // Try geospatial query; fall back to all active if index missing or no geo-tagged restaurants
      try {
        restaurants = await Restaurant.find({
          status: "active",
          location: {
            $nearSphere: {
              $geometry: { type: "Point", coordinates: [longitude, latitude] },
              $maxDistance: 8000,
            },
          },
        })
          .select("name slug logo coverImage cuisines rating timing deliverySettings address location")
          .limit(20)
          .lean();
      } catch (geoErr) {
        console.warn("[home/feed] $nearSphere failed, falling back:", geoErr.message);
      }

      // If geo query returned nothing (no restaurants have coordinates yet), fall back
      if (restaurants.length === 0) {
        restaurants = await Restaurant.find({ status: "active" })
          .select("name slug logo coverImage cuisines rating timing deliverySettings address location")
          .limit(20)
          .lean();
      }
    } else {
      // No location provided: return all active restaurants
      restaurants = await Restaurant.find({ status: "active" })
        .select("name slug logo coverImage cuisines rating timing deliverySettings address location")
        .limit(20)
        .lean();
    }

    // Fetch menu items for found restaurants
    const restaurantIds = restaurants.map((r) => r._id);
    if (restaurantIds.length > 0) {
      const itemFilter = {
        restaurant: { $in: restaurantIds },
        status: "active",
        isAvailable: true,
      };

      if (category && category !== "all") {
        itemFilter.category = { $regex: new RegExp(`^${category}$`, "i") };
      }

      items = await MenuItem.find(itemFilter)
        .sort({ isBestseller: -1, sortOrder: 1 })
        .populate("restaurant", "name slug logo timing status address deliverySettings")
        .limit(30)
        .lean();

      // Attach the best active coupon to each item
      if (items.length > 0) {
        const now = new Date();
        const coupons = await Coupon.find({
          restaurant: { $in: restaurantIds },
          isActive: true,
          validUntil: { $gt: now },
        }).lean();

        if (coupons.length > 0) {
          items = items.map((item) => {
            // Find coupons that apply to this item: either no specific items (all-item coupon)
            // or this item is explicitly listed
            const applicable = coupons.filter((c) => {
              if (String(c.restaurant) !== String(item.restaurant._id)) return false;
              if (c.applicableItems && c.applicableItems.length > 0) {
                return c.applicableItems.some((id) => String(id) === String(item._id));
              }
              return true; // applies to all items of that restaurant
            });

            if (applicable.length === 0) return item;

            // Pick the best coupon (highest value percentage first, then flat)
            applicable.sort((a, b) => {
              if (a.type === "percentage" && b.type !== "percentage") return -1;
              if (b.type === "percentage" && a.type !== "percentage") return 1;
              return b.value - a.value;
            });

            return { ...item, coupon: applicable[0] };
          });
        }
      }
    }

    ApiResponse.send(res, 200, "Home feed", { categories, restaurants, items });
  } catch (error) {
    next(error);
  }
};

module.exports = { getHomeFeed };

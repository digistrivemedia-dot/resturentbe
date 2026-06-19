const Restaurant = require("../models/Restaurant");
const User = require("../models/User");
const Order = require("../models/Order");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

const getRestaurants = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      city,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (city) query["address.city"] = new RegExp(city, "i");
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { slug: new RegExp(search, "i") },
        { "contact.email": new RegExp(search, "i") },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [restaurants, total] = await Promise.all([
      Restaurant.find(query)
        .populate("owner", "name email phone")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Restaurant.countDocuments(query),
    ]);

    return ApiResponse.send(res, 200, "Restaurants fetched", {
      restaurants,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

const getRestaurantById = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id)
      .populate("owner", "name email phone")
      .lean();

    if (!restaurant) {
      throw new ApiError(404, "Restaurant not found");
    }

    // Fetch recent orders and stats for this restaurant
    const [orderCount, recentOrders] = await Promise.all([
      Order.countDocuments({ restaurant: restaurant._id }),
      Order.find({ restaurant: restaurant._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("customer", "name")
        .lean(),
    ]);

    return ApiResponse.send(res, 200, "Restaurant fetched", {
      restaurant,
      orderCount,
      recentOrders,
    });
  } catch (error) {
    next(error);
  }
};

const onboardRestaurant = async (req, res, next) => {
  try {
    const {
      owner: ownerData = {},
      name, description, cuisines, categories,
      address, contact, timing, commission,
      // flat delivery fields from frontend
      deliveryFee, deliveryRadius, avgDeliveryTime, minOrder, freeDeliveryAbove,
      // nested delivery settings (if frontend sends them this way)
      deliverySettings: rawDeliverySettings,
      // bank and documents
      bank = {}, documents = {},
      taxSettings: rawTaxSettings,
    } = req.body;

    const ownerName  = ownerData.name;
    const ownerEmail = ownerData.email;
    const ownerPhone = ownerData.phone;

    // Create or update the owner user account
    let owner = await User.findOne({ email: ownerEmail });
    if (owner && owner.role === "restaurant_owner") {
      throw new ApiError(400, "This email is already registered as a restaurant owner");
    }

    if (!owner) {
      // Temp password: last 4 digits of phone + "@Cafe", or random
      const tempPassword = ownerPhone
        ? ownerPhone.slice(-4) + "@Cafe"
        : Math.random().toString(36).slice(-8);
      owner = await User.create({
        name: ownerName,
        email: ownerEmail,
        phone: ownerPhone,
        password: tempPassword,
        role: "restaurant_owner",
        authProvider: "email",
        isEmailVerified: true,
      });
    } else {
      owner.role = "restaurant_owner";
      owner.name  = ownerName  || owner.name;
      owner.phone = ownerPhone || owner.phone;
      await owner.save();
    }

    // Build deliverySettings — accept both flat fields and nested object
    const deliverySettings = rawDeliverySettings || {
      deliveryFee:      deliveryFee      ?? 30,
      deliveryRadius:   deliveryRadius   ?? 5,
      avgDeliveryTime:  avgDeliveryTime  ?? 30,
      minOrderAmount:   minOrder         ?? 100,
      freeDeliveryAbove: freeDeliveryAbove ?? null,
    };

    // Build taxSettings from documents or raw taxSettings
    const taxSettings = rawTaxSettings || {
      gstNumber:    documents.gst   || "",
      fssaiLicense: documents.fssai || "",
    };

    // Build bankDetails from bank object
    const bankDetails = {
      accountName:   bank.accountHolder || "",
      accountNumber: bank.accountNumber || "",
      ifscCode:      bank.ifsc          || "",
      bankName:      bank.bankName      || "",
    };

    const restaurant = await Restaurant.create({
      owner: owner._id,
      name,
      description,
      cuisines:        cuisines   || [],
      categories:      categories || [],
      address:         address    || {},
      contact:         contact    || {},
      timing:          timing     || {},
      deliverySettings,
      taxSettings,
      bankDetails,
      commission:      commission || 10,
      status:          "pending",
      onboardedBy:     req.user._id,
    });

    return ApiResponse.send(res, 201, "Restaurant onboarded successfully", { restaurant, owner });
  } catch (error) {
    next(error);
  }
};

const updateRestaurant = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      throw new ApiError(404, "Restaurant not found");
    }

    const allowed = [
      "name", "description", "cuisines", "address", "contact",
      "timing", "deliverySettings", "taxSettings", "bankDetails",
      "commission", "isFeatured", "costForTwo", "categories",
    ];

    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        restaurant[field] = req.body[field];
      }
    });

    await restaurant.save();

    return ApiResponse.send(res, 200, "Restaurant updated", { restaurant });
  } catch (error) {
    next(error);
  }
};

const verifyRestaurant = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      throw new ApiError(404, "Restaurant not found");
    }

    restaurant.isVerified = true;
    restaurant.status = "active";
    await restaurant.save();

    return ApiResponse.send(res, 200, "Restaurant verified and activated", { restaurant });
  } catch (error) {
    next(error);
  }
};

const suspendRestaurant = async (req, res, next) => {
  try {
    const { reason } = req.body;

    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      throw new ApiError(404, "Restaurant not found");
    }

    restaurant.status = "suspended";
    if (reason) restaurant.suspensionReason = reason;
    await restaurant.save();

    return ApiResponse.send(res, 200, "Restaurant suspended", { restaurant });
  } catch (error) {
    next(error);
  }
};

const reactivateRestaurant = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      throw new ApiError(404, "Restaurant not found");
    }

    if (restaurant.status !== "suspended") {
      throw new ApiError(400, "Restaurant is not suspended");
    }

    restaurant.status = "active";
    restaurant.suspensionReason = undefined;
    await restaurant.save();

    return ApiResponse.send(res, 200, "Restaurant reactivated", { restaurant });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRestaurants,
  getRestaurantById,
  onboardRestaurant,
  updateRestaurant,
  verifyRestaurant,
  suspendRestaurant,
  reactivateRestaurant,
};

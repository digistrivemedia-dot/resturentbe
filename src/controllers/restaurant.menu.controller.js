const MenuItem = require("../models/MenuItem");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

const getMenu = async (req, res, next) => {
  try {
    const items = await MenuItem.find({
      restaurant: req.restaurant._id,
      status: "active",
    })
      .sort({ category: 1, sortOrder: 1 })
      .lean();

    // Group by category
    const grouped = {};
    for (const item of items) {
      if (!grouped[item.category]) {
        grouped[item.category] = [];
      }
      grouped[item.category].push(item);
    }

    // Convert to array format
    const menu = Object.keys(grouped).map((category) => ({
      category,
      items: grouped[category],
    }));

    return ApiResponse.send(res, 200, "Menu fetched", { menu });
  } catch (error) {
    next(error);
  }
};

const addMenuItem = async (req, res, next) => {
  try {
    const {
      name,
      category,
      subCategory,
      description,
      image,
      price,
      discountedPrice,
      isVeg,
      isVegan,
      spiceLevel,
      preparationTime,
      tags,
      addonGroups,
      variants,
      nutritionalInfo,
      allergens,
      sortOrder,
    } = req.body;

    const menuItem = await MenuItem.create({
      restaurant: req.restaurant._id,
      name,
      category,
      subCategory,
      description,
      image,
      price,
      discountedPrice,
      isVeg,
      isVegan,
      spiceLevel,
      preparationTime,
      tags,
      addonGroups,
      variants,
      nutritionalInfo,
      allergens,
      sortOrder,
    });

    return ApiResponse.send(res, 201, "Menu item added", { menuItem });
  } catch (error) {
    next(error);
  }
};

const updateMenuItem = async (req, res, next) => {
  try {
    const menuItem = await MenuItem.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    });

    if (!menuItem) {
      throw new ApiError(404, "Menu item not found");
    }

    const allowedFields = [
      "name",
      "category",
      "subCategory",
      "description",
      "image",
      "price",
      "discountedPrice",
      "isVeg",
      "isVegan",
      "spiceLevel",
      "preparationTime",
      "tags",
      "addonGroups",
      "variants",
      "nutritionalInfo",
      "allergens",
      "sortOrder",
      "isBestseller",
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        menuItem[field] = req.body[field];
      }
    }

    await menuItem.save();

    return ApiResponse.send(res, 200, "Menu item updated", { menuItem });
  } catch (error) {
    next(error);
  }
};

const deleteMenuItem = async (req, res, next) => {
  try {
    const { hard } = req.query;

    const menuItem = await MenuItem.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    });

    if (!menuItem) {
      throw new ApiError(404, "Menu item not found");
    }

    if (hard === "true") {
      await MenuItem.deleteOne({ _id: menuItem._id });
      return ApiResponse.send(res, 200, "Menu item permanently deleted");
    }

    // Soft delete
    menuItem.status = "inactive";
    await menuItem.save();

    return ApiResponse.send(res, 200, "Menu item deactivated", { menuItem });
  } catch (error) {
    next(error);
  }
};

const toggleAvailability = async (req, res, next) => {
  try {
    const menuItem = await MenuItem.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    });

    if (!menuItem) {
      throw new ApiError(404, "Menu item not found");
    }

    menuItem.isAvailable = !menuItem.isAvailable;
    await menuItem.save();

    return ApiResponse.send(res, 200, "Availability toggled", { menuItem });
  } catch (error) {
    next(error);
  }
};

const bulkToggle = async (req, res, next) => {
  try {
    const { ids, isAvailable } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new ApiError(400, "ids array is required");
    }

    if (typeof isAvailable !== "boolean") {
      throw new ApiError(400, "isAvailable boolean is required");
    }

    const result = await MenuItem.updateMany(
      {
        _id: { $in: ids },
        restaurant: req.restaurant._id,
      },
      { $set: { isAvailable } }
    );

    return ApiResponse.send(res, 200, "Bulk update complete", {
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMenu,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  toggleAvailability,
  bulkToggle,
};

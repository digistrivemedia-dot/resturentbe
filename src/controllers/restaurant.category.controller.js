const MenuItem = require("../models/MenuItem");
const MenuCategory = require("../models/MenuCategory");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

const getCategories = async (req, res, next) => {
  try {
    const categories = await MenuItem.aggregate([
      {
        $match: {
          restaurant: req.restaurant._id,
          status: "active",
        },
      },
      {
        $group: {
          _id: "$category",
          itemCount: { $sum: 1 },
          minSortOrder: { $min: "$sortOrder" },
        },
      },
      {
        $sort: { minSortOrder: 1 },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          itemCount: 1,
        },
      },
    ]);

    // Merge in any uploaded category images
    const images = await MenuCategory.find({ restaurant: req.restaurant._id }).lean();
    const imageMap = {};
    images.forEach((c) => { imageMap[c.name] = c.image; });
    categories.forEach((c) => { c.image = imageMap[c.name] || null; });

    return ApiResponse.send(res, 200, "Categories fetched", { categories });
  } catch (error) {
    next(error);
  }
};

const addCategory = async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      throw new ApiError(400, "Category name is required");
    }

    // Check if category already exists
    const existing = await MenuItem.findOne({
      restaurant: req.restaurant._id,
      category: name.trim(),
      status: "active",
    }).lean();

    if (existing) {
      throw new ApiError(400, "Category already exists");
    }

    return ApiResponse.send(res, 201, "Category name is valid and can be used", {
      category: name.trim(),
    });
  } catch (error) {
    next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const oldName = decodeURIComponent(req.params.id);
    const { name } = req.body;

    if (!name || !name.trim()) {
      throw new ApiError(400, "New category name is required");
    }

    // Verify old category exists
    const exists = await MenuItem.findOne({
      restaurant: req.restaurant._id,
      category: oldName,
      status: "active",
    }).lean();

    if (!exists) {
      throw new ApiError(404, "Category not found");
    }

    // Rename all menu items with old category to new name
    const result = await MenuItem.updateMany(
      {
        restaurant: req.restaurant._id,
        category: oldName,
      },
      { $set: { category: name.trim() } }
    );

    // Keep the category's uploaded image attached under the new name
    await MenuCategory.updateOne(
      { restaurant: req.restaurant._id, name: oldName },
      { $set: { name: name.trim() } }
    );

    return ApiResponse.send(res, 200, "Category renamed", {
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /restaurant/categories/:id/image — Set/replace a category's image
const updateCategoryImage = async (req, res, next) => {
  try {
    const name = decodeURIComponent(req.params.id);
    const { image } = req.body;

    if (!image) {
      throw new ApiError(400, "image URL is required");
    }

    const exists = await MenuItem.findOne({
      restaurant: req.restaurant._id,
      category: name,
      status: "active",
    }).lean();

    if (!exists) {
      throw new ApiError(404, "Category not found");
    }

    const category = await MenuCategory.findOneAndUpdate(
      { restaurant: req.restaurant._id, name },
      { $set: { image } },
      { upsert: true, new: true }
    );

    return ApiResponse.send(res, 200, "Category image updated", { category });
  } catch (error) {
    next(error);
  }
};

const reorderCategories = async (req, res, next) => {
  try {
    const { categories } = req.body;

    if (!categories || !Array.isArray(categories)) {
      throw new ApiError(400, "categories array is required");
    }

    // Update sortOrder for menu items based on category order
    const bulkOps = categories.map((categoryName, index) => ({
      updateMany: {
        filter: {
          restaurant: req.restaurant._id,
          category: categoryName,
        },
        update: { $set: { sortOrder: index * 100 } },
      },
    }));

    if (bulkOps.length > 0) {
      await MenuItem.bulkWrite(bulkOps);
    }

    return ApiResponse.send(res, 200, "Categories reordered");
  } catch (error) {
    next(error);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const categoryName = decodeURIComponent(req.params.id);

    const itemCount = await MenuItem.countDocuments({
      restaurant: req.restaurant._id,
      category: categoryName,
      status: "active",
    });

    if (itemCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete category with ${itemCount} active menu items. Move or delete items first.`
      );
    }

    // Soft-delete any remaining inactive items in this category
    await MenuItem.updateMany(
      { restaurant: req.restaurant._id, category: categoryName },
      { $set: { status: "deleted" } }
    );

    // Remove from restaurant's categories array if it exists there
    const restaurant = req.restaurant;
    if (restaurant.categories?.includes(categoryName)) {
      restaurant.categories = restaurant.categories.filter((c) => c !== categoryName);
      await restaurant.save();
    }

    await MenuCategory.deleteOne({ restaurant: req.restaurant._id, name: categoryName });

    return ApiResponse.send(res, 200, "Category deleted");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCategories,
  addCategory,
  updateCategory,
  updateCategoryImage,
  reorderCategories,
  deleteCategory,
};

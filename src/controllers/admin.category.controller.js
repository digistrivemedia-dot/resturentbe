const PlatformCategory = require("../models/PlatformCategory");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

const getCategories = async (req, res, next) => {
  try {
    const categories = await PlatformCategory.find()
      .sort({ displayOrder: 1, createdAt: 1 })
      .lean();
    ApiResponse.send(res, 200, "Categories fetched", { categories });
  } catch (error) {
    next(error);
  }
};

const createCategory = async (req, res, next) => {
  try {
    const { name, image, displayOrder } = req.body;
    if (!name) throw new ApiError(400, "Category name is required");

    const category = await PlatformCategory.create({
      name,
      image: image || null,
      displayOrder: displayOrder ?? 0,
    });

    ApiResponse.send(res, 201, "Category created", { category });
  } catch (error) {
    next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const category = await PlatformCategory.findById(req.params.id);
    if (!category) throw new ApiError(404, "Category not found");

    const { name, image, displayOrder, isActive } = req.body;
    if (name !== undefined) category.name = name;
    if (image !== undefined) category.image = image;
    if (displayOrder !== undefined) category.displayOrder = displayOrder;
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();
    ApiResponse.send(res, 200, "Category updated", { category });
  } catch (error) {
    next(error);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const category = await PlatformCategory.findByIdAndDelete(req.params.id);
    if (!category) throw new ApiError(404, "Category not found");
    ApiResponse.send(res, 200, "Category deleted");
  } catch (error) {
    next(error);
  }
};

module.exports = { getCategories, createCategory, updateCategory, deleteCategory };

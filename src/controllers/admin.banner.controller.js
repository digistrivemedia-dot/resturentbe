const Banner = require("../models/Banner");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

const getBanners = async (req, res, next) => {
  try {
    const { position, isActive } = req.query;

    const query = {};
    if (position) query.position = position;
    if (isActive !== undefined) query.isActive = isActive === "true";

    const banners = await Banner.find(query)
      .sort({ position: 1, sortOrder: 1 })
      .lean();

    return ApiResponse.send(res, 200, "Banners fetched", { banners });
  } catch (error) {
    next(error);
  }
};

const createBanner = async (req, res, next) => {
  try {
    const banner = await Banner.create({
      ...req.body,
      createdBy: req.user._id,
    });

    return ApiResponse.send(res, 201, "Banner created", { banner });
  } catch (error) {
    next(error);
  }
};

const updateBanner = async (req, res, next) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) {
      throw new ApiError(404, "Banner not found");
    }

    const allowed = [
      "title", "description", "image", "link", "linkType",
      "linkValue", "position", "sortOrder", "isActive",
      "startDate", "endDate",
    ];

    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        banner[field] = req.body[field];
      }
    });

    await banner.save();

    return ApiResponse.send(res, 200, "Banner updated", { banner });
  } catch (error) {
    next(error);
  }
};

const deleteBanner = async (req, res, next) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) {
      throw new ApiError(404, "Banner not found");
    }

    return ApiResponse.send(res, 200, "Banner deleted");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBanners,
  createBanner,
  updateBanner,
  deleteBanner,
};

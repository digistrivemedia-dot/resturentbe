const Review = require("../models/Review");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

const getReviews = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, rating } = req.query;

    const query = { restaurant: req.restaurant._id };

    if (rating) {
      query.foodRating = parseInt(rating);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate("customer", "name")
        .populate("order", "orderNumber")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Review.countDocuments(query),
    ]);

    return ApiResponse.send(res, 200, "Reviews fetched", {
      reviews,
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

const replyToReview = async (req, res, next) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      throw new ApiError(400, "Reply text is required");
    }

    const review = await Review.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
    });

    if (!review) {
      throw new ApiError(404, "Review not found");
    }

    review.reply = {
      text: text.trim(),
      repliedAt: new Date(),
    };

    await review.save();

    return ApiResponse.send(res, 200, "Reply added", { review });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getReviews,
  replyToReview,
};

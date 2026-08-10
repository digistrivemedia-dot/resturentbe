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

// GET /restaurant/reviews/item-ratings — per-dish rating breakdown, worst first
// so the admin immediately sees what's actually costing them stars.
const getItemRatings = async (req, res, next) => {
  try {
    const itemRatings = await Review.aggregate([
      { $match: { restaurant: req.restaurant._id } },
      { $unwind: "$itemRatings" },
      {
        $group: {
          _id: "$itemRatings.menuItem",
          name: { $first: "$itemRatings.name" },
          avgRating: { $avg: "$itemRatings.rating" },
          totalRatings: { $sum: 1 },
          lowRatingCount: { $sum: { $cond: [{ $lte: ["$itemRatings.rating", 2] }, 1, 0] } },
        },
      },
      { $sort: { avgRating: 1 } },
    ]);

    return ApiResponse.send(res, 200, "Item ratings fetched", {
      itemRatings: itemRatings.map((i) => ({
        menuItem: i._id,
        name: i.name,
        avgRating: Math.round(i.avgRating * 10) / 10,
        totalRatings: i.totalRatings,
        lowRatingCount: i.lowRatingCount,
      })),
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
  getItemRatings,
  replyToReview,
};

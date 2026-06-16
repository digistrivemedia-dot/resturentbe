const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: String,
    image: {
      type: String,
      required: true,
    },
    link: String,
    linkType: {
      type: String,
      enum: ["restaurant", "coupon", "category", "external", "none"],
      default: "none",
    },
    linkValue: String,
    position: {
      type: String,
      enum: ["hero", "middle", "bottom"],
      default: "hero",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    startDate: Date,
    endDate: Date,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

bannerSchema.index({ isActive: 1, position: 1, sortOrder: 1 });

module.exports = mongoose.model("Banner", bannerSchema);

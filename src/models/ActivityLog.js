const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    entity: {
      type: String,
      enum: ["restaurant", "customer", "order", "coupon", "banner", "settings", "notification"],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    details: String,
    ipAddress: String,
  },
  { timestamps: true }
);

activityLogSchema.index({ admin: 1, createdAt: -1 });
activityLogSchema.index({ entity: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);

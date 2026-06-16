const mongoose = require("mongoose");

const platformSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    category: {
      type: String,
      enum: ["general", "commission", "delivery", "payment", "notification", "maintenance"],
      default: "general",
    },
    description: String,
  },
  { timestamps: true }
);

platformSettingsSchema.index({ key: 1 });
platformSettingsSchema.index({ category: 1 });

module.exports = mongoose.model("PlatformSettings", platformSettingsSchema);

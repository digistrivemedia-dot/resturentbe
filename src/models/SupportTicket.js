const mongoose = require("mongoose");

const supportTicketSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
    },
    categoryLabel: String,
    subCategory: {
      type: String,
      required: true,
    },
    subCategoryLabel: String,
    // Only populated for item-specific sub-categories (missing item, wrong item, etc.) —
    // a snapshot of the affected order line(s), not a live ref, so it survives menu edits
    affectedItems: [
      {
        menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
        name: String,
        quantity: Number,
      },
    ],
    // Only set when the customer picked the "None of these" leaf option
    customMessage: String,
    status: {
      type: String,
      enum: ["open", "resolved"],
      default: "open",
      index: true,
    },
    messages: [
      {
        from: { type: String, enum: ["customer", "restaurant"], required: true },
        text: { type: String, required: true },
        at: { type: Date, default: Date.now },
      },
    ],
    resolvedAt: Date,
  },
  { timestamps: true }
);

supportTicketSchema.index({ restaurant: 1, status: 1, createdAt: -1 });
supportTicketSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model("SupportTicket", supportTicketSchema);

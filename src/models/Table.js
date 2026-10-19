const mongoose = require("mongoose");

// A physical table in the restaurant. Deliberately has NO occupancy/status
// field: a table is "occupied" because it has unbilled dine-in orders, which
// is derived at read time (see pos.controller.js getTables). Storing status
// here too would mean two sources of truth that drift the moment a waiter's
// tablet drops a request mid-order.
const tableSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    // What staff call it out loud — "7", "12", "T4", "Patio 2". String, not a
    // number, so renaming a table to "Patio 2" doesn't need a schema change.
    number: {
      type: String,
      required: true,
      trim: true,
    },
    seats: {
      type: Number,
      required: true,
      min: 1,
    },
    // Optional grouping for the floor plan — "Ground Floor", "AC", "Terrace".
    // Blank is fine; the grid just shows one unnamed section.
    zone: {
      type: String,
      trim: true,
      default: "",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    // Soft-disable so a table out of service keeps its past orders/bills
    // instead of being deleted and orphaning them.
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Two tables called "7" in one restaurant would make the waiter's grid
// ambiguous and the bill wrong — enforce at the DB, not just in the controller.
tableSchema.index({ restaurant: 1, number: 1 }, { unique: true });

module.exports = mongoose.model("Table", tableSchema);

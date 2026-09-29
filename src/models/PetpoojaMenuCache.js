const mongoose = require("mongoose");

// Raw catalogue Petpooja pushes to our Menu Sharing webhook whenever someone
// clicks "Menu Trigger" on their dashboard (see webhook.controller.js's
// handlePetpoojaMenuPush). Kept as Mixed/raw — Petpooja's exact Menu Push
// payload shape isn't in either PDF we have, so this stores whatever they
// send verbatim rather than guessing a strict schema. Restaurant owners still
// map individual MenuItem.petpooja.itemId by hand (PUT /restaurant/menu/:id)
// — this cache just gives them something to look at instead of Petpooja's
// own dashboard for that.
const petpoojaMenuCacheSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      unique: true,
    },
    restID: String,
    raw: mongoose.Schema.Types.Mixed,
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PetpoojaMenuCache", petpoojaMenuCacheSchema);

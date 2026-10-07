// node src/scripts/check-petpooja-state.js [restID]
//
// Prints what Petpooja's item on/off and store on/off webhooks actually did
// to our database. Run it before and after toggling something on their
// dashboard — the two outputs should differ in exactly the way you expect.
require("dotenv").config();
const mongoose = require("mongoose");

const restID = process.argv[2] || "t4pqh7yeaj";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;

  const restaurant = await db.collection("restaurants").findOne({
    "posIntegration.petpooja.restID": restID,
  });
  if (!restaurant) throw new Error(`No restaurant linked to restID ${restID}`);

  console.log(`\nSTORE  ${restaurant.name}`);
  console.log(`  timing.isOpen = ${restaurant.timing?.isOpen}   ${restaurant.timing?.isOpen ? "(OPEN)" : "(CLOSED)"}`);

  // Only items that are actually mapped to Petpooja can be toggled by them.
  const items = await db
    .collection("menuitems")
    .find({ restaurant: restaurant._id, "petpooja.itemId": { $exists: true, $ne: null, $ne: "" } })
    .project({ name: 1, isAvailable: 1, "petpooja.itemId": 1 })
    .toArray();

  console.log(`\nMAPPED ITEMS (${items.length})`);
  if (!items.length) {
    console.log("  none — no MenuItem has petpooja.itemId set, so Petpooja's");
    console.log("  item on/off webhook has nothing in our DB to toggle.");
  }
  for (const i of items) {
    console.log(`  ${i.petpooja.itemId.padEnd(10)} ${String(i.name).padEnd(28)} isAvailable=${i.isAvailable}`);
  }

  const off = items.filter((i) => i.isAvailable === false);
  console.log(`\n  ${off.length} currently OFF${off.length ? ": " + off.map((i) => i.name).join(", ") : ""}`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});

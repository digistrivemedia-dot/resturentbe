// node src/scripts/inspect-petpooja-menu.js [restID] [itemid]
//
// Dumps the ids you need to hand-build a Save Order payload out of the last
// Menu Push we cached (PetpoojaMenuCache.raw). Re-run after every "Menu
// Trigger" on the sandbox dashboard — the ids change when the menu changes.
require("dotenv").config();
const mongoose = require("mongoose");

const [, , restIDArg, itemIdArg] = process.argv;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

  const query = restIDArg ? { restID: restIDArg } : {};
  const cache = await mongoose.connection.db
    .collection("petpoojamenucaches")
    .findOne(query, { sort: { receivedAt: -1 } });

  if (!cache) throw new Error(`No cached menu${restIDArg ? ` for restID ${restIDArg}` : ""}`);

  const { items = [], addongroups = [], taxes = [], discounts = [] } = cache.raw || {};
  console.log(`restID ${cache.restID} — pushed ${cache.receivedAt.toISOString()}`);
  console.log(`items ${items.length} | addongroups ${addongroups.length} | taxes ${taxes.length} | discounts ${discounts.length}\n`);

  console.log("TAXES (-> item_tax[].id and Tax.details[].id)");
  for (const t of taxes) console.log(`  ${t.taxid}  ${t.taxname}  ${t.tax}%`);

  console.log("\nADDON GROUPS (-> AddonItem.details[]; group_id is an INT, not a string)");
  if (!addongroups.length) console.log("  NONE — tests 2 and 5 cannot be built until these exist");
  for (const g of addongroups) {
    console.log(`  group ${g.addongroupid} "${g.addongroup_name}"`);
    for (const a of g.addongroupitems || []) {
      console.log(`    addon ${a.addonitemid}  "${a.addonitem_name}"  Rs.${a.addonitem_price}`);
    }
  }

  if (itemIdArg) {
    const item = items.find((i) => String(i.itemid) === String(itemIdArg));
    console.log(`\nITEM ${itemIdArg}`);
    console.log(item ? JSON.stringify(item, null, 2) : "  not found");
  } else {
    // itemaddonbasedon "1" hangs the addon group off each variation instead of
    // the item, leaving item.addon empty — check both or variation items with
    // addons look unaddonned.
    const hasAddon = (i) =>
      i.itemallowaddon === "1" &&
      (i.addon?.length || i.variation?.some((v) => v.addon?.length));
    const withAddon = items.filter(hasAddon);
    const withVar = items.filter((i) => i.itemallowvariation === "1" && i.variation?.length);
    const withBoth = withAddon.filter((i) => withVar.includes(i));
    const line = (i) => `  ${i.itemid}  ${i.itemname}  Rs.${i.price}`;
    console.log(`\nITEMS WITH ADDONS (test 2) — ${withAddon.length}`);
    withAddon.slice(0, 10).forEach((i) => console.log(line(i)));
    console.log(`\nITEMS WITH ADDONS + VARIATION (test 5) — ${withBoth.length}`);
    withBoth.slice(0, 10).forEach((i) => console.log(line(i)));
    console.log("\nPass an itemid as the 2nd arg to dump one item in full.");
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});

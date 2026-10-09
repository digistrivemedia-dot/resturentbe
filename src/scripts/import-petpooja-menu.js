// node src/scripts/import-petpooja-menu.js [restID] [--apply]
//
// Rebuilds our MenuItem collection from Petpooja's cached Menu Push, keyed on
// petpooja.itemId. Petpooja becomes the source of truth: prices, stock,
// taxes, variations and addons all follow their catalogue, and item mapping
// stops being something anyone maintains by hand.
//
// Dry-run by default. ALWAYS read the dry run — this rewrites the menu
// customers order from, and the sandbox catalogue is a DEMO menu from a
// different city. Running --apply against the wrong catalogue replaces the
// real menu with someone else's.
//
// Rules:
//   - never hard-delete: Order.items[].menuItem points at these _ids, so
//     items dropped from the catalogue are deactivated instead.
//   - never touch items without a petpooja.itemId: those were hand-created,
//     so they get reported and left alone.
require("dotenv").config();
const mongoose = require("mongoose");
const MenuItem = require("../models/MenuItem");
const Restaurant = require("../models/Restaurant");
const PetpoojaMenuCache = require("../models/PetpoojaMenuCache");

const restID = process.argv[2] || "wjdmg6hr1o";
const APPLY = process.argv.includes("--apply");

const SPICE = { "not-applicable": "none", mild: "mild", medium: "medium", hot: "hot" };

// Variation items carry price "0" on the parent and the real price on each
// variation — show the cheapest so listings don't advertise free food.
function basePrice(it) {
  const p = Number(it.price) || 0;
  if (p > 0) return p;
  const prices = (it.variation || []).map((v) => Number(v.price) || 0).filter(Boolean);
  return prices.length ? Math.min(...prices) : 0;
}

function buildDoc(it, { categories, taxes, addonGroups }, restaurantId) {
  const addonIds = new Set();
  for (const a of it.addon || []) addonIds.add(String(a.addon_group_id));
  for (const v of it.variation || []) {
    for (const a of v.addon || []) addonIds.add(String(a.addon_group_id));
  }

  return {
    restaurant: restaurantId,
    category: categories.get(String(it.item_categoryid)) || "Uncategorised",
    name: it.itemname,
    description: it.itemdescription || "",
    image: it.item_image_url || undefined,
    price: basePrice(it),
    isVeg: String(it.item_attributeid) === "1",
    spiceLevel: SPICE[it.item_info?.spice_level] || "none",
    preparationTime: Number(it.minimumpreparationtime) || 15,
    sortOrder: Number(it.itemrank) || 0,
    // in_stock "0" is the only value that means out of stock; Petpooja uses
    // 1 and 2 for in-stock variants.
    isAvailable: String(it.in_stock) !== "0",
    status: String(it.active) === "1" ? "active" : "inactive",
    variants: (it.variation || []).map((v) => ({
      name: v.name,
      price: Number(v.price) || 0,
      // variation_id in Save Order is the per-item `id`, not the master
      // `variationid` — confirmed against order TESTORDER3003.
      petpoojaVariationId: String(v.id),
    })),
    addonGroups: [...addonIds]
      .map((gid) => addonGroups.get(gid))
      .filter(Boolean)
      .map((g) => ({
        name: g.addongroup_name,
        minSelection: 0,
        maxSelection: (g.addongroupitems || []).length || 1,
        addons: (g.addongroupitems || []).map((a) => ({
          name: a.addonitem_name,
          price: Number(a.addonitem_price) || 0,
          isAvailable: String(a.active ?? "1") === "1",
          petpoojaAddonItemId: String(a.addonitemid),
        })),
      })),
    petpooja: {
      itemId: String(it.itemid),
      taxes: String(it.item_tax || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => taxes.get(id))
        .filter(Boolean),
    },
  };
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

  const restaurant = await Restaurant.findOne({ "posIntegration.petpooja.restID": restID });
  if (!restaurant) throw new Error(`No restaurant for restID ${restID}`);

  const cacheDoc = await PetpoojaMenuCache.findOne({ restaurant: restaurant._id }).lean();
  const raw = cacheDoc?.raw;
  if (!raw?.items?.length) throw new Error("Menu cache is empty — run Menu Trigger first");

  const lookups = {
    categories: new Map((raw.categories || []).map((c) => [String(c.categoryid), c.categoryname])),
    addonGroups: new Map((raw.addongroups || []).map((g) => [String(g.addongroupid), g])),
    taxes: new Map(
      (raw.taxes || []).map((t) => [
        String(t.taxid),
        { id: String(t.taxid), name: t.taxname, taxPercentage: Number(t.tax) },
      ])
    ),
  };

  const existing = await MenuItem.find({ restaurant: restaurant._id }).lean();
  const byPpId = new Map(existing.filter((m) => m.petpooja?.itemId).map((m) => [String(m.petpooja.itemId), m]));
  const unmanaged = existing.filter((m) => !m.petpooja?.itemId);

  const pushedIds = new Set(raw.items.map((i) => String(i.itemid)));
  const toCreate = raw.items.filter((i) => !byPpId.has(String(i.itemid)));
  const toUpdate = raw.items.filter((i) => byPpId.has(String(i.itemid)));
  const toDeactivate = [...byPpId.values()].filter((m) => !pushedIds.has(String(m.petpooja.itemId)));

  console.log(`\n${restaurant.name}  (restID ${restID})`);
  console.log(`catalogue pushed ${cacheDoc.receivedAt.toISOString()} — ${raw.items.length} items`);
  console.log(`\n  CREATE      ${toCreate.length}`);
  console.log(`  UPDATE      ${toUpdate.length}`);
  console.log(`  DEACTIVATE  ${toDeactivate.length}   (gone from catalogue, never deleted)`);
  console.log(`  UNTOUCHED   ${unmanaged.length}   (no petpooja.itemId — hand-created)`);

  console.log(`\n--- sample of CREATE (first 15 of ${toCreate.length}) ---`);
  for (const it of toCreate.slice(0, 15)) {
    const d = buildDoc(it, lookups, restaurant._id);
    const extra = [
      d.variants.length ? `${d.variants.length}var` : "",
      d.addonGroups.length ? `${d.addonGroups.length}addon` : "",
    ].filter(Boolean).join(" ");
    console.log(`  ${String(it.itemid).padEnd(9)} ${String(d.category).slice(0,16).padEnd(17)} ${String(d.name).slice(0,32).padEnd(34)} Rs.${String(d.price).padEnd(7)} ${extra}`);
  }

  if (toDeactivate.length) {
    console.log(`\n--- would DEACTIVATE (${toDeactivate.length}) ---`);
    toDeactivate.slice(0, 20).forEach((m) => console.log(`  ${m.petpooja.itemId}  ${m.name}`));
  }

  if (unmanaged.length) {
    console.log(`\n--- UNTOUCHED, no Petpooja counterpart (${unmanaged.length}) ---`);
    unmanaged.slice(0, 15).forEach((m) => console.log(`  ${m.name}`));
    if (unmanaged.length > 15) console.log(`  ...and ${unmanaged.length - 15} more`);
    console.log(`  These stay orderable but will NEVER reach Petpooja.`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written.`);
    console.log(`Check the catalogue above is THIS outlet's real menu before using --apply.`);
    await mongoose.disconnect();
    return;
  }

  let created = 0;
  let updated = 0;
  for (const it of raw.items) {
    const doc = buildDoc(it, lookups, restaurant._id);
    const match = byPpId.get(String(it.itemid));
    if (match) {
      await MenuItem.updateOne({ _id: match._id }, { $set: doc });
      updated += 1;
    } else {
      await MenuItem.create(doc);
      created += 1;
    }
  }

  let deactivated = 0;
  for (const m of toDeactivate) {
    await MenuItem.updateOne({ _id: m._id }, { $set: { status: "inactive", isAvailable: false } });
    deactivated += 1;
  }

  console.log(`\nAPPLIED — created ${created}, updated ${updated}, deactivated ${deactivated}.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});

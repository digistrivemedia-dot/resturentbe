// node src/scripts/map-petpooja-items.js [restID] [--apply]
//
// Matches our MenuItems against the cached Petpooja catalogue by name and
// fills MenuItem.petpooja.itemId (plus variant petpoojaVariationId and addon
// petpoojaAddonItemId where they line up).
//
// Dry-run by default — prints what it WOULD do and writes nothing. Pass
// --apply to commit. Always read the dry run first: a wrong itemId sends a
// real order to the wrong dish, which is worse than no mapping at all.
require("dotenv").config();
const mongoose = require("mongoose");

const restID = process.argv[2] || "wjdmg6hr1o";
const APPLY = process.argv.includes("--apply");

// Names drift between the two systems in predictable ways: "(2 Pcs)",
// trailing "- Half", punctuation, double spaces. Normalise those away before
// comparing, but never merge two genuinely different dishes.
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")       // "(2 Pcs)", "(Half)"
    .replace(/[^a-z0-9]+/g, " ")    // punctuation -> space
    .replace(/\s+/g, " ")
    .trim();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;

  const restaurant = await db.collection("restaurants").findOne({
    "posIntegration.petpooja.restID": restID,
  });
  if (!restaurant) throw new Error(`No restaurant for restID ${restID}`);

  const cache = await db.collection("petpoojamenucaches").findOne({ restID });
  const ppItems = cache?.raw?.items || [];
  if (!ppItems.length) throw new Error("Menu cache is empty — run Menu Trigger first");

  const ours = await db
    .collection("menuitems")
    .find({ restaurant: restaurant._id })
    .project({ name: 1, petpooja: 1, variants: 1 })
    .toArray();

  // Group Petpooja items by normalised name so collisions are visible rather
  // than silently resolved to whichever happened to be first.
  const ppByName = new Map();
  for (const p of ppItems) {
    const k = norm(p.itemname);
    if (!ppByName.has(k)) ppByName.set(k, []);
    ppByName.get(k).push(p);
  }

  const matched = [];
  const ambiguous = [];
  const unmatched = [];

  for (const item of ours) {
    const candidates = ppByName.get(norm(item.name)) || [];
    if (candidates.length === 1) matched.push({ item, pp: candidates[0] });
    else if (candidates.length > 1) ambiguous.push({ item, candidates });
    else unmatched.push(item);
  }

  const usedPpIds = new Set(matched.map((m) => String(m.pp.itemid)));
  const unusedPp = ppItems.filter((p) => !usedPpIds.has(String(p.itemid)));

  console.log(`\n${restaurant.name} — ours ${ours.length} | petpooja ${ppItems.length}`);
  console.log(`MATCHED ${matched.length} | AMBIGUOUS ${ambiguous.length} | UNMATCHED ${unmatched.length}`);

  console.log(`\n--- MATCHED (${matched.length}) ---`);
  for (const m of matched.slice(0, 200)) {
    const v = m.pp.variation?.length ? `  [${m.pp.variation.length} variation(s)]` : "";
    console.log(`  ${String(m.pp.itemid).padEnd(9)} ${String(m.item.name).slice(0, 38).padEnd(40)} -> ${m.pp.itemname}${v}`);
  }

  if (ambiguous.length) {
    console.log(`\n--- AMBIGUOUS, left alone (${ambiguous.length}) ---`);
    for (const a of ambiguous) {
      console.log(`  ${a.item.name}  ->  ${a.candidates.map((c) => `${c.itemid}:${c.itemname}`).join(" | ")}`);
    }
  }

  console.log(`\n--- UNMATCHED ours (${unmatched.length}) ---`);
  unmatched.slice(0, 60).forEach((i) => console.log(`  ${i.name}`));
  if (unmatched.length > 60) console.log(`  ...and ${unmatched.length - 60} more`);

  console.log(`\n--- PETPOOJA items nothing mapped to (${unusedPp.length}) ---`);
  unusedPp.slice(0, 40).forEach((p) => console.log(`  ${p.itemid}  ${p.itemname}`));
  if (unusedPp.length > 40) console.log(`  ...and ${unusedPp.length - 40} more`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to commit ${matched.length} mappings.`);
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  let variantsWritten = 0;
  for (const { item, pp } of matched) {
    const set = { "petpooja.itemId": String(pp.itemid) };

    // Variation items: match our variant names to theirs. The id Petpooja
    // wants in variation_id is the per-item `id`, not the master
    // `variationid` — confirmed against order TESTORDER3003.
    if (item.variants?.length && pp.variation?.length) {
      item.variants.forEach((v, idx) => {
        const hit = pp.variation.find((pv) => norm(pv.name) === norm(v.name));
        if (hit) {
          set[`variants.${idx}.petpoojaVariationId`] = String(hit.id);
          variantsWritten += 1;
        }
      });
    }

    await db.collection("menuitems").updateOne({ _id: item._id }, { $set: set });
    written += 1;
  }

  console.log(`\nAPPLIED — ${written} items, ${variantsWritten} variants mapped.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});

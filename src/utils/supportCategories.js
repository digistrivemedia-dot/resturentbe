// Canonical customer-support category tree — single source of truth, served to
// both web and mobile via GET /support/categories so the option set never drifts
// between clients. Every leaf ends in an "other" option that unlocks free text —
// that's the only way a ticket can carry a customMessage.
const SUPPORT_CATEGORIES = [
  {
    key: "missing_wrong_items",
    label: "Missing / Wrong Items",
    subCategories: [
      { key: "items_missing", label: "Item(s) missing from my order", requiresItems: true },
      { key: "wrong_item", label: "Wrong item delivered (got something I didn't order)", requiresItems: true },
      { key: "less_quantity", label: "Received less quantity than ordered", requiresItems: true },
      { key: "extra_item", label: "Extra item I never ordered was included", requiresItems: false },
      { key: "completely_different_order", label: "Entire order was someone else's / completely different order", requiresItems: false },
      { key: "addon_missing", label: "Addon / customization missing", requiresItems: true },
      { key: "other", label: "None of these — describe my issue", isOther: true },
    ],
  },
  {
    key: "food_quality",
    label: "Food Quality",
    subCategories: [
      { key: "cold_food", label: "Food arrived cold", requiresItems: true },
      { key: "stale_spoiled", label: "Food is stale or spoiled", requiresItems: true },
      { key: "taste_issue", label: "Food tastes different / not up to usual quality", requiresItems: true },
      { key: "foreign_object", label: "Found a foreign object in the food", requiresItems: true },
      { key: "raw_overcooked", label: "Food was raw, overcooked, or burnt", requiresItems: true },
      { key: "damaged_packaging", label: "Packaging was damaged or leaking", requiresItems: false },
      { key: "small_portion", label: "Portion size smaller than expected", requiresItems: true },
      { key: "other", label: "None of these — describe my issue", isOther: true },
    ],
  },
  {
    key: "delivery_problems",
    label: "Delivery Problems",
    deliveryOnly: true,
    subCategories: [
      { key: "late_delivery", label: "Order delivered late" },
      { key: "never_arrived", label: "Order never arrived" },
      { key: "rider_rude", label: "Delivery partner was rude or unprofessional" },
      { key: "rider_extra_money", label: "Delivery partner asked for extra money" },
      { key: "wrong_address", label: "Delivered to the wrong address" },
      { key: "rider_unreachable", label: "Couldn't reach the delivery partner" },
      { key: "instructions_ignored", label: "Delivery instructions not followed" },
      { key: "stolen_by_other", label: "Someone else collected my order" },
      { key: "other", label: "None of these — describe my issue", isOther: true },
    ],
  },
  {
    key: "cancellation_problems",
    label: "Cancellation Problems",
    subCategories: [
      { key: "restaurant_cancelled", label: "Restaurant cancelled my order" },
      { key: "slow_acceptance", label: "Restaurant is taking too long to accept my order" },
      { key: "cant_cancel", label: "I want to cancel but the app isn't letting me" },
      { key: "auto_cancelled", label: "Order got auto-cancelled without me doing anything" },
      { key: "marked_complete_not_received", label: "Order marked complete/delivered but I never received it" },
      { key: "other", label: "None of these — describe my issue", isOther: true },
    ],
  },
  {
    key: "payment_refund",
    label: "Payment & Refund",
    subCategories: [
      { key: "deducted_not_placed", label: "Money deducted but order was not placed" },
      { key: "overcharged", label: "Charged more than the total shown at checkout" },
      { key: "refund_not_received", label: "Refund not received for a cancelled or failed order" },
      { key: "refund_less", label: "Refund amount is less than expected" },
      { key: "coupon_not_applied", label: "Coupon/discount didn't apply correctly" },
      { key: "cod_mismatch", label: "Cash on Delivery amount differs from the app total" },
      { key: "fee_incorrect", label: "Platform fee or delivery fee charged incorrectly" },
      { key: "membership_discount_missing", label: "Membership discount didn't apply" },
      { key: "other", label: "None of these — describe my issue", isOther: true },
    ],
  },
  {
    key: "restaurant_experience",
    label: "Restaurant Experience",
    subCategories: [
      { key: "shown_open_but_closed", label: "Restaurant shows \"Open\" on the app but was actually closed" },
      { key: "refused_service", label: "Restaurant refused to serve/hand over my order" },
      { key: "long_wait", label: "Long wait time at the restaurant" },
      { key: "staff_rude", label: "Restaurant staff were rude or unhelpful" },
      { key: "hygiene", label: "Hygiene concerns at the restaurant" },
      { key: "no_seating", label: "Table/seating wasn't available (dine-in)" },
      { key: "other", label: "None of these — describe my issue", isOther: true },
    ],
  },
];

function findSubCategory(categoryKey, subCategoryKey) {
  const category = SUPPORT_CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) return null;
  const subCategory = category.subCategories.find((s) => s.key === subCategoryKey);
  if (!subCategory) return null;
  return { category, subCategory };
}

module.exports = { SUPPORT_CATEGORIES, findSubCategory };

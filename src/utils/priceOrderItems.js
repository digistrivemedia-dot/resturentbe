const MenuItem = require("../models/MenuItem");
const MenuCategory = require("../models/MenuCategory");
const ApiError = require("../utils/ApiError");
const { isCategoryAvailableNow } = require("./categoryAvailability");

// Validates a cart's items against the live menu and prices them server-side.
// Extracted from order.controller.js placeOrder so the dine-in POS
// (pos.controller.js) prices items identically — a customer and a waiter
// ordering the same dish must never get different numbers.
//
// Never trusts client-supplied prices: the name/price/addon costs all come
// from the MenuItem doc, and anything unavailable or any addon that isn't
// actually on the item is rejected.
async function priceOrderItems(items, restaurantId) {
  let subtotal = 0;
  const validatedItems = [];

  // Fetched once (not per-item) — a restaurant only has a handful of categories
  const categoryDocs = await MenuCategory.find({ restaurant: restaurantId }).lean();
  const categoryDocMap = {};
  categoryDocs.forEach((c) => { categoryDocMap[c.name] = c; });

  for (const cartItem of items) {
    const menuItem = await MenuItem.findById(cartItem.menuItemId);
    if (!menuItem || menuItem.status !== "active" || !menuItem.isAvailable) {
      throw new ApiError(400, `Item "${cartItem.name || "Unknown"}" is not available`);
    }
    // An item from a different restaurant would otherwise price and sell fine
    // — a cross-restaurant cart must not be possible.
    if (menuItem.restaurant.toString() !== restaurantId.toString()) {
      throw new ApiError(400, `Item "${menuItem.name}" does not belong to this restaurant`);
    }
    if (!isCategoryAvailableNow(categoryDocMap[menuItem.category])) {
      throw new ApiError(400, `"${menuItem.category}" is not available right now`);
    }

    // Determine base price (from variant or item)
    let basePrice = menuItem.price;
    let variantData = null;
    if (cartItem.variant?.name) {
      const matchedVariant = menuItem.variants?.find(
        (v) => v.name === cartItem.variant.name
      );
      if (matchedVariant) {
        basePrice = matchedVariant.price;
        variantData = { name: matchedVariant.name, price: matchedVariant.price };
      }
    }

    // Use discountedPrice if available
    const effectivePrice = menuItem.discountedPrice && menuItem.discountedPrice < basePrice
      ? menuItem.discountedPrice
      : basePrice;

    // Validate addons
    let addonsTotal = 0;
    const validatedAddons = [];
    if (cartItem.addons?.length) {
      for (const addon of cartItem.addons) {
        // Find matching addon in the menu item's addonGroups
        let matched = false;
        for (const group of menuItem.addonGroups || []) {
          const matchedAddon = group.addons?.find((a) => a.name === addon.name);
          if (matchedAddon) {
            addonsTotal += matchedAddon.price;
            validatedAddons.push({
              groupName: group.name,
              name: matchedAddon.name,
              price: matchedAddon.price,
            });
            matched = true;
            break;
          }
        }
        if (!matched) {
          throw new ApiError(400, `Addon "${addon.name}" is not valid for "${menuItem.name}"`);
        }
      }
    }

    const quantity = cartItem.quantity || 1;
    const itemTotal = (effectivePrice + addonsTotal) * quantity;
    subtotal += itemTotal;

    validatedItems.push({
      menuItem: menuItem._id,
      name: menuItem.name,
      quantity,
      price: effectivePrice,
      variant: variantData,
      addons: validatedAddons,
      specialInstructions: cartItem.specialInstructions || "",
      itemTotal,
      isVeg: menuItem.isVeg,
    });
  }

  return { validatedItems, subtotal };
}

module.exports = priceOrderItems;

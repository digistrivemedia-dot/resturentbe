const Cart = require("../models/Cart");
const ApiResponse = require("../utils/ApiResponse");

// GET /customer/cart
const getCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ customer: req.user._id })
      .populate("restaurant", "name slug address deliverySettings status")
      .lean();

    if (cart?.restaurant) {
      // Reshape to the exact flattened object every addItem() call site builds
      // client-side (MenuItemCard/AddonSelector/HomeFoodCard/favorites) —
      // otherwise a cart hydrated from the server after a reload would carry
      // restaurant.deliverySettings.deliveryFee instead of restaurant.deliveryFee,
      // silently breaking delivery-fee math instead of failing loudly.
      const r = cart.restaurant;
      if (r.status && r.status !== "active") {
        // Restaurant went inactive/suspended since the cart was built — same
        // as a deleted restaurant, this cart can no longer be checked out.
        cart.restaurant = null;
      } else {
        cart.restaurant = {
          _id: r._id,
          name: r.name,
          slug: r.slug,
          address: r.address,
          deliveryFee: r.deliverySettings?.deliveryFee || 0,
          freeDeliveryAbove: r.deliverySettings?.freeDeliveryAbove,
          minOrderAmount: r.deliverySettings?.minOrderAmount || 0,
        };
      }
    }

    return ApiResponse.send(res, 200, "Cart fetched", { cart: cart || null });
  } catch (error) {
    next(error);
  }
};

// PUT /customer/cart — upsert the full cart state (mirrors client store on every change)
const syncCart = async (req, res, next) => {
  try {
    const { restaurant, items, coupon, tip, orderType, orderTypeLocked } = req.body;

    const cart = await Cart.findOneAndUpdate(
      { customer: req.user._id },
      {
        customer: req.user._id,
        restaurant: restaurant?._id || restaurant || null,
        items: items || [],
        coupon: coupon || null,
        tip: tip || 0,
        orderType: orderType || "delivery",
        orderTypeLocked: !!orderTypeLocked,
      },
      { new: true, upsert: true }
    ).lean();

    return ApiResponse.send(res, 200, "Cart synced", { cart });
  } catch (error) {
    next(error);
  }
};

// DELETE /customer/cart
const clearCartRemote = async (req, res, next) => {
  try {
    await Cart.deleteOne({ customer: req.user._id });
    return ApiResponse.send(res, 200, "Cart cleared");
  } catch (error) {
    next(error);
  }
};

module.exports = { getCart, syncCart, clearCartRemote };

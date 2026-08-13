const Cart = require("../models/Cart");
const ApiResponse = require("../utils/ApiResponse");

// GET /customer/cart
const getCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ customer: req.user._id }).lean();
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

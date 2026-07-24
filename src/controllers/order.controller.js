const Order = require("../models/Order");
const MenuItem = require("../models/MenuItem");
const Restaurant = require("../models/Restaurant");
const Coupon = require("../models/Coupon");
const Notification = require("../models/Notification");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { ORDER_STATUS, PAYMENT_STATUS } = require("../utils/constants");
const { getIo } = require("../socket");
const { createRazorpayOrder, verifyPaymentSignature } = require("../services/razorpay.service");

// POST /orders — Place a new order
const placeOrder = async (req, res, next) => {
  try {
    const {
      restaurantId,
      items,
      deliveryAddress,
      orderType,
      scheduledFor,
      paymentMethod,
      couponCode,
      tip,
    } = req.body;
    const normalizedOrderType = orderType || "delivery";
    const isDeliveryOrder = normalizedOrderType === "delivery";
    const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;

    if (scheduledDate && (Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date())) {
      throw new ApiError(400, "Scheduled time must be in the future");
    }

    // 1. Validate restaurant
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant || restaurant.status !== "active") {
      throw new ApiError(400, "Restaurant is not available");
    }

    // 2. Validate and calculate items server-side
    let subtotal = 0;
    const validatedItems = [];

    for (const cartItem of items) {
      const menuItem = await MenuItem.findById(cartItem.menuItemId);
      if (!menuItem || menuItem.status !== "active" || !menuItem.isAvailable) {
        throw new ApiError(400, `Item "${cartItem.name || "Unknown"}" is not available`);
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

    // 4. Calculate delivery fee
    const { deliverySettings } = restaurant;
    let deliveryFee = 0;
    if (isDeliveryOrder) {
      deliveryFee = deliverySettings?.deliveryFee || 0;
      if (
        deliverySettings?.freeDeliveryAbove &&
        subtotal >= deliverySettings.freeDeliveryAbove
      ) {
        deliveryFee = 0;
      }
    }

    // 5. Apply coupon if provided
    let couponDiscount = 0;
    let appliedCouponCode = null;
    if (couponCode) {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase(),
        isActive: true,
        validFrom: { $lte: new Date() },
        validUntil: { $gte: new Date() },
      });

      if (coupon) {
        // Check scope
        if (
          coupon.scope === "restaurant" &&
          coupon.restaurant?.toString() !== restaurantId
        ) {
          throw new ApiError(400, "Coupon is not valid for this restaurant");
        }

        // Check min order
        if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount) {
          throw new ApiError(
            400,
            `Minimum order of ₹${coupon.minOrderAmount} required for this coupon`
          );
        }

        // Check usage limit
        if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
          throw new ApiError(400, "Coupon usage limit exceeded");
        }

        // Check per-user limit
        if (coupon.perUserLimit) {
          const userUsage = await Order.countDocuments({
            customer: req.user._id,
            "pricing.couponCode": coupon.code,
            status: { $ne: ORDER_STATUS.CANCELLED },
          });
          if (userUsage >= coupon.perUserLimit) {
            throw new ApiError(400, "You have already used this coupon");
          }
        }

        // Calculate discount
        const isItemLevel = coupon.applicableItems && coupon.applicableItems.length > 0;
        if (coupon.type === "free_delivery") {
          // Will be subtracted from deliveryFee in totals below; store as-is for now
          couponDiscount = 0; // set after deliveryFee is known
        } else if (isItemLevel) {
          const applicableIds = coupon.applicableItems.map((id) => id.toString());
          const applicableTotal = items.reduce((sum, item) => {
            if (applicableIds.includes(item.menuItem?.toString())) {
              return sum + item.price * (item.quantity || 1);
            }
            return sum;
          }, 0);
          if (coupon.type === "percentage") {
            couponDiscount = (applicableTotal * coupon.value) / 100;
            if (coupon.maxDiscount) couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
          } else {
            couponDiscount = Math.min(coupon.value, applicableTotal);
          }
        } else if (coupon.type === "percentage") {
          couponDiscount = (subtotal * coupon.value) / 100;
          if (coupon.maxDiscount) {
            couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
          }
        } else {
          couponDiscount = coupon.value;
        }

        couponDiscount = Math.round(couponDiscount * 100) / 100;
        appliedCouponCode = coupon.code;

        // Increment usage
        coupon.usedCount += 1;
        await coupon.save();
      }
    }

    // 6. Calculate totals
    // Resolve free_delivery coupon discount now that deliveryFee is known
    if (appliedCouponCode) {
      const appliedCoupon = await Coupon.findOne({ code: appliedCouponCode }).lean();
      if (appliedCoupon?.type === "free_delivery") {
        couponDiscount = deliveryFee;
      }
    }

    const taxPercentage = 5;
    const taxAmount = Math.round(subtotal * (taxPercentage / 100) * 100) / 100;
    const platformFee = 3;
    const tipAmount = isDeliveryOrder ? tip || 0 : 0;
    const total = Math.round(
      (subtotal + deliveryFee + taxAmount + platformFee + tipAmount - couponDiscount) * 100
    ) / 100;

    // 7. Create order
    const isOnlinePayment = paymentMethod === "online";
    const order = new Order({
      customer: req.user._id,
      restaurant: restaurant._id,
      items: validatedItems,
      pricing: {
        subtotal,
        deliveryFee,
        taxAmount,
        taxPercentage,
        discount: couponDiscount,
        couponCode: appliedCouponCode,
        couponDiscount,
        packagingCharge: 0,
        platformFee,
        tip: tipAmount,
        total,
      },
      deliveryAddress: isDeliveryOrder ? deliveryAddress : undefined,
      restaurantAddress: restaurant.address,
      orderType: normalizedOrderType,
      scheduledFor: scheduledDate || null,
      paymentMethod: paymentMethod || "cod",
      paymentStatus: PAYMENT_STATUS.PENDING,
      estimatedDeliveryTime: deliverySettings?.avgDeliveryTime || 30,
      status: isOnlinePayment ? ORDER_STATUS.PENDING_PAYMENT : ORDER_STATUS.PLACED,
      statusHistory: [
        {
          status: isOnlinePayment ? ORDER_STATUS.PENDING_PAYMENT : ORDER_STATUS.PLACED,
          timestamp: new Date(),
          updatedBy: req.user._id,
        },
      ],
    });

    // 8. For online payments — create Razorpay order and return details
    if (isOnlinePayment) {
      const rzpOrder = await createRazorpayOrder(total, order._id.toString(), {
        orderNumber: order.orderNumber,
      });
      order.razorpayOrderId = rzpOrder.id;
      await order.save();

      return ApiResponse.send(res, 201, "Order created, complete payment", {
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          pricing: order.pricing,
        },
        razorpay: {
          orderId: rzpOrder.id,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
          keyId: process.env.RAZORPAY_KEY_ID,
        },
      });
    }

    // 9. For COD — auto-confirm the order immediately
    await order.save();

    order.status = ORDER_STATUS.CONFIRMED;
    order.statusHistory.push({
      status: ORDER_STATUS.CONFIRMED,
      timestamp: new Date(),
      updatedBy: req.user._id,
      note: "Auto-confirmed",
    });
    await order.save();

    // 10. Create notification for customer
    await Notification.create({
      user: req.user._id,
      title: "Order Confirmed!",
      message: `Your order #${order.orderNumber} from ${restaurant.name} has been confirmed.`,
      type: "order",
      data: { orderId: order._id, restaurantId: restaurant._id },
    });

    // Populate for response
    const populatedOrder = await Order.findById(order._id)
      .populate("restaurant", "name slug deliverySettings address")
      .lean();

    // Notify restaurant in real time
    try {
      const io = getIo();
      if (io) {
        io.to(`restaurant:${restaurant._id}`).emit("new_order", { order: populatedOrder });
        io.to(`restaurant:${restaurant._id}`).emit("order_status_updated", { order: populatedOrder });
      }
    } catch (e) {}

    ApiResponse.send(res, 201, "Order placed successfully", {
      order: populatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

// GET /orders — My orders
const getMyOrders = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const filter = { customer: req.user._id };

    if (status) {
      if (status === "active") {
        filter.status = {
          $in: [
            ORDER_STATUS.PENDING_PAYMENT,
            ORDER_STATUS.PLACED,
            ORDER_STATUS.CONFIRMED,
            ORDER_STATUS.PREPARING,
            ORDER_STATUS.READY,
            ORDER_STATUS.PICKED_UP,
            ORDER_STATUS.OUT_FOR_DELIVERY,
          ],
        };
      } else {
        filter.status = status;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("restaurant", "name slug cuisines rating address")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Order.countDocuments(filter),
    ]);

    ApiResponse.send(res, 200, "Orders fetched", {
      orders,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /orders/:id — Order detail
const getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      customer: req.user._id,
    })
      .populate("restaurant", "name slug cuisines rating deliverySettings address phone")
      .lean();

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    ApiResponse.send(res, 200, "Order fetched", { order });
  } catch (error) {
    next(error);
  }
};

// POST /orders/:id/cancel — Cancel order
const cancelOrder = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const order = await Order.findOne({
      _id: req.params.id,
      customer: req.user._id,
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Only allow cancellation for placed or confirmed orders
    const cancellableStatuses = [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PLACED, ORDER_STATUS.CONFIRMED];
    if (!cancellableStatuses.includes(order.status)) {
      throw new ApiError(400, "Order cannot be cancelled at this stage");
    }

    order.status = ORDER_STATUS.CANCELLED;
    order.cancellation = {
      cancelledBy: "customer",
      reason: reason || "Cancelled by customer",
      refundAmount: order.pricing.total,
      refundStatus: order.paymentMethod === "cod" ? "processed" : "pending",
    };

    await order.save();

    // Create notification
    await Notification.create({
      user: req.user._id,
      title: "Order Cancelled",
      message: `Your order #${order.orderNumber} has been cancelled.`,
      type: "order",
      data: { orderId: order._id },
    });

    ApiResponse.send(res, 200, "Order cancelled", { order });
  } catch (error) {
    next(error);
  }
};

// POST /orders/:id/rate — Rate order
const rateOrder = async (req, res, next) => {
  try {
    const { foodRating, deliveryRating, review } = req.body;
    const order = await Order.findOne({
      _id: req.params.id,
      customer: req.user._id,
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    if (order.status !== ORDER_STATUS.DELIVERED) {
      throw new ApiError(400, "Can only rate delivered orders");
    }

    if (order.rating?.foodRating) {
      throw new ApiError(400, "Order has already been rated");
    }

    order.rating = {
      foodRating,
      deliveryRating,
      review: review || "",
      ratedAt: new Date(),
    };

    await order.save();

    // Update restaurant average rating
    const ratingAgg = await Order.aggregate([
      {
        $match: {
          restaurant: order.restaurant,
          "rating.foodRating": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$rating.foodRating" },
          totalReviews: { $sum: 1 },
        },
      },
    ]);

    if (ratingAgg.length > 0) {
      await Restaurant.findByIdAndUpdate(order.restaurant, {
        "rating.average": Math.round(ratingAgg[0].avgRating * 10) / 10,
        "rating.totalReviews": ratingAgg[0].totalReviews,
      });
    }

    ApiResponse.send(res, 200, "Rating submitted", { order });
  } catch (error) {
    next(error);
  }
};

// POST /orders/verify-payment — Verify Razorpay payment and confirm order
const verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // 1. Find order by razorpayOrderId
    const order = await Order.findOne({
      razorpayOrderId: razorpay_order_id,
      customer: req.user._id,
    });
    if (!order) {
      throw new ApiError(404, "Order not found");
    }
    if (order.paymentStatus === PAYMENT_STATUS.PAID) {
      throw new ApiError(400, "Payment already verified");
    }

    // 2. Verify signature
    const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      order.paymentStatus = PAYMENT_STATUS.FAILED;
      order.status = ORDER_STATUS.CANCELLED;
      order.statusHistory.push({
        status: ORDER_STATUS.CANCELLED,
        timestamp: new Date(),
        note: "Payment verification failed",
      });
      await order.save();
      throw new ApiError(400, "Payment verification failed");
    }

    // 3. Mark as paid and confirm
    order.paymentId = razorpay_payment_id;
    order.paymentStatus = PAYMENT_STATUS.PAID;
    order.status = ORDER_STATUS.CONFIRMED;
    order.statusHistory.push(
      { status: ORDER_STATUS.PLACED, timestamp: new Date(), note: "Payment verified" },
      { status: ORDER_STATUS.CONFIRMED, timestamp: new Date(), updatedBy: req.user._id, note: "Auto-confirmed after payment" }
    );
    await order.save();

    // 4. Create notification
    const restaurant = await Restaurant.findById(order.restaurant);
    await Notification.create({
      user: req.user._id,
      title: "Order Confirmed!",
      message: `Your order #${order.orderNumber} from ${restaurant.name} has been confirmed.`,
      type: "order",
      data: { orderId: order._id, restaurantId: order.restaurant },
    });

    // 5. Populate and notify restaurant
    const populatedOrder = await Order.findById(order._id)
      .populate("restaurant", "name slug deliverySettings address")
      .lean();

    try {
      const io = getIo();
      if (io) {
        io.to(`restaurant:${order.restaurant}`).emit("new_order", { order: populatedOrder });
        io.to(`restaurant:${order.restaurant}`).emit("order_status_updated", { order: populatedOrder });
      }
    } catch (e) {}

    ApiResponse.send(res, 200, "Payment verified, order confirmed", {
      order: populatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  placeOrder,
  verifyPayment,
  getMyOrders,
  getOrderById,
  cancelOrder,
  rateOrder,
};

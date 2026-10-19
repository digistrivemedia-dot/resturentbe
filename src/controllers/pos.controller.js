const Table = require("../models/Table");
const Order = require("../models/Order");
const Bill = require("../models/Bill");
const MenuItem = require("../models/MenuItem");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { ORDER_STATUS } = require("../utils/constants");
const { getIo } = require("../socket");
const priceOrderItems = require("../utils/priceOrderItems");
const { computeBillTotals, createBillQr, closeBillQr } = require("../services/billing.service");

// Statuses a dine-in order passes through on the floor. Reuses the existing
// ORDER_STATUS values rather than inventing a parallel set:
//   confirmed -> preparing -> ready -> delivered ("served")
// A dine-in order starts CONFIRMED because a waiter taking it in person IS
// the acceptance step — there's nothing for the restaurant to accept.
const RUNNING_STATUSES = [
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY,
  ORDER_STATUS.DELIVERED,
];

// A table's state is derived from its unbilled orders, never stored — see the
// comment in models/Table.js for why.
function deriveTableStatus(orders) {
  if (orders.length === 0) return "free";
  if (orders.some((o) => o.status === ORDER_STATUS.READY)) return "ready"; // food waiting to be picked up
  if (orders.some((o) => o.status === ORDER_STATUS.PREPARING || o.status === ORDER_STATUS.CONFIRMED)) {
    return "preparing";
  }
  return "served"; // everything served, nothing billed yet — the tab is open
}

// GET /pos/tables — the floor grid. One query for tables, one for every
// unbilled order across the restaurant, zipped in memory; a 25-table cafe
// never has enough live orders for this to be worth N queries.
const getTables = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;

    const [tables, runningOrders] = await Promise.all([
      Table.find({ restaurant: restaurantId, isActive: true })
        .sort({ sortOrder: 1, number: 1 })
        .lean(),
      Order.find({
        restaurant: restaurantId,
        table: { $ne: null },
        bill: null,
        status: { $in: RUNNING_STATUSES },
      })
        .select("table status pricing.total placedBy createdAt orderNumber")
        .populate("placedBy", "name")
        .lean(),
    ]);

    const byTable = {};
    for (const order of runningOrders) {
      const key = order.table.toString();
      (byTable[key] ||= []).push(order);
    }

    const result = tables.map((table) => {
      const orders = byTable[table._id.toString()] || [];
      return {
        ...table,
        status: deriveTableStatus(orders),
        runningOrders: orders.length,
        runningTotal: Math.round(orders.reduce((s, o) => s + (o.pricing?.total || 0), 0) * 100) / 100,
        // Who's looking after this table — the waiter on its earliest open order.
        servedBy: orders.length
          ? orders.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0].placedBy
          : null,
        occupiedSince: orders.length
          ? orders.reduce((min, o) => (new Date(o.createdAt) < new Date(min) ? o.createdAt : min), orders[0].createdAt)
          : null,
      };
    });

    return ApiResponse.send(res, 200, "Tables fetched", { tables: result });
  } catch (error) {
    next(error);
  }
};

// GET /pos/menu — same shape as the owner's menu endpoint, minus unavailable
// items (a waiter must never be shown something they can't sell).
const getMenu = async (req, res, next) => {
  try {
    const items = await MenuItem.find({
      restaurant: req.restaurant._id,
      status: "active",
      isAvailable: true,
    })
      .sort({ category: 1, sortOrder: 1 })
      .lean();

    const grouped = {};
    for (const item of items) {
      (grouped[item.category] ||= []).push(item);
    }
    const menu = Object.keys(grouped).map((category) => ({ category, items: grouped[category] }));

    return ApiResponse.send(res, 200, "Menu fetched", { menu });
  } catch (error) {
    next(error);
  }
};

// GET /pos/tables/:id — everything running on one table, for the order screen.
const getTableDetail = async (req, res, next) => {
  try {
    const table = await Table.findOne({ _id: req.params.id, restaurant: req.restaurant._id }).lean();
    if (!table) throw new ApiError(404, "Table not found");

    const orders = await Order.find({
      table: table._id,
      bill: null,
      status: { $in: RUNNING_STATUSES },
    })
      .populate("placedBy", "name")
      .sort({ createdAt: 1 })
      .lean();

    return ApiResponse.send(res, 200, "Table fetched", {
      table: { ...table, status: deriveTableStatus(orders) },
      orders,
      runningTotal: Math.round(orders.reduce((s, o) => s + (o.pricing?.total || 0), 0) * 100) / 100,
    });
  } catch (error) {
    next(error);
  }
};

// POST /pos/orders — waiter submits a round of orders for a table. A table can
// be ordered onto repeatedly; each submission is its own Order (its own kitchen
// ticket), and they're all pulled onto one bill at the end.
const placeTableOrder = async (req, res, next) => {
  try {
    const { tableId, items, note } = req.body;
    const restaurant = req.restaurant;

    if (!tableId) throw new ApiError(400, "Table is required");
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(400, "Add at least one item to the order");
    }

    const table = await Table.findOne({ _id: tableId, restaurant: restaurant._id });
    if (!table) throw new ApiError(404, "Table not found");
    if (!table.isActive) throw new ApiError(400, "This table is out of service");

    // Prices come from the menu, never from the tablet — same helper the
    // customer checkout uses, so a waiter and an app order cost the same.
    const { validatedItems, subtotal } = await priceOrderItems(items, restaurant._id);

    const taxPercentage = restaurant.taxSettings?.gstPercentage ?? 5;
    const taxAmount = Math.round(subtotal * (taxPercentage / 100) * 100) / 100;
    const total = Math.round((subtotal + taxAmount) * 100) / 100;

    const order = await Order.create({
      restaurant: restaurant._id,
      table: table._id,
      placedBy: req.user._id,
      customer: undefined, // walk-in guest, no account
      orderType: "dine_in",
      items: validatedItems,
      pricing: {
        subtotal,
        deliveryFee: 0,
        taxAmount,
        taxPercentage,
        discount: 0,
        packagingCharge: 0,
        platformFee: 0,
        tip: 0,
        total,
      },
      restaurantAddress: restaurant.address,
      // Taken face to face — already accepted, straight to the kitchen.
      status: ORDER_STATUS.CONFIRMED,
      statusHistory: [
        {
          status: ORDER_STATUS.CONFIRMED,
          timestamp: new Date(),
          updatedBy: req.user._id,
          note: note || `Dine-in order for table ${table.number}`,
        },
      ],
      paymentMethod: "cod", // settled on the table's bill, not per order
    });

    const populated = await Order.findById(order._id).populate("placedBy", "name").lean();
    const payload = { order: { ...populated, table: { _id: table._id, number: table.number, seats: table.seats } } };

    try {
      const io = getIo();
      if (io) {
        // Kitchen display + owner dashboard both listen on the restaurant room.
        io.to(`restaurant:${restaurant._id}`).emit("kitchen_order_new", payload);
        io.to(`restaurant:${restaurant._id}`).emit("new_order", payload);
      }
    } catch (e) {}

    return ApiResponse.send(res, 201, `Order sent to kitchen for table ${table.number}`, payload);
  } catch (error) {
    next(error);
  }
};

// GET /pos/my-orders — the logged-in waiter's own running orders, so their
// tablet can show "2 ready to serve" without listening to the whole floor.
const getMyOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({
      restaurant: req.restaurant._id,
      placedBy: req.user._id,
      bill: null,
      status: { $in: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY] },
    })
      .populate("table", "number seats")
      .sort({ createdAt: -1 })
      .lean();

    return ApiResponse.send(res, 200, "Orders fetched", {
      orders,
      readyCount: orders.filter((o) => o.status === ORDER_STATUS.READY).length,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /pos/orders/:id/served — waiter has carried the food to the table.
// DELIVERED is the existing terminal status for dine-in (see the
// isDineInCompletion branch in restaurant.order.controller.js).
const markServed = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant._id,
      orderType: "dine_in",
    });
    if (!order) throw new ApiError(404, "Order not found");
    if (order.status !== ORDER_STATUS.READY) {
      throw new ApiError(400, `Only orders marked ready can be served (this one is "${order.status}")`);
    }

    order.status = ORDER_STATUS.DELIVERED;
    order.statusHistory.push({
      status: ORDER_STATUS.DELIVERED,
      timestamp: new Date(),
      updatedBy: req.user._id,
      note: "Served to table",
    });
    await order.save();

    try {
      const io = getIo();
      if (io) io.to(`restaurant:${req.restaurant._id}`).emit("pos_order_updated", { order });
    } catch (e) {}

    return ApiResponse.send(res, 200, "Marked as served", { order });
  } catch (error) {
    next(error);
  }
};

// POST /pos/tables/:id/bill — close out a table. Pulls every unbilled order
// into one Bill and generates the payment QR.
const generateBill = async (req, res, next) => {
  try {
    const { discount = 0, discountReason } = req.body;
    const restaurant = req.restaurant;

    const table = await Table.findOne({ _id: req.params.id, restaurant: restaurant._id });
    if (!table) throw new ApiError(404, "Table not found");

    // An existing unpaid bill means someone already hit "Generate Bill" —
    // return it rather than creating a second bill for the same food.
    const existing = await Bill.findOne({ table: table._id, paymentStatus: "pending" })
      .populate("orders")
      .lean();
    if (existing) {
      return ApiResponse.send(res, 200, "Bill already generated", { bill: existing, reused: true });
    }

    const orders = await Order.find({
      restaurant: restaurant._id,
      table: table._id,
      bill: null,
      status: { $in: RUNNING_STATUSES },
    }).lean();

    if (orders.length === 0) {
      throw new ApiError(400, "This table has nothing to bill");
    }

    const pricing = computeBillTotals(orders, restaurant.taxSettings?.gstPercentage ?? 5, discount);

    const bill = new Bill({
      restaurant: restaurant._id,
      table: table._id,
      tableNumber: table.number,
      orders: orders.map((o) => o._id),
      pricing: { ...pricing, discountReason: discountReason || undefined },
      createdBy: req.user._id,
    });
    await bill.save();

    // Claim the orders onto this bill. Filtered on bill: null so two waiters
    // hitting "Generate Bill" at once can't both pull the same orders — the
    // loser's claim matches nothing and gets cleaned up below.
    const claim = await Order.updateMany(
      { _id: { $in: bill.orders }, bill: null },
      { $set: { bill: bill._id } }
    );
    if (claim.modifiedCount !== orders.length) {
      await Bill.deleteOne({ _id: bill._id });
      await Order.updateMany({ bill: bill._id }, { $set: { bill: null } });
      throw new ApiError(409, "This table was just billed elsewhere — please refresh");
    }

    const qr = await createBillQr(bill, restaurant);
    bill.razorpayQr = qr.error
      ? { failedReason: qr.error, createdAt: new Date() }
      : {
          provider: qr.provider,
          qrId: qr.qrId,
          imageUrl: qr.imageUrl,
          upiUrl: qr.upiUrl,
          upiId: qr.upiId,
          createdAt: new Date(),
        };
    await bill.save();

    const populated = await Bill.findById(bill._id).populate("orders").lean();

    try {
      const io = getIo();
      if (io) io.to(`restaurant:${restaurant._id}`).emit("bill_generated", { bill: populated });
    } catch (e) {}

    return ApiResponse.send(res, 201, "Bill generated", { bill: populated });
  } catch (error) {
    next(error);
  }
};

// GET /pos/bills/:id — for the bill/print screen and for polling QR status.
const getBill = async (req, res, next) => {
  try {
    const bill = await Bill.findOne({ _id: req.params.id, restaurant: req.restaurant._id })
      .populate("orders")
      .populate("createdBy", "name")
      .populate("paidBy", "name")
      .lean();
    if (!bill) throw new ApiError(404, "Bill not found");

    return ApiResponse.send(res, 200, "Bill fetched", { bill, restaurant: billRestaurantInfo(req.restaurant) });
  } catch (error) {
    next(error);
  }
};

// Only the fields the printed bill header needs — not the whole restaurant doc
// (which carries bank details and the Petpooja access token).
function billRestaurantInfo(restaurant) {
  return {
    name: restaurant.name,
    address: restaurant.address,
    contact: { phone: restaurant.contact?.phone },
    taxSettings: {
      gstNumber: restaurant.taxSettings?.gstNumber,
      fssaiLicense: restaurant.taxSettings?.fssaiLicense,
    },
  };
}

// PUT /pos/bills/:id/pay — waiter records a payment by hand.
//
// "qr" is NOT accepted here, ever: a Razorpay QR bill is settled only by the
// qr_code.credited webhook, so a bill can't be closed just because someone
// tapped a button. "upi" IS accepted, but only on bills whose QR is the
// fallback UPI-intent kind — that money lands in the restaurant's VPA with
// nothing to call back, so a human confirming it is the only option.
const MANUAL_METHODS = ["cash", "card", "upi", "other"];

const markBillPaid = async (req, res, next) => {
  try {
    const { paymentMethod } = req.body;
    if (!MANUAL_METHODS.includes(paymentMethod)) {
      throw new ApiError(
        400,
        paymentMethod === "qr"
          ? "A Razorpay QR bill settles itself when the guest pays — it can't be marked paid by hand"
          : `Payment method must be one of: ${MANUAL_METHODS.join(", ")}`
      );
    }

    const bill = await Bill.findOne({ _id: req.params.id, restaurant: req.restaurant._id });
    if (!bill) throw new ApiError(404, "Bill not found");
    if (bill.paymentStatus === "paid") {
      throw new ApiError(400, "This bill is already paid");
    }
    // Guards the distinction above: "upi" must not be used to hand-close a
    // bill that's showing a self-confirming Razorpay QR.
    if (paymentMethod === "upi" && bill.razorpayQr?.provider === "razorpay") {
      throw new ApiError(400, "This bill shows a Razorpay QR — it confirms itself once the guest pays");
    }

    bill.paymentStatus = "paid";
    bill.paymentMethod = paymentMethod;
    bill.paidAt = new Date();
    bill.paidBy = req.user._id;
    await bill.save();

    // Settled in cash — kill the QR so it can't also be scanned and paid.
    await closeBillQr(bill.razorpayQr?.qrId);

    await markBillOrdersPaid(bill);

    try {
      const io = getIo();
      if (io) io.to(`restaurant:${req.restaurant._id}`).emit("bill_paid", { billId: bill._id, tableId: bill.table });
    } catch (e) {}

    return ApiResponse.send(res, 200, "Payment recorded", { bill });
  } catch (error) {
    next(error);
  }
};

// Mirrors the bill's settlement onto its orders so existing revenue reporting
// (which reads order.paymentStatus) counts dine-in money as actually received.
// Exported for the Razorpay QR webhook, which settles bills the same way.
//
// Only paymentStatus is touched — deliberately NOT status. Forcing DELIVERED
// here would stamp "served" on food that may still be in the pass, and the
// kitchen screen already drops these tickets because they now have a bill.
async function markBillOrdersPaid(bill) {
  await Order.updateMany(
    { _id: { $in: bill.orders } },
    { $set: { paymentStatus: "paid" } }
  );
}

// PUT /pos/bills/:id/printed — stamps when the bill was printed. Purely a
// record for staff ("was this already handed over?"); printing itself happens
// in the browser.
const markBillPrinted = async (req, res, next) => {
  try {
    const bill = await Bill.findOneAndUpdate(
      { _id: req.params.id, restaurant: req.restaurant._id },
      { $set: { printedAt: new Date() } },
      { new: true }
    );
    if (!bill) throw new ApiError(404, "Bill not found");
    return ApiResponse.send(res, 200, "Bill marked printed", { bill });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTables,
  getMenu,
  getTableDetail,
  placeTableOrder,
  getMyOrders,
  markServed,
  generateBill,
  getBill,
  markBillPaid,
  markBillPrinted,
  markBillOrdersPaid,
  deriveTableStatus, // exported for pos.test.js
  RUNNING_STATUSES,
};

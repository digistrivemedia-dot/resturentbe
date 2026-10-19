const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");
const restaurantMiddleware = require("../middlewares/restaurant.middleware");

const {
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
} = require("../controllers/pos.controller");
const { getKitchenOrders, advanceOrder } = require("../controllers/kitchen.controller");

// Owners keep access to everything their staff can do — they cover the floor
// themselves on a quiet shift, and they need to settle a bill when a waiter
// has gone home. restaurantMiddleware resolves req.restaurant for all three
// roles (owner, waiter, kitchen) off the same lookup.
const floor = [auth, role("waiter", "restaurant_owner"), restaurantMiddleware];
const kitchen = [auth, role("kitchen", "restaurant_owner"), restaurantMiddleware];

// ── Waiter / floor ─────────────────────────────────────────────────────────
router.get("/tables", ...floor, getTables);
router.get("/tables/:id", ...floor, getTableDetail);
router.get("/menu", ...floor, getMenu);
router.get("/my-orders", ...floor, getMyOrders);
router.post("/orders", ...floor, placeTableOrder);
router.put("/orders/:id/served", ...floor, markServed);

// ── Billing ────────────────────────────────────────────────────────────────
router.post("/tables/:id/bill", ...floor, generateBill);
router.get("/bills/:id", ...floor, getBill);
router.put("/bills/:id/pay", ...floor, markBillPaid);
router.put("/bills/:id/printed", ...floor, markBillPrinted);

// ── Kitchen display ────────────────────────────────────────────────────────
router.get("/kitchen/orders", ...kitchen, getKitchenOrders);
router.put("/kitchen/orders/:id/advance", ...kitchen, advanceOrder);

module.exports = router;

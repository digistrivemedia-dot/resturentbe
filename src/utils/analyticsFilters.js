const mongoose = require("mongoose");
const { ORDER_STATUS } = require("./constants");

// Revenue basis: count every non-cancelled order regardless of paymentStatus,
// matching the existing dashboard controller's convention
// (status: { $nin: [CANCELLED] }) — confirmed with the restaurant owner.
function buildOrderMatch(restaurantId, filters = {}) {
  const { startDate, endDate, orderType, paymentMethod, includeCancelled } = filters;

  const match = {
    restaurant: new mongoose.Types.ObjectId(restaurantId),
  };

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(endDate);
  }

  if (!parseBool(includeCancelled)) {
    match.status = { $ne: ORDER_STATUS.CANCELLED };
  }

  if (orderType && orderType !== "all") {
    match.orderType = orderType;
  }

  if (paymentMethod && paymentMethod !== "all") {
    match.paymentMethod = paymentMethod;
  }

  return match;
}

function parseBool(v) {
  return v === true || v === "true" || v === "1";
}

// Platform-wide variant for admin analytics — no single restaurant is required;
// optionally scoped to a specific set of restaurant ids (city or single-restaurant
// filter resolves to this upstream, since city isn't a field on Order itself).
function buildPlatformOrderMatch(filters = {}, restaurantIds = null) {
  const { startDate, endDate, orderType, paymentMethod, includeCancelled } = filters;

  const match = {};

  if (restaurantIds) {
    match.restaurant = { $in: restaurantIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(endDate);
  }

  if (!parseBool(includeCancelled)) {
    match.status = { $ne: ORDER_STATUS.CANCELLED };
  }

  if (orderType && orderType !== "all") {
    match.orderType = orderType;
  }

  if (paymentMethod && paymentMethod !== "all") {
    match.paymentMethod = paymentMethod;
  }

  return match;
}

// Given the current period's start/end, derive the matching previous-period
// range so the frontend's "vs previous" deltas compare like-for-like durations.
function getPreviousPeriod(startDate, endDate) {
  if (!startDate || !endDate) return { prevStart: null, prevEnd: null };
  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1); // 1ms before current period starts
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { prevStart, prevEnd };
}

function percentChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

module.exports = { buildOrderMatch, buildPlatformOrderMatch, parseBool, getPreviousPeriod, percentChange };

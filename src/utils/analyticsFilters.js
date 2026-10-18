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

  const range = dateRangeMatch(startDate, endDate);
  if (range) match.createdAt = range;

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

// new Date("banana") yields an Invalid Date, which Mongoose rejects with
// "Cast to date failed" — a 500 from a query string typo. Treat an
// unparseable date as absent instead: the range simply isn't applied.
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Builds a createdAt range, omitting the key entirely when neither bound is
// usable — an empty {} is itself a cast error.
function dateRangeMatch(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start && !end) return null;
  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lte = end;
  return range;
}

// Platform-wide variant for admin analytics — no single restaurant is required;
// optionally scoped to a specific set of restaurant ids (city or single-restaurant
// filter resolves to this upstream, since city isn't a field on Order itself).
function buildPlatformOrderMatch(filters = {}, restaurantIds = null) {
  const { startDate, endDate, orderType, paymentMethod, includeCancelled } = filters;

  const match = {};

  if (restaurantIds) {
    match.restaurant = {
      $in: restaurantIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  const range = dateRangeMatch(startDate, endDate);
  if (range) match.createdAt = range;

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

module.exports = { buildOrderMatch, buildPlatformOrderMatch, parseBool, parseDate, dateRangeMatch, getPreviousPeriod, percentChange };

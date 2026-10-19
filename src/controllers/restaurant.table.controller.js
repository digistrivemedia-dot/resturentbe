const Table = require("../models/Table");
const Order = require("../models/Order");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

// GET /restaurant/tables — the floor plan as the owner manages it.
const getTables = async (req, res, next) => {
  try {
    const tables = await Table.find({ restaurant: req.restaurant._id })
      .sort({ sortOrder: 1, number: 1 })
      .lean();

    const totalSeats = tables
      .filter((t) => t.isActive)
      .reduce((sum, t) => sum + t.seats, 0);

    return ApiResponse.send(res, 200, "Tables fetched", {
      tables,
      summary: { total: tables.length, active: tables.filter((t) => t.isActive).length, totalSeats },
    });
  } catch (error) {
    next(error);
  }
};

const addTable = async (req, res, next) => {
  try {
    const { number, seats, zone, sortOrder } = req.body;
    if (!number || !String(number).trim()) throw new ApiError(400, "Table number is required");
    if (!seats || seats < 1) throw new ApiError(400, "Seats must be at least 1");

    const exists = await Table.findOne({
      restaurant: req.restaurant._id,
      number: String(number).trim(),
    }).lean();
    if (exists) throw new ApiError(400, `Table "${number}" already exists`);

    const table = await Table.create({
      restaurant: req.restaurant._id,
      number: String(number).trim(),
      seats,
      zone: zone?.trim() || "",
      sortOrder: sortOrder ?? 0,
    });

    return ApiResponse.send(res, 201, "Table added", { table });
  } catch (error) {
    next(error);
  }
};

// POST /restaurant/tables/bulk — initial floor setup in one shot, e.g.
// [{ count: 20, seats: 4 }, { count: 5, seats: 6 }] for the 25-table /
// 110-seat layout. Numbering continues from the highest existing numeric
// table, so running it twice appends rather than colliding.
const bulkAddTables = async (req, res, next) => {
  try {
    const { groups } = req.body;
    if (!Array.isArray(groups) || groups.length === 0) {
      throw new ApiError(400, "groups must be a non-empty array of { count, seats }");
    }

    const existing = await Table.find({ restaurant: req.restaurant._id }).select("number").lean();
    // Tables can be named "Patio 2", which has no numeric seat in this scheme —
    // only purely numeric names participate in auto-numbering.
    const highest = existing.reduce((max, t) => {
      const n = /^\d+$/.test(t.number) ? parseInt(t.number, 10) : 0;
      return n > max ? n : max;
    }, 0);

    let next = highest + 1;
    const docs = [];
    for (const group of groups) {
      const count = parseInt(group.count, 10);
      const seats = parseInt(group.seats, 10);
      if (!count || count < 1 || !seats || seats < 1) {
        throw new ApiError(400, "Each group needs a count and seats of at least 1");
      }
      for (let i = 0; i < count; i++) {
        docs.push({
          restaurant: req.restaurant._id,
          number: String(next),
          seats,
          zone: group.zone?.trim() || "",
          sortOrder: next,
        });
        next++;
      }
    }

    const tables = await Table.insertMany(docs);
    const totalSeats = tables.reduce((sum, t) => sum + t.seats, 0);

    return ApiResponse.send(res, 201, `${tables.length} tables added`, { tables, totalSeats });
  } catch (error) {
    next(error);
  }
};

const updateTable = async (req, res, next) => {
  try {
    const { number, seats, zone, sortOrder, isActive } = req.body;

    const table = await Table.findOne({ _id: req.params.id, restaurant: req.restaurant._id });
    if (!table) throw new ApiError(404, "Table not found");

    if (number !== undefined) {
      const trimmed = String(number).trim();
      if (!trimmed) throw new ApiError(400, "Table number can't be blank");
      const clash = await Table.findOne({
        restaurant: req.restaurant._id,
        number: trimmed,
        _id: { $ne: table._id },
      }).lean();
      if (clash) throw new ApiError(400, `Table "${trimmed}" already exists`);
      table.number = trimmed;
    }
    if (seats !== undefined) {
      if (seats < 1) throw new ApiError(400, "Seats must be at least 1");
      table.seats = seats;
    }
    if (zone !== undefined) table.zone = zone?.trim() || "";
    if (sortOrder !== undefined) table.sortOrder = sortOrder;

    // Taking a table out of service while guests are mid-meal would strand
    // their running orders with no table to bill them against.
    if (isActive === false && table.isActive) {
      const running = await Order.countDocuments({ table: table._id, bill: null });
      if (running > 0) {
        throw new ApiError(400, "This table has unbilled orders — settle the bill before deactivating it");
      }
      table.isActive = false;
    } else if (isActive === true) {
      table.isActive = true;
    }

    await table.save();
    return ApiResponse.send(res, 200, "Table updated", { table });
  } catch (error) {
    next(error);
  }
};

// Hard delete, but only for a table that was never used — otherwise its past
// orders and bills would point at a missing table. Anything with history must
// be deactivated instead.
const deleteTable = async (req, res, next) => {
  try {
    const table = await Table.findOne({ _id: req.params.id, restaurant: req.restaurant._id });
    if (!table) throw new ApiError(404, "Table not found");

    const used = await Order.countDocuments({ table: table._id });
    if (used > 0) {
      throw new ApiError(
        400,
        "This table has order history — deactivate it instead of deleting, so past bills stay intact"
      );
    }

    await table.deleteOne();
    return ApiResponse.send(res, 200, "Table deleted");
  } catch (error) {
    next(error);
  }
};

module.exports = { getTables, addTable, bulkAddTables, updateTable, deleteTable };

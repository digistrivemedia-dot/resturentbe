const ActivityLog = require("../models/ActivityLog");
const ApiResponse = require("../utils/ApiResponse");

const getLogs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 50,
      entity,
      adminId,
      startDate,
      endDate,
    } = req.query;

    const query = {};
    if (entity) query.entity = entity;
    if (adminId) query.admin = adminId;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      ActivityLog.find(query)
        .populate("admin", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ActivityLog.countDocuments(query),
    ]);

    return ApiResponse.send(res, 200, "Activity logs fetched", {
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getLogs };

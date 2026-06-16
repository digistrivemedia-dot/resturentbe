const ActivityLog = require("../models/ActivityLog");

/**
 * Middleware factory to log admin actions.
 * Usage: adminLog("verified", "restaurant")
 */
const adminLog = (action, entity) => {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    res.json = function (data) {
      // Only log on successful responses
      if (res.statusCode < 400) {
        // For POST responses, try to extract the created entity's ID
        let entityId = req.params.id || null;
        if (!entityId && data?.data) {
          const responseData = data.data;
          const entityKey = Object.keys(responseData).find(
            (k) => responseData[k]?._id
          );
          if (entityKey) entityId = responseData[entityKey]._id;
        }
        ActivityLog.create({
          admin: req.user._id,
          action,
          entity,
          entityId,
          details: `${action} ${entity}${req.params.id ? ` (${req.params.id})` : ""}`,
          ipAddress: req.ip,
        }).catch(() => {}); // Don't block response on log failure
      }

      return originalJson(data);
    };

    next();
  };
};

module.exports = adminLog;

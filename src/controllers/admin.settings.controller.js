const PlatformSettings = require("../models/PlatformSettings");
const ApiResponse = require("../utils/ApiResponse");

const getSettings = async (req, res, next) => {
  try {
    const { category } = req.query;

    const query = {};
    if (category) query.category = category;

    const settings = await PlatformSettings.find(query).sort({ category: 1, key: 1 }).lean();

    // Convert to key-value map for easier frontend consumption
    const settingsMap = {};
    settings.forEach((s) => {
      settingsMap[s.key] = {
        value: s.value,
        category: s.category,
        description: s.description,
      };
    });

    return ApiResponse.send(res, 200, "Settings fetched", { settings: settingsMap, raw: settings });
  } catch (error) {
    next(error);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== "object") {
      return ApiResponse.send(res, 400, "Settings object is required");
    }

    const updates = [];
    for (const [key, data] of Object.entries(settings)) {
      const update = await PlatformSettings.findOneAndUpdate(
        { key },
        {
          key,
          value: data.value !== undefined ? data.value : data,
          category: data.category || "general",
          description: data.description,
        },
        { upsert: true, new: true }
      );
      updates.push(update);
    }

    return ApiResponse.send(res, 200, "Settings updated", { settings: updates });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSettings, updateSettings };

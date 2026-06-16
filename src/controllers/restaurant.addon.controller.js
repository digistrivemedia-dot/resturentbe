const MenuItem = require("../models/MenuItem");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

const getAddons = async (req, res, next) => {
  try {
    const addonGroups = await MenuItem.aggregate([
      {
        $match: {
          restaurant: req.restaurant._id,
          status: "active",
          "addonGroups.0": { $exists: true },
        },
      },
      { $unwind: "$addonGroups" },
      {
        $group: {
          _id: "$addonGroups.name",
          isRequired: { $first: "$addonGroups.isRequired" },
          minSelection: { $first: "$addonGroups.minSelection" },
          maxSelection: { $first: "$addonGroups.maxSelection" },
          addons: { $first: "$addonGroups.addons" },
          usedInItems: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          isRequired: 1,
          minSelection: 1,
          maxSelection: 1,
          addons: 1,
          usedInItems: 1,
        },
      },
      { $sort: { name: 1 } },
    ]);

    return ApiResponse.send(res, 200, "Addon groups fetched", { addonGroups });
  } catch (error) {
    next(error);
  }
};

const addAddonGroup = async (req, res, next) => {
  try {
    const { menuItemId, group } = req.body;

    if (!menuItemId || !group || !group.name) {
      throw new ApiError(400, "menuItemId and group with name are required");
    }

    const menuItem = await MenuItem.findOne({
      _id: menuItemId,
      restaurant: req.restaurant._id,
    });

    if (!menuItem) {
      throw new ApiError(404, "Menu item not found");
    }

    menuItem.addonGroups.push(group);
    await menuItem.save();

    return ApiResponse.send(res, 201, "Addon group added", { menuItem });
  } catch (error) {
    next(error);
  }
};

const updateAddonGroup = async (req, res, next) => {
  try {
    const addonGroupId = req.params.id;
    const { menuItemId, group } = req.body;

    if (!menuItemId || !group) {
      throw new ApiError(400, "menuItemId and group data are required");
    }

    const menuItem = await MenuItem.findOne({
      _id: menuItemId,
      restaurant: req.restaurant._id,
    });

    if (!menuItem) {
      throw new ApiError(404, "Menu item not found");
    }

    const addonGroup = menuItem.addonGroups.id(addonGroupId);
    if (!addonGroup) {
      throw new ApiError(404, "Addon group not found");
    }

    // Update fields
    if (group.name !== undefined) addonGroup.name = group.name;
    if (group.isRequired !== undefined) addonGroup.isRequired = group.isRequired;
    if (group.minSelection !== undefined) addonGroup.minSelection = group.minSelection;
    if (group.maxSelection !== undefined) addonGroup.maxSelection = group.maxSelection;
    if (group.addons !== undefined) addonGroup.addons = group.addons;

    await menuItem.save();

    return ApiResponse.send(res, 200, "Addon group updated", { menuItem });
  } catch (error) {
    next(error);
  }
};

const deleteAddonGroup = async (req, res, next) => {
  try {
    const addonGroupId = req.params.id;
    const { menuItemId } = req.body;

    if (!menuItemId) {
      throw new ApiError(400, "menuItemId is required");
    }

    const menuItem = await MenuItem.findOne({
      _id: menuItemId,
      restaurant: req.restaurant._id,
    });

    if (!menuItem) {
      throw new ApiError(404, "Menu item not found");
    }

    const addonGroup = menuItem.addonGroups.id(addonGroupId);
    if (!addonGroup) {
      throw new ApiError(404, "Addon group not found");
    }

    menuItem.addonGroups.pull(addonGroupId);
    await menuItem.save();

    return ApiResponse.send(res, 200, "Addon group deleted", { menuItem });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAddons,
  addAddonGroup,
  updateAddonGroup,
  deleteAddonGroup,
};

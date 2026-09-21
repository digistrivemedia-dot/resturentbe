const Restaurant = require("../models/Restaurant");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

// POST /restaurant/petpooja/link — stores restID + accessToken so future
// orders get pushed to Petpooja. Menu items still need their Petpooja
// item/variation/addon ids mapped in separately (see MenuItem.petpooja and
// restaurant.menu.controller.js) — this only authorizes the order push itself.
const linkPetpooja = async (req, res, next) => {
  try {
    const { restID, accessToken } = req.body;
    if (!restID || !accessToken) {
      throw new ApiError(400, "restID and accessToken are required");
    }

    await Restaurant.findByIdAndUpdate(req.restaurant._id, {
      "posIntegration.petpooja.restID": restID,
      "posIntegration.petpooja.accessToken": accessToken,
      "posIntegration.petpooja.isLinked": true,
      "posIntegration.petpooja.linkedAt": new Date(),
    });

    return ApiResponse.send(res, 200, "Petpooja linked", { restID, isLinked: true });
  } catch (error) {
    next(error);
  }
};

// GET /restaurant/petpooja/status
const getPetpoojaStatus = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id)
      .select("posIntegration.petpooja")
      .lean();

    const petpooja = restaurant?.posIntegration?.petpooja || {};
    return ApiResponse.send(res, 200, "Petpooja status fetched", {
      isLinked: !!petpooja.isLinked,
      restID: petpooja.restID || null,
      linkedAt: petpooja.linkedAt || null,
    });
  } catch (error) {
    next(error);
  }
};

// POST /restaurant/petpooja/unlink — stops pushing future orders; past
// order.petpooja records are untouched.
const unlinkPetpooja = async (req, res, next) => {
  try {
    await Restaurant.findByIdAndUpdate(req.restaurant._id, {
      "posIntegration.petpooja.isLinked": false,
    });
    return ApiResponse.send(res, 200, "Petpooja unlinked");
  } catch (error) {
    next(error);
  }
};

module.exports = { linkPetpooja, getPetpoojaStatus, unlinkPetpooja };

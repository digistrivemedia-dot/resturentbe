const PlatformSettings = require("../models/PlatformSettings");

const DEFAULT_DISCOVERY_RADIUS_KM = 8;

async function getDiscoveryRadiusMeters() {
  const doc = await PlatformSettings.findOne({ key: "discoveryRadiusKm" }).lean();
  const km = Number(doc?.value);
  const radiusKm = Number.isFinite(km) && km > 0 ? km : DEFAULT_DISCOVERY_RADIUS_KM;
  return { radiusKm, radiusMeters: radiusKm * 1000 };
}

module.exports = { DEFAULT_DISCOVERY_RADIUS_KM, getDiscoveryRadiusMeters };

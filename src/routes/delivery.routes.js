const express = require("express");
const { getServiceability } = require("../controllers/delivery.controller");
const auth = require("../middlewares/auth.middleware");

const router = express.Router();

// Customer must be logged in to check serviceability
router.post("/serviceability", auth, getServiceability);

module.exports = router;

const express = require("express");
const { getServiceability } = require("../controllers/delivery.controller");

const router = express.Router();

// Public — used to preview the real delivery fee before checkout, including
// for guests who haven't logged in yet. Login is still required to actually
// place the order (see order.routes.js), so this only ever previews a quote.
router.post("/serviceability", getServiceability);

module.exports = router;

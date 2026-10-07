// node src/controllers/petpooja.endpoints.test.js
// Petpooja verifies these endpoints by matching the response body against
// their blueprint. The shapes are inconsistent on purpose (stock uses "code",
// store uses "http_code") — this guards against someone normalising them.
const assert = require("assert");

const captured = {};
const fakeRes = () => ({
  status(c) { this._c = c; return this; },
  json(b) { this._b = b; return this; },
});

// Stub mongoose models before requiring the controller.
const Module = require("module");
const origResolve = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith("/models/Restaurant")) {
    return { findOne: async () => ({ _id: "r1", timing: { isOpen: true }, save: async () => {} }) };
  }
  if (request.endsWith("/models/MenuItem")) {
    return { updateMany: async (...a) => { captured.update = a; } };
  }
  return origResolve.apply(this, arguments);
};

const c = require("./webhook.controller");
Module._load = origResolve;

(async () => {
  let res = fakeRes();
  await c.handlePetpoojaItemStock({ body: { restID: "t4pqh7yeaj", type: "item", inStock: false, itemID: ["24384"] } }, res);
  assert.strictEqual(res._c, 200);
  assert.deepStrictEqual(res._b, {
    code: 200, status: "success", message: "Stock status updated successfully",
  });
  assert.strictEqual(captured.update[1].$set.isAvailable, false, "inStock:false must mark unavailable");

  // Malformed payload must still answer in their failure shape, not throw.
  res = fakeRes();
  await c.handlePetpoojaItemStock({ body: { restID: "x" } }, res);
  assert.strictEqual(res._c, 400);
  assert.deepStrictEqual(res._b, {
    code: 400, status: "failed", message: "Stock status not updated successfully",
  });

  res = fakeRes();
  await c.handlePetpoojaGetStoreStatus({ body: { restID: "t4pqh7yeaj" } }, res);
  assert.deepStrictEqual(res._b, {
    http_code: 200, status: "success", store_status: "1",
    message: "Store Delivery Status fetched successfully",
  });

  res = fakeRes();
  await c.handlePetpoojaUpdateStoreStatus({ body: { restID: "t4pqh7yeaj", store_status: 0 } }, res);
  assert.deepStrictEqual(res._b, {
    http_code: 200, status: "success",
    message: "Store Status updated successfully for store restID",
  });

  // A missing store_status must NOT be read as "close the store".
  res = fakeRes();
  await c.handlePetpoojaUpdateStoreStatus({ body: { restID: "t4pqh7yeaj" } }, res);
  assert.strictEqual(res._b.status, "failed", "absent store_status must not close the store");

  console.log("ok — all four response bodies match the blueprint");
})().catch((e) => { console.error(e.message); process.exit(1); });

const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");
const {
  uploadImage,
  uploadImages,
  deleteImage,
} = require("../controllers/upload.controller");

// All upload routes require authentication
router.use(auth);

// Single image upload
router.post("/image", upload.single("image"), uploadImage);

// Multiple images upload (max 5)
router.post("/images", upload.array("images", 5), uploadImages);

// Delete image by public_id
router.delete("/image", deleteImage);

module.exports = router;

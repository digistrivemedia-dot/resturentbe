const express = require("express");
const router = express.Router();

const auth = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");
const {
  uploadImage,
  uploadImages,
  uploadVideo,
  deleteImage,
} = require("../controllers/upload.controller");

// All upload routes require authentication
router.use(auth);

// Single image upload
router.post("/image", upload.single("image"), uploadImage);

// Multiple images upload (max 5)
router.post("/images", upload.array("images", 5), uploadImages);

// Single video upload (max 50MB)
router.post("/video", upload.uploadVideo.single("video"), uploadVideo);

// Delete image or video by filename + folder
router.delete("/image", deleteImage);

module.exports = router;

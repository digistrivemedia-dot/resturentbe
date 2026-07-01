const fs = require("fs");
const path = require("path");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

// Base URL for serving uploaded files.
// In development, files are served by Express from localhost.
// In production, Nginx serves them from the VPS domain.
const BASE_URL =
  process.env.BASE_URL ||
  (process.env.NODE_ENV === "production" ? "https://sriishacafe.in" : "http://localhost:8000");

// Build the public URL for a saved file
function buildFileUrl(filePath) {
  // filePath example: /var/www/uploads/menu/1234567890-abc123.jpg
  // or in dev: /absolute/path/to/project/uploads/menu/1234567890-abc123.jpg
  const parts = filePath.split(path.sep);
  const uploadsIdx = parts.lastIndexOf("uploads");
  const relativeParts = parts.slice(uploadsIdx); // ["uploads", "menu", "filename.jpg"]
  return `${BASE_URL}/${relativeParts.join("/")}`;
}

const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ApiError(400, "No image file provided");
    }

    const url = buildFileUrl(req.file.path);

    return ApiResponse.send(res, 200, "Image uploaded", {
      url,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    next(error);
  }
};

const uploadImages = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new ApiError(400, "No image files provided");
    }

    const images = req.files.map((file) => ({
      url: buildFileUrl(file.path),
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
    }));

    return ApiResponse.send(res, 200, `${images.length} images uploaded`, { images });
  } catch (error) {
    next(error);
  }
};

const deleteImage = async (req, res, next) => {
  try {
    const { filename, folder } = req.body;

    if (!filename || !folder) {
      throw new ApiError(400, "filename and folder are required");
    }

    // Sanitize inputs to prevent path traversal
    const safeFilename = path.basename(filename);
    const safeFolder = path.basename(folder);

    const filePath =
      process.env.NODE_ENV === "production"
        ? `/var/www/uploads/${safeFolder}/${safeFilename}`
        : path.join(__dirname, "../../../uploads", safeFolder, safeFilename);

    if (!fs.existsSync(filePath)) {
      throw new ApiError(404, "Image not found");
    }

    fs.unlinkSync(filePath);

    return ApiResponse.send(res, 200, "Image deleted");
  } catch (error) {
    next(error);
  }
};

module.exports = { uploadImage, uploadImages, deleteImage };

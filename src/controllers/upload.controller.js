const cloudinary = require("../config/cloudinary");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");

// Upload buffer to Cloudinary with auto-optimization
const uploadToCloudinary = (buffer, folder, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: `cafesriisha/${folder}`,
      resource_type: "image",
      transformation: [
        { quality: "auto:good", fetch_format: "auto" },
        ...(options.width ? [{ width: options.width, crop: "limit" }] : []),
      ],
      ...options,
    };

    const stream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    stream.end(buffer);
  });
};

// Determine folder and resize based on type
const UPLOAD_CONFIG = {
  "menu-item": { folder: "menu-items", width: 800 },
  restaurant: { folder: "restaurants", width: 1200 },
  avatar: { folder: "users", width: 400 },
  banner: { folder: "banners", width: 1920 },
  general: { folder: "general", width: 1200 },
};

const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ApiError(400, "No image file provided");
    }

    const type = req.body.type || "general";
    const config = UPLOAD_CONFIG[type] || UPLOAD_CONFIG.general;

    const result = await uploadToCloudinary(req.file.buffer, config.folder, {
      width: config.width,
    });

    return ApiResponse.send(res, 200, "Image uploaded", {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
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

    const type = req.body.type || "general";
    const config = UPLOAD_CONFIG[type] || UPLOAD_CONFIG.general;

    const uploads = await Promise.all(
      req.files.map((file) =>
        uploadToCloudinary(file.buffer, config.folder, {
          width: config.width,
        })
      )
    );

    const images = uploads.map((result) => ({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    }));

    return ApiResponse.send(res, 200, `${images.length} images uploaded`, { images });
  } catch (error) {
    next(error);
  }
};

const deleteImage = async (req, res, next) => {
  try {
    const { publicId } = req.body;

    if (!publicId) {
      throw new ApiError(400, "Public ID is required");
    }

    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result !== "ok") {
      throw new ApiError(400, "Failed to delete image");
    }

    return ApiResponse.send(res, 200, "Image deleted");
  } catch (error) {
    next(error);
  }
};

module.exports = { uploadImage, uploadImages, deleteImage };

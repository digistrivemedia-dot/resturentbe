const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const ApiError = require("../utils/ApiError");

// Folder mapping by upload type
const FOLDER_MAP = {
  "menu-item": "menu",
  restaurant: "restaurants",
  avatar: "avatars",
  banner: "banners",
  general: "general",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.body.type || "general";
    const folder = FOLDER_MAP[type] || "general";
    // In production, uploads live at /var/www/uploads/<folder>/
    // In development, they go to <project-root>/uploads/<folder>/
    const uploadDir =
      process.env.NODE_ENV === "production"
        ? `/var/www/uploads/${folder}`
        : path.join(__dirname, "../../../uploads", folder);
    // Create directory if it doesn't exist (multer won't do this automatically)
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, unique);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, "Only jpeg, png, and webp images are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

module.exports = upload;

require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const mongoose = require("mongoose");
const User = require("../models/User");

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    const existingAdmin = await User.findOne({ role: "super_admin" });
    if (existingAdmin) {
      console.log("Super admin already exists:", existingAdmin.email);
      process.exit(0);
    }

    const admin = await User.create({
      name: "Admin User",
      email: "admin@cafesriisha.com",
      password: "admin123",
      role: "super_admin",
      authProvider: "email",
      isEmailVerified: true,
      status: "active",
    });

    console.log("Super admin created successfully!");
    console.log("Email:", admin.email);
    console.log("Password: admin123");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
};

createAdmin();

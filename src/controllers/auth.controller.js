const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { generateAccessToken, generateRefreshToken } = require("../utils/generateToken");
const sendEmail = require("../utils/sendEmail");
const jwt = require("jsonwebtoken");

// In-memory OTP store (move to Redis later)
const otpStore = new Map();

// Helper: set refresh token cookie
const setRefreshCookie = (res, token) => {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// Helper: set role cookie (readable by Next.js middleware for server-side route protection)
const setRoleCookie = (res, role) => {
  res.cookie("userRole", role, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

// Helper: set user info cookie (readable by frontend JS — replaces localStorage)
const setUserInfoCookie = (res, user) => {
  const info = {
    _id: user._id,
    name: user.name || null,
    email: user.email || null,
    role: user.role,
    avatar: user.avatar || null,
  };
  res.cookie("userInfo", JSON.stringify(info), {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

// POST /auth/register — Email + password (for restaurant owners & admins)
const register = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new ApiError(400, "User with this email already exists");
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || "restaurant_owner",
      authProvider: "email",
      isEmailVerified: true,
    });

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);
    setRoleCookie(res, user.role);
    setUserInfoCookie(res, user);

    const userObj = user.toObject();
    delete userObj.password;

    ApiResponse.send(res, 201, "Registration successful", {
      user: userObj,
      token: accessToken,
    });
  } catch (error) {
    next(error);
  }
};

// POST /auth/login — Email + password login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");
    if (!user || !user.password) {
      throw new ApiError(401, "Invalid email or password");
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new ApiError(401, "Invalid email or password");
    }

    if (user.status === "blocked") {
      throw new ApiError(403, "Your account has been blocked");
    }

    user.lastLogin = new Date();
    await user.save();

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);
    setRoleCookie(res, user.role);
    setUserInfoCookie(res, user);

    const userObj = user.toObject();
    delete userObj.password;

    ApiResponse.send(res, 200, "Login successful", {
      user: userObj,
      token: accessToken,
    });
  } catch (error) {
    next(error);
  }
};

// POST /auth/send-otp — Send OTP to email
const sendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));

    // Store with 5-min expiry
    otpStore.set(email, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Send email
    await sendEmail({
      to: email,
      subject: "Your DigiStrive Login OTP",
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
          <h2 style="color: #E23744;">DigiStrive</h2>
          <p>Your OTP for login is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333; padding: 16px 0;">
            ${otp}
          </div>
          <p style="color: #888; font-size: 14px;">This OTP is valid for 5 minutes. Do not share it with anyone.</p>
        </div>
      `,
    });

    ApiResponse.send(res, 200, "OTP sent to your email", { email });
  } catch (error) {
    next(error);
  }
};

// POST /auth/verify-otp — Verify OTP and login/register
const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    const stored = otpStore.get(email);
    if (!stored) {
      throw new ApiError(400, "OTP expired or not found. Please request a new one");
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(email);
      throw new ApiError(400, "OTP has expired. Please request a new one");
    }

    if (stored.otp !== otp) {
      throw new ApiError(400, "Invalid OTP");
    }

    // OTP valid — delete it
    otpStore.delete(email);

    // Find or create user
    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      user = await User.create({
        email,
        role: "customer",
        authProvider: "email",
        isEmailVerified: true,
      });
      isNewUser = true;
    }

    if (user.status === "blocked") {
      throw new ApiError(403, "Your account has been blocked");
    }

    user.lastLogin = new Date();
    user.isEmailVerified = true;
    await user.save();

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);
    setRoleCookie(res, user.role);
    setUserInfoCookie(res, user);

    ApiResponse.send(res, 200, "OTP verified successfully", {
      user,
      token: accessToken,
      isNewUser,
    });
  } catch (error) {
    next(error);
  }
};

// POST /auth/google — Google OAuth login
const googleLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;

    // Verify Google token
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    if (!response.ok) {
      throw new ApiError(401, "Invalid Google token");
    }

    const payload = await response.json();
    const { sub: googleId, email, name, picture } = payload;

    // Find or create user
    let user = await User.findOne({
      $or: [{ googleId }, { email }],
    });
    let isNewUser = false;

    if (!user) {
      user = await User.create({
        name,
        email,
        googleId,
        avatar: picture,
        role: "customer",
        authProvider: "google",
        isEmailVerified: true,
      });
      isNewUser = true;
    } else {
      // Link Google account if user exists but no googleId
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = "google";
      }
      if (!user.avatar && picture) user.avatar = picture;
      if (!user.name && name) user.name = name;
      user.isEmailVerified = true;
      user.lastLogin = new Date();
      await user.save();
    }

    if (user.status === "blocked") {
      throw new ApiError(403, "Your account has been blocked");
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    setRefreshCookie(res, refreshToken);
    setRoleCookie(res, user.role);
    setUserInfoCookie(res, user);

    ApiResponse.send(res, 200, "Google login successful", {
      user,
      token: accessToken,
      isNewUser,
    });
  } catch (error) {
    next(error);
  }
};

// POST /auth/refresh-token — Refresh access token
const refreshTokenHandler = async (req, res, next) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) {
      throw new ApiError(401, "No refresh token provided");
    }

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.status === "blocked") {
      throw new ApiError(401, "Invalid refresh token");
    }

    const accessToken = generateAccessToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);
    setRefreshCookie(res, newRefreshToken);
    setRoleCookie(res, user.role);
    setUserInfoCookie(res, user); // keeps userInfo cookie fresh / repairs old sessions

    ApiResponse.send(res, 200, "Token refreshed", {
      token: accessToken,
    });
  } catch (error) {
    // Clear invalid cookies
    res.clearCookie("refreshToken");
    res.clearCookie("userRole");
    res.clearCookie("userInfo");
    next(error instanceof ApiError ? error : new ApiError(401, "Invalid refresh token"));
  }
};

// POST /auth/logout
const logout = async (req, res, next) => {
  try {
    res.clearCookie("refreshToken");
    res.clearCookie("userRole");
    res.clearCookie("userInfo");
    ApiResponse.send(res, 200, "Logged out successfully");
  } catch (error) {
    next(error);
  }
};

// GET /auth/me — Get current user
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select("-password")
      .populate("favorites", "name slug cuisines rating deliverySettings costForTwo offers timing isVerified address.area address.city")
      .lean();
    ApiResponse.send(res, 200, "User profile fetched", { user });
  } catch (error) {
    next(error);
  }
};

// PUT /customer/profile — Update profile
const updateProfile = async (req, res, next) => {
  try {
    const { name, email, phone, avatar } = req.body;
    const user = await User.findById(req.user._id);

    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (avatar) user.avatar = avatar;

    await user.save();

    ApiResponse.send(res, 200, "Profile updated successfully", { user });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  sendOtp,
  verifyOtp,
  googleLogin,
  refreshToken: refreshTokenHandler,
  logout,
  getMe,
  updateProfile,
};

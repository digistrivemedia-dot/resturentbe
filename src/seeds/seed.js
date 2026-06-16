require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const mongoose = require("mongoose");
const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const Coupon = require("../models/Coupon");

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    // Clear existing data
    await Restaurant.deleteMany({});
    await MenuItem.deleteMany({});
    console.log("Cleared existing restaurants and menu items");

    // Create or find restaurant owner
    let owner = await User.findOne({ email: "vikram@tandoorinights.com" });
    if (!owner) {
      owner = await User.create({
        name: "Vikram Singh",
        email: "vikram@tandoorinights.com",
        password: "password123",
        role: "restaurant_owner",
        authProvider: "email",
        isEmailVerified: true,
        status: "active",
      });
      console.log("Created restaurant owner: vikram@tandoorinights.com / password123");
    }

    // Create restaurants
    const restaurants = await Restaurant.insertMany([
      {
        owner: owner._id,
        name: "Tandoori Nights",
        description: "Authentic North Indian cuisine with tandoori specialties",
        cuisines: ["North Indian", "Mughlai", "Biryani"],
        categories: ["Non-Veg", "Veg"],
        address: {
          fullAddress: "123 MG Road, Andheri West",
          area: "Andheri West",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400053",
          lat: 19.1364,
          lng: 72.8296,
        },
        timing: { openTime: "11:00", closeTime: "23:00", offDays: [], isOpen: true },
        deliverySettings: {
          deliveryRadius: 7, minOrderAmount: 149, deliveryFee: 30,
          freeDeliveryAbove: 499, avgDeliveryTime: 35,
        },
        rating: { average: 4.3, totalReviews: 1250 },
        isFeatured: true, isVerified: true, status: "active", costForTwo: 500,
        offers: [
          { code: "FIRST50", description: "50% off up to ₹100 on first order" },
          { code: "FLAT20", description: "Flat ₹20 off on orders above ₹299" },
        ],
      },
      {
        owner: owner._id,
        name: "Pizza Paradise",
        description: "Wood-fired pizzas and Italian favorites",
        cuisines: ["Italian", "Pizza", "Continental"],
        categories: ["Veg", "Non-Veg"],
        address: {
          fullAddress: "45 Hill Road, Bandra West",
          area: "Bandra West",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400050",
          lat: 19.0596,
          lng: 72.8295,
        },
        timing: { openTime: "10:00", closeTime: "01:00", offDays: [], isOpen: true },
        deliverySettings: {
          deliveryRadius: 8, minOrderAmount: 199, deliveryFee: 25,
          freeDeliveryAbove: 599, avgDeliveryTime: 30,
        },
        rating: { average: 4.5, totalReviews: 2100 },
        isFeatured: true, isVerified: true, status: "active", costForTwo: 600,
        offers: [{ code: "COMBO", description: "Buy 1 Get 1 on medium pizzas" }],
      },
      {
        owner: owner._id,
        name: "Dosa Factory",
        description: "South Indian delicacies - dosas, idlis, and more",
        cuisines: ["South Indian", "Healthy"],
        categories: ["Veg"],
        address: {
          fullAddress: "78 Linking Road, Malad West",
          area: "Malad West",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400064",
          lat: 19.1862,
          lng: 72.8487,
        },
        timing: { openTime: "07:00", closeTime: "22:00", offDays: ["Monday"], isOpen: true },
        deliverySettings: {
          deliveryRadius: 5, minOrderAmount: 99, deliveryFee: 20,
          freeDeliveryAbove: 299, avgDeliveryTime: 25,
        },
        rating: { average: 4.1, totalReviews: 890 },
        isFeatured: false, isVerified: true, status: "active", costForTwo: 250,
        offers: [],
      },
      {
        owner: owner._id,
        name: "Dragon Wok",
        description: "Sizzling Chinese & Asian fusion dishes",
        cuisines: ["Chinese", "Street Food"],
        categories: ["Veg", "Non-Veg"],
        address: {
          fullAddress: "22 FC Road, Powai",
          area: "Powai",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400076",
          lat: 19.1176,
          lng: 72.9060,
        },
        timing: { openTime: "11:30", closeTime: "23:30", offDays: [], isOpen: true },
        deliverySettings: {
          deliveryRadius: 6, minOrderAmount: 149, deliveryFee: 35,
          freeDeliveryAbove: 499, avgDeliveryTime: 40,
        },
        rating: { average: 3.9, totalReviews: 650 },
        isFeatured: false, isVerified: true, status: "active", costForTwo: 400,
        offers: [{ code: "WOK30", description: "30% off on orders above ₹500" }],
      },
      {
        owner: owner._id,
        name: "Burger Barn",
        description: "Juicy burgers, loaded fries, and milkshakes",
        cuisines: ["Burgers", "Continental"],
        categories: ["Non-Veg", "Veg"],
        address: {
          fullAddress: "10 SV Road, Goregaon West",
          area: "Goregaon West",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400062",
          lat: 19.1663,
          lng: 72.8526,
        },
        timing: { openTime: "11:00", closeTime: "00:00", offDays: [], isOpen: true },
        deliverySettings: {
          deliveryRadius: 6, minOrderAmount: 129, deliveryFee: 25,
          freeDeliveryAbove: 399, avgDeliveryTime: 28,
        },
        rating: { average: 4.4, totalReviews: 1800 },
        isFeatured: true, isVerified: true, status: "active", costForTwo: 350,
        offers: [{ code: "NEWUSER", description: "Flat ₹75 off for new users" }],
      },
      {
        owner: owner._id,
        name: "Royal Biryani House",
        description: "Hyderabadi dum biryani and kebabs",
        cuisines: ["Biryani", "Mughlai", "North Indian"],
        categories: ["Non-Veg"],
        address: {
          fullAddress: "56 LBS Marg, Thane",
          area: "Thane",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400601",
          lat: 19.2183,
          lng: 72.9781,
        },
        timing: { openTime: "11:00", closeTime: "23:00", offDays: [], isOpen: true },
        deliverySettings: {
          deliveryRadius: 8, minOrderAmount: 199, deliveryFee: 40,
          freeDeliveryAbove: 599, avgDeliveryTime: 45,
        },
        rating: { average: 4.6, totalReviews: 3200 },
        isFeatured: true, isVerified: true, status: "active", costForTwo: 450,
        offers: [
          { code: "BIRYANI50", description: "50% off up to ₹150" },
          { code: "FREEDEL", description: "Free delivery on all orders" },
        ],
      },
    ]);

    console.log(`Created ${restaurants.length} restaurants`);

    // Get Tandoori Nights ID for menu items
    const tandoori = restaurants[0];
    const pizza = restaurants[1];
    const dosa = restaurants[2];
    const dragon = restaurants[3];
    const burger = restaurants[4];
    const biryani = restaurants[5];

    // Menu items for Tandoori Nights
    const menuItems = await MenuItem.insertMany([
      // Tandoori Nights
      {
        restaurant: tandoori._id, category: "Starters", name: "Paneer Tikka",
        description: "Marinated cottage cheese cubes grilled in tandoor with spices",
        price: 249, discountedPrice: 199, isVeg: true, spiceLevel: "medium",
        preparationTime: 20, tags: ["bestseller"], isAvailable: true, isBestseller: true, sortOrder: 1,
        addonGroups: [{
          name: "Extra Toppings", isRequired: false, minSelection: 0, maxSelection: 3,
          addons: [
            { name: "Extra Cheese", price: 40, isAvailable: true },
            { name: "Mint Chutney", price: 20, isAvailable: true },
            { name: "Onion Rings", price: 30, isAvailable: true },
          ],
        }],
      },
      {
        restaurant: tandoori._id, category: "Starters", name: "Chicken Seekh Kebab",
        description: "Minced chicken kebabs with herbs and spices, cooked in tandoor",
        price: 299, isVeg: false, spiceLevel: "hot",
        preparationTime: 25, tags: [], isAvailable: true, isBestseller: false, sortOrder: 2,
        variants: [
          { name: "Half (4 pcs)", price: 169 },
          { name: "Full (8 pcs)", price: 299 },
        ],
      },
      {
        restaurant: tandoori._id, category: "Main Course", name: "Butter Chicken",
        description: "Tender chicken cooked in rich, creamy tomato gravy",
        price: 349, isVeg: false, spiceLevel: "mild",
        preparationTime: 30, tags: ["bestseller", "chef_special"], isAvailable: true, isBestseller: true, sortOrder: 1,
        addonGroups: [{
          name: "Choice of Bread", isRequired: false, minSelection: 0, maxSelection: 2,
          addons: [
            { name: "Butter Naan", price: 49, isAvailable: true },
            { name: "Garlic Naan", price: 59, isAvailable: true },
            { name: "Tandoori Roti", price: 29, isAvailable: true },
            { name: "Laccha Paratha", price: 69, isAvailable: true },
          ],
        }],
        variants: [
          { name: "Half", price: 219 },
          { name: "Full", price: 349 },
        ],
      },
      {
        restaurant: tandoori._id, category: "Main Course", name: "Dal Makhani",
        description: "Black lentils slow cooked overnight with butter and cream",
        price: 229, isVeg: true, spiceLevel: "mild",
        preparationTime: 20, isAvailable: true, isBestseller: false, sortOrder: 2,
      },
      {
        restaurant: tandoori._id, category: "Biryani", name: "Chicken Dum Biryani",
        description: "Aromatic basmati rice layered with spiced chicken, slow cooked",
        price: 299, isVeg: false, spiceLevel: "medium",
        preparationTime: 35, tags: ["bestseller"], isAvailable: true, isBestseller: true, sortOrder: 1,
        addonGroups: [{
          name: "Add Extras", isRequired: false, minSelection: 0, maxSelection: 3,
          addons: [
            { name: "Raita", price: 39, isAvailable: true },
            { name: "Salan", price: 29, isAvailable: true },
            { name: "Boiled Egg", price: 20, isAvailable: true },
            { name: "Extra Leg Piece", price: 79, isAvailable: true },
          ],
        }],
        variants: [
          { name: "Single (serves 1)", price: 199 },
          { name: "Regular (serves 2)", price: 299 },
          { name: "Family (serves 4)", price: 549 },
        ],
      },
      {
        restaurant: tandoori._id, category: "Beverages", name: "Mango Lassi",
        description: "Creamy yogurt drink blended with fresh mangoes",
        price: 99, isVeg: true, spiceLevel: "mild",
        preparationTime: 5, tags: ["new"], isAvailable: true, sortOrder: 1,
      },
      {
        restaurant: tandoori._id, category: "Desserts", name: "Gulab Jamun (2 pcs)",
        description: "Soft milk solid balls soaked in rose flavored sugar syrup",
        price: 79, isVeg: true, spiceLevel: "mild",
        preparationTime: 5, isAvailable: true, sortOrder: 1,
        variants: [
          { name: "2 Pieces", price: 79 },
          { name: "4 Pieces", price: 139 },
        ],
      },

      // Pizza Paradise
      {
        restaurant: pizza._id, category: "Pizzas", name: "Margherita Pizza",
        description: "Classic pizza with fresh mozzarella and basil",
        price: 299, isVeg: true, spiceLevel: "mild",
        preparationTime: 20, tags: ["bestseller"], isAvailable: true, isBestseller: true, sortOrder: 1,
        variants: [
          { name: "Medium (8 inch)", price: 299 },
          { name: "Large (12 inch)", price: 449 },
        ],
      },
      {
        restaurant: pizza._id, category: "Pizzas", name: "Pepperoni Pizza",
        description: "Loaded with spicy pepperoni and mozzarella cheese",
        price: 399, isVeg: false, spiceLevel: "medium",
        preparationTime: 25, isAvailable: true, sortOrder: 2,
        variants: [
          { name: "Medium (8 inch)", price: 399 },
          { name: "Large (12 inch)", price: 599 },
        ],
      },
      {
        restaurant: pizza._id, category: "Pasta", name: "Penne Arrabiata",
        description: "Penne pasta in spicy tomato sauce with herbs",
        price: 249, isVeg: true, spiceLevel: "hot",
        preparationTime: 20, isAvailable: true, sortOrder: 1,
      },
      {
        restaurant: pizza._id, category: "Sides", name: "Garlic Bread",
        description: "Toasted bread with garlic butter and herbs",
        price: 149, isVeg: true, spiceLevel: "mild",
        preparationTime: 10, isAvailable: true, sortOrder: 1,
      },

      // Dosa Factory
      {
        restaurant: dosa._id, category: "Dosas", name: "Masala Dosa",
        description: "Crispy dosa filled with spiced potato masala",
        price: 129, isVeg: true, spiceLevel: "medium",
        preparationTime: 15, tags: ["bestseller"], isAvailable: true, isBestseller: true, sortOrder: 1,
      },
      {
        restaurant: dosa._id, category: "Dosas", name: "Mysore Masala Dosa",
        description: "Spicy red chutney dosa with potato filling",
        price: 159, isVeg: true, spiceLevel: "hot",
        preparationTime: 15, isAvailable: true, sortOrder: 2,
      },
      {
        restaurant: dosa._id, category: "Idli & Vada", name: "Idli Sambar (4 pcs)",
        description: "Steamed rice cakes served with sambar and chutneys",
        price: 99, isVeg: true, spiceLevel: "mild",
        preparationTime: 10, isAvailable: true, sortOrder: 1,
      },
      {
        restaurant: dosa._id, category: "Beverages", name: "Filter Coffee",
        description: "Traditional South Indian filter coffee",
        price: 49, isVeg: true, spiceLevel: "mild",
        preparationTime: 5, isAvailable: true, sortOrder: 1,
      },

      // Dragon Wok
      {
        restaurant: dragon._id, category: "Starters", name: "Veg Manchurian",
        description: "Deep fried vegetable balls in spicy Manchurian sauce",
        price: 179, isVeg: true, spiceLevel: "hot",
        preparationTime: 20, tags: ["bestseller"], isAvailable: true, isBestseller: true, sortOrder: 1,
      },
      {
        restaurant: dragon._id, category: "Noodles", name: "Hakka Noodles",
        description: "Stir-fried noodles with vegetables and soy sauce",
        price: 199, isVeg: true, spiceLevel: "medium",
        preparationTime: 20, isAvailable: true, sortOrder: 1,
        variants: [
          { name: "Veg", price: 199 },
          { name: "Chicken", price: 249 },
          { name: "Egg", price: 219 },
        ],
      },
      {
        restaurant: dragon._id, category: "Rice", name: "Schezwan Fried Rice",
        description: "Spicy fried rice with schezwan sauce and vegetables",
        price: 219, isVeg: true, spiceLevel: "extra_hot",
        preparationTime: 20, isAvailable: true, sortOrder: 1,
      },

      // Burger Barn
      {
        restaurant: burger._id, category: "Burgers", name: "Classic Chicken Burger",
        description: "Crispy chicken patty with lettuce, tomato, and mayo",
        price: 179, isVeg: false, spiceLevel: "mild",
        preparationTime: 15, tags: ["bestseller"], isAvailable: true, isBestseller: true, sortOrder: 1,
      },
      {
        restaurant: burger._id, category: "Burgers", name: "Veg Supreme Burger",
        description: "Crispy paneer patty with cheese and special sauce",
        price: 159, isVeg: true, spiceLevel: "mild",
        preparationTime: 15, isAvailable: true, sortOrder: 2,
      },
      {
        restaurant: burger._id, category: "Sides", name: "Loaded Fries",
        description: "Crispy fries topped with cheese sauce and jalapeños",
        price: 129, isVeg: true, spiceLevel: "medium",
        preparationTime: 10, isAvailable: true, sortOrder: 1,
      },
      {
        restaurant: burger._id, category: "Shakes", name: "Oreo Milkshake",
        description: "Creamy vanilla milkshake with Oreo cookies",
        price: 149, isVeg: true, spiceLevel: "mild",
        preparationTime: 5, isAvailable: true, sortOrder: 1,
      },

      // Royal Biryani House
      {
        restaurant: biryani._id, category: "Biryani", name: "Hyderabadi Chicken Biryani",
        description: "Authentic Hyderabadi dum biryani with tender chicken",
        price: 329, isVeg: false, spiceLevel: "medium",
        preparationTime: 40, tags: ["bestseller", "chef_special"], isAvailable: true, isBestseller: true, sortOrder: 1,
        variants: [
          { name: "Single", price: 219 },
          { name: "Regular", price: 329 },
          { name: "Family Pack", price: 599 },
        ],
      },
      {
        restaurant: biryani._id, category: "Biryani", name: "Mutton Biryani",
        description: "Slow cooked mutton layered with fragrant basmati rice",
        price: 399, isVeg: false, spiceLevel: "hot",
        preparationTime: 45, isAvailable: true, sortOrder: 2,
      },
      {
        restaurant: biryani._id, category: "Starters", name: "Chicken 65",
        description: "Spicy deep-fried chicken bites with curry leaves",
        price: 249, isVeg: false, spiceLevel: "hot",
        preparationTime: 20, isAvailable: true, sortOrder: 1,
      },
      {
        restaurant: biryani._id, category: "Beverages", name: "Masala Chaas",
        description: "Spiced buttermilk with cumin and mint",
        price: 49, isVeg: true, spiceLevel: "mild",
        preparationTime: 5, isAvailable: true, sortOrder: 1,
      },
    ]);

    console.log(`Created ${menuItems.length} menu items`);

    // Seed coupons
    await Coupon.deleteMany({});
    const coupons = await Coupon.insertMany([
      {
        code: "WELCOME50",
        title: "Welcome Offer",
        description: "50% off on your first order",
        type: "percentage",
        value: 50,
        maxDiscount: 100,
        minOrderAmount: 199,
        scope: "platform",
        usageLimit: null,
        perUserLimit: 1,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
      {
        code: "FLAT100",
        title: "Flat ₹100 Off",
        description: "Flat ₹100 off on orders above ₹499",
        type: "flat",
        value: 100,
        minOrderAmount: 499,
        scope: "platform",
        usageLimit: 1000,
        perUserLimit: 2,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
      {
        code: "SAVE20",
        title: "20% Off",
        description: "20% off up to ₹75",
        type: "percentage",
        value: 20,
        maxDiscount: 75,
        minOrderAmount: 299,
        scope: "platform",
        perUserLimit: 3,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
      {
        code: "TANDOORI30",
        title: "Tandoori Special",
        description: "30% off at Tandoori Nights",
        type: "percentage",
        value: 30,
        maxDiscount: 150,
        minOrderAmount: 399,
        scope: "restaurant",
        restaurant: tandoori._id,
        perUserLimit: 1,
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
    ]);
    console.log(`Created ${coupons.length} coupons`);

    console.log("\nSeed completed successfully!");
    console.log("\nRestaurant owner login: vikram@tandoorinights.com / password123");
    process.exit(0);
  } catch (error) {
    console.error("Seed error:", error.message);
    process.exit(1);
  }
};

seedData();

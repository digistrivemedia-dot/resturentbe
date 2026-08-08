const SupportTicket = require("../models/SupportTicket");
const Order = require("../models/Order");
const Restaurant = require("../models/Restaurant");
const Notification = require("../models/Notification");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { SUPPORT_CATEGORIES, findSubCategory } = require("../utils/supportCategories");
const { getIo } = require("../socket");

// GET /support/categories
const getCategories = async (req, res, next) => {
  try {
    return ApiResponse.send(res, 200, "Support categories fetched", { categories: SUPPORT_CATEGORIES });
  } catch (error) {
    next(error);
  }
};

function buildInitialMessageText({ subCategory, affectedItems, customMessage }) {
  if (subCategory.isOther) return customMessage;
  let text = subCategory.label;
  if (affectedItems?.length > 0) {
    const itemsText = affectedItems.map((i) => `${i.name} x${i.quantity}`).join(", ");
    text += ` (${itemsText})`;
  }
  return text;
}

// POST /support/tickets
const createTicket = async (req, res, next) => {
  try {
    const { orderId, category, subCategory: subCategoryKey, affectedItems, customMessage } = req.body;

    const order = await Order.findOne({ _id: orderId, customer: req.user._id }).lean();
    if (!order) throw new ApiError(404, "Order not found");

    const match = findSubCategory(category, subCategoryKey);
    if (!match) throw new ApiError(400, "Invalid category or sub-category");
    const { category: categoryDef, subCategory: subCategoryDef } = match;

    if (categoryDef.deliveryOnly && order.orderType !== "delivery") {
      throw new ApiError(400, "This category only applies to delivery orders");
    }

    if (subCategoryDef.isOther && !customMessage?.trim()) {
      throw new ApiError(400, "Please describe your issue");
    }

    let validatedItems = [];
    if (subCategoryDef.requiresItems) {
      if (!affectedItems?.length) {
        throw new ApiError(400, "Please select at least one affected item");
      }
      // Snapshot only fields that genuinely belong to this order's line items
      validatedItems = affectedItems
        .map((sel) => {
          const line = order.items.find((i) => String(i.menuItem) === String(sel.menuItem));
          if (!line) return null;
          return { menuItem: line.menuItem, name: line.name, quantity: line.quantity };
        })
        .filter(Boolean);
      if (validatedItems.length === 0) {
        throw new ApiError(400, "Selected items do not belong to this order");
      }
    }

    const initialText = buildInitialMessageText({
      subCategory: subCategoryDef,
      affectedItems: validatedItems,
      customMessage,
    });

    const ticket = await SupportTicket.create({
      order: order._id,
      restaurant: order.restaurant,
      customer: req.user._id,
      category: categoryDef.key,
      categoryLabel: categoryDef.label,
      subCategory: subCategoryDef.key,
      subCategoryLabel: subCategoryDef.label,
      affectedItems: validatedItems,
      customMessage: subCategoryDef.isOther ? customMessage.trim() : undefined,
      messages: [{ from: "customer", text: initialText }],
    });

    // Notify the restaurant owner — persisted notification + real-time push
    const restaurant = await Restaurant.findById(order.restaurant).select("owner name").lean();
    if (restaurant?.owner) {
      await Notification.create({
        user: restaurant.owner,
        title: "New customer issue reported",
        message: `${categoryDef.label} — Order #${order.orderNumber}`,
        type: "support",
        data: { orderId: order._id, restaurantId: order.restaurant, ticketId: ticket._id },
      });
    }

    try {
      const io = getIo();
      if (io) {
        io.to(`restaurant:${order.restaurant}`).emit("new_support_ticket", { ticket });
      }
    } catch (e) {
      // Real-time push is best-effort — the persisted notification above already covers it
    }

    return ApiResponse.send(res, 201, "Issue reported. The restaurant will get back to you within 24h.", { ticket });
  } catch (error) {
    next(error);
  }
};

// GET /support/tickets/order/:orderId
const getTicketsForOrder = async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find({ order: req.params.orderId, customer: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    return ApiResponse.send(res, 200, "Tickets fetched", { tickets });
  } catch (error) {
    next(error);
  }
};

// GET /support/tickets — every ticket the customer has raised, across all orders
const getMyTickets = async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find({ customer: req.user._id })
      .populate("order", "orderNumber")
      .populate("restaurant", "name slug")
      .sort({ status: 1, createdAt: -1 }) // "open" sorts before "resolved" alphabetically
      .lean();
    return ApiResponse.send(res, 200, "Tickets fetched", { tickets });
  } catch (error) {
    next(error);
  }
};

// GET /support/tickets/:id
const getTicketById = async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, customer: req.user._id })
      .populate("restaurant", "name slug")
      .lean();
    if (!ticket) throw new ApiError(404, "Ticket not found");
    return ApiResponse.send(res, 200, "Ticket fetched", { ticket });
  } catch (error) {
    next(error);
  }
};

// POST /support/tickets/:id/messages
const addCustomerMessage = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) throw new ApiError(400, "Message cannot be empty");

    const ticket = await SupportTicket.findOne({ _id: req.params.id, customer: req.user._id });
    if (!ticket) throw new ApiError(404, "Ticket not found");
    if (ticket.status === "resolved") throw new ApiError(400, "This ticket is already resolved");

    ticket.messages.push({ from: "customer", text: text.trim() });
    await ticket.save();

    try {
      const io = getIo();
      if (io) {
        io.to(`restaurant:${ticket.restaurant}`).emit("support_ticket_updated", { ticket });
      }
    } catch (e) {
      // best-effort
    }

    return ApiResponse.send(res, 200, "Message sent", { ticket });
  } catch (error) {
    next(error);
  }
};

module.exports = { getCategories, createTicket, getMyTickets, getTicketsForOrder, getTicketById, addCustomerMessage };

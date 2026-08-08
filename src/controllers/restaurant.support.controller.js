const SupportTicket = require("../models/SupportTicket");
const Notification = require("../models/Notification");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { getIo } = require("../socket");

// GET /restaurant/support/tickets?status=open|resolved
const getTickets = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = { restaurant: req.restaurant._id };
    if (status && status !== "all") query.status = status;

    const tickets = await SupportTicket.find(query)
      .populate("order", "orderNumber status orderType")
      .populate("customer", "name phone email")
      .sort({ status: 1, createdAt: -1 })
      .lean();

    return ApiResponse.send(res, 200, "Tickets fetched", { tickets });
  } catch (error) {
    next(error);
  }
};

// GET /restaurant/support/tickets/:id
const getTicketById = async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, restaurant: req.restaurant._id })
      .populate("order", "orderNumber status orderType items pricing createdAt")
      .populate("customer", "name phone email")
      .lean();
    if (!ticket) throw new ApiError(404, "Ticket not found");
    return ApiResponse.send(res, 200, "Ticket fetched", { ticket });
  } catch (error) {
    next(error);
  }
};

// POST /restaurant/support/tickets/:id/messages
const addRestaurantMessage = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) throw new ApiError(400, "Message cannot be empty");

    const ticket = await SupportTicket.findOne({ _id: req.params.id, restaurant: req.restaurant._id });
    if (!ticket) throw new ApiError(404, "Ticket not found");
    if (ticket.status === "resolved") throw new ApiError(400, "This ticket is already resolved");

    ticket.messages.push({ from: "restaurant", text: text.trim() });
    await ticket.save();

    await Notification.create({
      user: ticket.customer,
      title: "Update on your reported issue",
      message: text.trim().slice(0, 140),
      type: "support",
      data: { orderId: ticket.order, restaurantId: ticket.restaurant, ticketId: ticket._id },
    });

    try {
      const io = getIo();
      if (io) io.to(`customer:${ticket.customer}`).emit("support_ticket_updated", { ticket });
    } catch (e) {
      // best-effort
    }

    return ApiResponse.send(res, 200, "Message sent", { ticket });
  } catch (error) {
    next(error);
  }
};

// PUT /restaurant/support/tickets/:id/resolve
const resolveTicket = async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findOne({ _id: req.params.id, restaurant: req.restaurant._id });
    if (!ticket) throw new ApiError(404, "Ticket not found");
    if (ticket.status === "resolved") throw new ApiError(400, "This ticket is already resolved");

    ticket.status = "resolved";
    ticket.resolvedAt = new Date();
    await ticket.save();

    await Notification.create({
      user: ticket.customer,
      title: "Your reported issue is resolved",
      message: `${req.restaurant.name} marked your issue as resolved.`,
      type: "support",
      data: { orderId: ticket.order, restaurantId: ticket.restaurant, ticketId: ticket._id },
    });

    try {
      const io = getIo();
      if (io) io.to(`customer:${ticket.customer}`).emit("support_ticket_updated", { ticket });
    } catch (e) {
      // best-effort
    }

    return ApiResponse.send(res, 200, "Ticket marked as resolved", { ticket });
  } catch (error) {
    next(error);
  }
};

module.exports = { getTickets, getTicketById, addRestaurantMessage, resolveTicket };

class ApiResponse {
  constructor(statusCode, message, data = null) {
    this.success = statusCode < 400;
    this.message = message;
    this.data = data;
  }

  static send(res, statusCode, message, data = null) {
    return res.status(statusCode).json(new ApiResponse(statusCode, message, data));
  }
}

module.exports = ApiResponse;

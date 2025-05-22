require('dotenv').config();

/**
 * The base URL for the image request handler API.
 * @type {string}
 */
const IMAGE_HANDLER_API_URL = process.env.IMAGE_HANDLER_API_URL || 'http://localhost:7789';

module.exports = {
  IMAGE_HANDLER_API_URL
};
const Role = require('../models/Role');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /api/roles  (solo admin)
 * Lista los roles disponibles para poblar selectores en el panel.
 */
const list = asyncHandler(async (req, res) => {
  res.json(await Role.findAll());
});

module.exports = { list };

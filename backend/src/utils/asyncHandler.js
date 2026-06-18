/**
 * Envuelve un handler async y pasa cualquier error a next() (errorHandler).
 */
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

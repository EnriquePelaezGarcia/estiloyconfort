const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { validateContactMessage } = require('../utils/validators');
const { sendContactMessage } = require('../utils/mailer');

/**
 * Formulario público de Contacto (página /contacto). Sin autenticar: lo usa
 * cualquier visitante, con o sin cuenta.
 */
const contactController = {
  // POST /api/contact
  send: asyncHandler(async (req, res) => {
    const errors = validateContactMessage(req.body);
    if (errors.length) throw ApiError.badRequest(errors.join(', '));

    const { name, email, phone, message } = req.body;

    try {
      await sendContactMessage({
        name: String(name).trim(),
        email: String(email).trim(),
        phone: phone ? String(phone).trim() : null,
        message: String(message).trim(),
      });
    } catch (err) {
      // El correo puede fallar por causas ajenas al usuario (SMTP caído,
      // límite de Resend). Se le informa igual con un mensaje genérico: no
      // hay nada operable que pueda hacer con el detalle técnico.
      console.error('[contact] Falló el envío del correo de contacto:', err.message);
      // 502, no badRequest: la petición del cliente estaba bien formada, lo
      // que falló fue el envío hacia el proveedor de correo.
      throw new ApiError(
        502,
        'No pudimos enviar tu mensaje en este momento. Intenta de nuevo más tarde o escríbenos por WhatsApp.',
      );
    }

    res.json({ message: 'Mensaje enviado. Te responderemos pronto.' });
  }),
};

module.exports = contactController;

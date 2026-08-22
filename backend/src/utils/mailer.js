const nodemailer = require('nodemailer');
const env = require('../config/environment');
const { RESET_TOKEN_TTL_MINUTES } = require('./passwordUtils');

/**
 * Envío de correo transaccional (Docs/plan-modulo-contrasenas.md §5).
 *
 * Modo consola: si falta configuración SMTP, en vez de fallar se escribe el
 * correo en el log. Así el módulo de contraseñas es usable en local sin cuenta
 * de correo, y una llave faltante en staging no tira la API entera.
 */

let transporter = null;
let warnedAboutConsoleMode = false;

function getTransporter() {
  if (!env.mail.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      // 465 es SMTP sobre TLS directo; 587 negocia STARTTLS después de conectar.
      secure: env.mail.port === 465,
      auth: { user: env.mail.user, pass: env.mail.password },
    });
  }
  return transporter;
}

/** Escapa lo que venga del usuario antes de meterlo en el HTML del correo. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Envía un correo. Lanza si el envío real falla; en modo consola nunca lanza.
 *
 * Quien llama decide qué hacer con el fallo. Para la recuperación de
 * contraseña, la respuesta al cliente NO cambia (§4.2 regla 6).
 */
async function sendMail({ to, subject, text, html }) {
  const activeTransporter = getTransporter();

  if (!activeTransporter) {
    if (!warnedAboutConsoleMode) {
      console.warn(
        '⚠️  SMTP no configurado (SMTP_HOST / SMTP_PASS). Los correos se escriben ' +
          'en consola en vez de enviarse.',
      );
      warnedAboutConsoleMode = true;
    }
    console.log('\n──────── CORREO (modo consola) ────────');
    console.log(`Para:    ${to}`);
    console.log(`Asunto:  ${subject}`);
    console.log(text);
    console.log('───────────────────────────────────────\n');
    return { delivered: false, consoleMode: true };
  }

  await activeTransporter.sendMail({ from: env.mail.from, to, subject, text, html });
  return { delivered: true, consoleMode: false };
}

/**
 * Correo de recuperación de contraseña.
 *
 * El enlace se arma con env.clientOrigin (el primer CLIENT_ORIGIN), nunca con
 * un dominio escrito a mano: así los tres ambientes mandan enlaces correctos
 * sin tocar código.
 */
async function sendPasswordResetEmail({ to, fullName, token }) {
  const url = `${env.clientOrigin}/auth/restablecer/${encodeURIComponent(token)}`;
  const firstName = String(fullName || '').trim().split(/\s+/)[0] || '';
  const greeting = firstName ? `Hola ${firstName},` : 'Hola,';

  const text = [
    greeting,
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta en Estilo y Confort.',
    '',
    'Abre este enlace para elegir una nueva contraseña:',
    url,
    '',
    `El enlace vence en ${RESET_TOKEN_TTL_MINUTES} minutos y solo se puede usar una vez.`,
    '',
    'Si no fuiste tú, ignora este mensaje: tu contraseña actual sigue funcionando.',
    '',
    'Mueblería Estilo y Confort',
  ].join('\n');

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.6;max-width:520px">
  <p>${escapeHtml(greeting)}</p>
  <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>Estilo y Confort</strong>.</p>
  <p style="margin:28px 0">
    <a href="${escapeHtml(url)}"
       style="background:#b45309;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block">
      Elegir nueva contraseña
    </a>
  </p>
  <p style="font-size:13px;color:#6b7280">
    El enlace vence en ${RESET_TOKEN_TTL_MINUTES} minutos y solo se puede usar una vez.<br>
    Si el botón no funciona, copia esta dirección en tu navegador:<br>
    <span style="word-break:break-all">${escapeHtml(url)}</span>
  </p>
  <p style="font-size:13px;color:#6b7280">
    Si no fuiste tú, ignora este mensaje: tu contraseña actual sigue funcionando.
  </p>
  <p style="font-size:13px;color:#6b7280">Mueblería Estilo y Confort</p>
</div>`.trim();

  return sendMail({
    to,
    subject: 'Restablece tu contraseña — Estilo y Confort',
    text,
    html,
  });
}

module.exports = { sendMail, sendPasswordResetEmail };

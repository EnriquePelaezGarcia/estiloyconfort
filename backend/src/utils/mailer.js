const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const env = require('../config/environment');
const { RESET_TOKEN_TTL_MINUTES } = require('./passwordUtils');

// Morado exacto tomado del logotipo (public/branding/logo-positivo.png), para
// que el correo de recuperación se sienta parte de la misma marca.
const BRAND_PURPLE = '#4B3554';
const BRAND_PURPLE_DARK = '#372740';
const BRAND_LAVENDER_BG = '#F6F3F9';
const BRAND_LAVENDER_BORDER = '#E4DCEA';

// Copia de 440×129 optimizada para correo (25 KB) del logo original en
// public/branding/, que pesa 156 KB y mide 3031×888: demasiado para un
// header de email. Se adjunta embebida (cid), no como URL externa, porque
// la mayoría de los clientes de correo bloquean imágenes remotas por
// defecto y el logo se vería roto en el primer vistazo.
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'email-logo.png');
const LOGO_CID = 'logo-estiloyconfort';
let logoAttachment = null;
try {
  logoAttachment = {
    filename: 'estilo-y-confort.png',
    content: fs.readFileSync(LOGO_PATH),
    cid: LOGO_CID,
    contentDisposition: 'inline',
  };
} catch {
  // Sin el archivo el correo se manda igual, solo que sin logo. No debe
  // tumbar el arranque del backend por un asset faltante.
}

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
async function sendMail({ to, subject, text, html, attachments, replyTo }) {
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

  await activeTransporter.sendMail({
    from: env.mail.from,
    to,
    subject,
    text,
    html,
    attachments,
    replyTo,
  });
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

  // Tabla, no <div>: es lo único que Outlook de escritorio renderiza sin
  // recortar el fondo ni el ancho. El logo va con width/height explícitos
  // para que el hueco no "salte" el diseño mientras la imagen carga.
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_LAVENDER_BG};padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${BRAND_LAVENDER_BORDER};border-radius:12px;overflow:hidden">
        <tr>
          <td style="background:${BRAND_PURPLE};height:6px;line-height:6px;font-size:1px">&nbsp;</td>
        </tr>
        <tr>
          <td align="center" style="padding:32px 32px 8px">
            <img src="cid:${LOGO_CID}" alt="Mueblería Estilo y Confort" width="220" height="64" style="display:block;width:220px;height:auto">
          </td>
        </tr>
        <tr>
          <td style="padding:16px 36px 8px">
            <p style="margin:0 0 16px;font-size:16px;color:${BRAND_PURPLE_DARK}">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3247">
              Recibimos una solicitud para restablecer la contraseña de tu cuenta en
              <strong>Estilo y Confort</strong>.
            </p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 36px 28px">
            <a href="${escapeHtml(url)}"
               style="background:${BRAND_PURPLE};color:#ffffff;font-size:15px;font-weight:bold;padding:14px 32px;border-radius:8px;text-decoration:none;display:inline-block">
              Elegir nueva contraseña
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 8px">
            <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.6">
              El enlace vence en ${RESET_TOKEN_TTL_MINUTES} minutos y solo se puede usar una vez.
              Si el botón no funciona, copia esta dirección en tu navegador:
            </p>
            <p style="margin:0;font-size:13px;word-break:break-all">
              <a href="${escapeHtml(url)}" style="color:${BRAND_PURPLE}">${escapeHtml(url)}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 36px 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="border-top:1px solid ${BRAND_LAVENDER_BORDER};font-size:1px;line-height:1px">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px 32px">
            <p style="margin:0 0 12px;font-size:13px;color:#6b7280;line-height:1.6">
              Si no fuiste tú, ignora este mensaje: tu contraseña actual sigue funcionando.
            </p>
            <p style="margin:0;font-size:13px;color:${BRAND_PURPLE};font-weight:bold">
              Mueblería Estilo y Confort
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();

  return sendMail({
    to,
    subject: 'Restablece tu contraseña — Estilo y Confort',
    text,
    html,
    attachments: logoAttachment ? [logoAttachment] : undefined,
  });
}

/**
 * Correo del formulario público de Contacto.
 *
 * `replyTo` es el correo del cliente: quien lo reciba en `env.contact.email`
 * puede darle "Responder" directo en su cliente de correo, sin copiar y
 * pegar la dirección a mano.
 */
async function sendContactMessage({ name, email, phone, message }) {
  const safeName = String(name || '').trim() || 'Alguien del sitio';
  const text = [
    `Nombre: ${safeName}`,
    `Correo: ${email}`,
    phone ? `Teléfono: ${phone}` : null,
    '',
    'Mensaje:',
    message,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_LAVENDER_BG};padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${BRAND_LAVENDER_BORDER};border-radius:12px;overflow:hidden">
        <tr>
          <td style="background:${BRAND_PURPLE};height:6px;line-height:6px;font-size:1px">&nbsp;</td>
        </tr>
        <tr>
          <td align="center" style="padding:32px 32px 8px">
            <img src="cid:${LOGO_CID}" alt="Mueblería Estilo y Confort" width="220" height="64" style="display:block;width:220px;height:auto">
          </td>
        </tr>
        <tr>
          <td style="padding:16px 36px 0">
            <p style="margin:0 0 20px;font-size:16px;color:${BRAND_PURPLE_DARK}">
              Nuevo mensaje desde el formulario de contacto del sitio:
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#3f3247;margin-bottom:20px">
              <tr><td style="padding:4px 0;width:90px;color:#6b7280">Nombre</td><td style="padding:4px 0">${escapeHtml(safeName)}</td></tr>
              <tr><td style="padding:4px 0;color:#6b7280">Correo</td><td style="padding:4px 0"><a href="mailto:${escapeHtml(email)}" style="color:${BRAND_PURPLE}">${escapeHtml(email)}</a></td></tr>
              ${phone ? `<tr><td style="padding:4px 0;color:#6b7280">Teléfono</td><td style="padding:4px 0">${escapeHtml(phone)}</td></tr>` : ''}
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#6b7280">Mensaje</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3247;white-space:pre-wrap;border-left:3px solid ${BRAND_LAVENDER_BORDER};padding-left:12px">${escapeHtml(message)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 32px">
            <p style="margin:0;font-size:13px;color:#6b7280">
              Responde este correo para contestarle directo a ${escapeHtml(safeName)}.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();

  return sendMail({
    to: env.contact.email,
    subject: `Contacto desde el sitio — ${safeName}`,
    text,
    html,
    attachments: logoAttachment ? [logoAttachment] : undefined,
    replyTo: email,
  });
}

module.exports = { sendMail, sendPasswordResetEmail, sendContactMessage };

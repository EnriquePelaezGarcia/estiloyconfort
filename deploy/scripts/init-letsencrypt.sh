#!/usr/bin/env bash
#
# Obtiene los certificados SSL por primera vez. Se ejecuta UNA sola vez,
# después de apuntar los DNS al servidor. Las renovaciones ya son automáticas
# (las hace el contenedor `certbot`).
#
#   ./init-letsencrypt.sh tucorreo@ejemplo.com
#
# El problema del huevo y la gallina: Nginx no arranca sin certificados, pero
# Certbot necesita que Nginx esté arriba para validar el dominio. La solución
# es crear certificados falsos, arrancar Nginx, pedir los reales y recargar.

set -euo pipefail

EMAIL="${1:-}"
if [[ -z "${EMAIL}" ]]; then
  echo "Uso: $0 tu-correo@ejemplo.com" >&2
  echo "  (Let's Encrypt lo usa para avisarte si un certificado va a expirar)" >&2
  exit 1
fi

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${DEPLOY_DIR}"

DOMAIN="estiloyconfortm.com"
DOMAINS=(
  "estiloyconfortm.com"
  "www.estiloyconfortm.com"
  "api.estiloyconfortm.com"
  "dev.estiloyconfortm.com"
  "api-dev.estiloyconfortm.com"
)

# Cambia a 1 para practicar sin gastar intentos. Let's Encrypt permite solo
# 5 certificados por dominio por semana; con staging puedes equivocarte sin
# quedarte bloqueado. Los certificados de prueba NO son válidos en navegadores.
STAGING=${STAGING:-0}

echo "🔐 Configurando SSL para: ${DOMAINS[*]}"
echo

echo "⚠️  Antes de continuar, verifica que los DNS ya apuntan a este servidor."
echo "    Los 5 dominios deben resolver a: $(curl -s https://ifconfig.me || echo '<IP de tu VPS>')"
echo
read -rp "¿Los DNS ya están configurados y propagados? [s/N] " answer
[[ "${answer}" =~ ^[sS]$ ]] || { echo "Configura los DNS primero (ver DEPLOY.md, paso 5)."; exit 1; }

# ---- 1. Parámetros TLS recomendados ----
echo "📄 Descargando configuración TLS recomendada..."
docker compose run --rm --entrypoint sh certbot -c '
  if [ ! -e /etc/letsencrypt/options-ssl-nginx.conf ]; then
    wget -qO /etc/letsencrypt/options-ssl-nginx.conf \
      https://raw.githubusercontent.com/certbot/certbot/main/certbot-nginx/src/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf
  fi
  if [ ! -e /etc/letsencrypt/ssl-dhparams.pem ]; then
    wget -qO /etc/letsencrypt/ssl-dhparams.pem \
      https://raw.githubusercontent.com/certbot/certbot/main/certbot/certbot/ssl-dhparams.pem
  fi'

# ---- 2. Certificado falso para que Nginx pueda arrancar ----
echo "🔧 Creando certificado temporal..."
docker compose run --rm --entrypoint sh certbot -c "
  mkdir -p /etc/letsencrypt/live/${DOMAIN} &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
    -subj '/CN=localhost'"

echo "▶️  Arrancando Nginx..."
docker compose up -d nginx
sleep 5

# ---- 3. Borrar el falso y pedir el real ----
echo "🗑️  Eliminando certificado temporal..."
docker compose run --rm --entrypoint sh certbot -c "rm -rf /etc/letsencrypt/live/${DOMAIN} /etc/letsencrypt/archive/${DOMAIN} /etc/letsencrypt/renewal/${DOMAIN}.conf"

DOMAIN_ARGS=()
for d in "${DOMAINS[@]}"; do DOMAIN_ARGS+=(-d "$d"); done

STAGING_ARG=()
[[ "${STAGING}" != "0" ]] && STAGING_ARG=(--staging)

echo "📜 Solicitando certificado real a Let's Encrypt..."
docker compose run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  "${STAGING_ARG[@]}" \
  "${DOMAIN_ARGS[@]}" \
  --email "${EMAIL}" \
  --rsa-key-size 4096 \
  --agree-tos \
  --no-eff-email \
  --non-interactive

echo "🔄 Recargando Nginx con el certificado real..."
docker compose exec nginx nginx -s reload

echo
echo "✅ SSL configurado. Verifica en: https://${DOMAIN}"
echo "   Las renovaciones son automáticas (contenedor certbot, cada 12 h)."

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

# ---- 1. Parámetros TLS ----
#
# Antes esto se descargaba del repositorio de certbot en GitHub, pero esas
# rutas cambian entre versiones y el script moría con un 404. Ahora se generan
# aquí: sin dependencias de red, y los parámetros Diffie-Hellman quedan únicos
# de este servidor en vez de ser los mismos que usa todo el mundo.
echo "📄 Preparando configuración TLS..."
docker compose run --rm --entrypoint sh certbot -c '
  if [ ! -e /etc/letsencrypt/options-ssl-nginx.conf ]; then
    cat > /etc/letsencrypt/options-ssl-nginx.conf <<EOF
# Parámetros TLS basados en las recomendaciones de Mozilla (perfil intermedio).
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;

ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;

ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:DHE-RSA-CHACHA20-POLY1305";
EOF
    echo "   options-ssl-nginx.conf creado."
  else
    echo "   options-ssl-nginx.conf ya existe."
  fi

  if [ ! -e /etc/letsencrypt/ssl-dhparams.pem ]; then
    echo "   Generando parámetros Diffie-Hellman de 2048 bits (tarda ~1 min)..."
    openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048 2>/dev/null
    echo "   ssl-dhparams.pem generado."
  else
    echo "   ssl-dhparams.pem ya existe."
  fi'

# ---- 2. Certificado falso para que Nginx pueda arrancar ----
echo "🔧 Creando certificado temporal..."
docker compose run --rm --entrypoint sh certbot -c "
  mkdir -p /etc/letsencrypt/live/${DOMAIN} &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
    -subj '/CN=localhost'"

# Nginx resuelve los nombres de sus upstreams (frontend-prod, backend-prod,
# frontend-staging, backend-staging) AL ARRANCAR, no cuando llega la primera
# petición. Si alguno de los cuatro no existe todavía, Nginx muere con
# `host not found in upstream`. Por eso se levanta todo, no solo nginx:
# `depends_on` únicamente declara los dos de producción.
echo "▶️  Arrancando todos los servicios..."
docker compose up -d

echo "⏳ Esperando a que Nginx responda..."
for i in $(seq 1 30); do
  if docker compose exec -T nginx nginx -t >/dev/null 2>&1; then
    echo "   Nginx arriba."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "❌ Nginx no arrancó. Revisa:  docker compose logs nginx" >&2
    exit 1
  fi
  sleep 2
done

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

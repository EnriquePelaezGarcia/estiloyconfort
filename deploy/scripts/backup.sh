#!/usr/bin/env bash
#
# Respalda la base de datos y las imágenes subidas.
#
#   ./backup.sh production
#   ./backup.sh staging
#
# Guarda en /opt/estiloyconfort/backups y conserva los últimos 14 días.
#
# ⚠️ Un respaldo que vive solo en el mismo servidor NO es un respaldo: si el
#    disco muere, se pierde todo. Ver DEPLOY.md, sección "Respaldos fuera del
#    servidor", para copiarlos a tu máquina o a Hetzner Storage Box.

set -euo pipefail

ENVIRONMENT="${1:-production}"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="/opt/estiloyconfort/backups/${ENVIRONMENT}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
RETENTION_DAYS=14

case "${ENVIRONMENT}" in
  production) DB_SERVICE="db-prod";    UPLOADS_VOLUME="estiloyconfort_uploads-prod";    ENV_FILE="${DEPLOY_DIR}/.env.production" ;;
  staging)    DB_SERVICE="db-staging"; UPLOADS_VOLUME="estiloyconfort_uploads-staging"; ENV_FILE="${DEPLOY_DIR}/.env.staging" ;;
  *) echo "Uso: $0 [production|staging]" >&2; exit 1 ;;
esac

mkdir -p "${BACKUP_DIR}"
cd "${DEPLOY_DIR}"

# Credenciales de la base, leídas del .env del ambiente.
DB_USER="$(grep -E '^DB_USER=' "${ENV_FILE}" | cut -d= -f2-)"
DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "${ENV_FILE}" | cut -d= -f2-)"
DB_NAME="$(grep -E '^DB_NAME=' "${ENV_FILE}" | cut -d= -f2-)"

# ---- Base de datos ----
DB_FILE="${BACKUP_DIR}/db_${STAMP}.sql.gz"
# --single-transaction evita bloquear las tablas mientras se respalda,
# así el sitio sigue funcionando durante el volcado.
docker compose exec -T -e MYSQL_PWD="${DB_PASSWORD}" "${DB_SERVICE}" \
  mysqldump --single-transaction --quick --routines --events \
            -u "${DB_USER}" "${DB_NAME}" \
  | gzip > "${DB_FILE}"

# Un volcado vacío o truncado no sirve de nada: mejor fallar ruidosamente.
if [[ ! -s "${DB_FILE}" ]] || [[ "$(stat -c%s "${DB_FILE}")" -lt 1024 ]]; then
  echo "❌ El respaldo de la base salió vacío o truncado: ${DB_FILE}" >&2
  rm -f "${DB_FILE}"
  exit 1
fi

# ---- Imágenes subidas ----
UPLOADS_FILE="${BACKUP_DIR}/uploads_${STAMP}.tar.gz"
docker run --rm \
  -v "${UPLOADS_VOLUME}:/data:ro" \
  -v "${BACKUP_DIR}:/backup" \
  alpine tar czf "/backup/uploads_${STAMP}.tar.gz" -C /data .

# ---- Rotación ----
find "${BACKUP_DIR}" -name '*.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "✅ Respaldo de ${ENVIRONMENT} completo:"
echo "   $(du -h "${DB_FILE}" | cut -f1)  ${DB_FILE}"
echo "   $(du -h "${UPLOADS_FILE}" | cut -f1)  ${UPLOADS_FILE}"

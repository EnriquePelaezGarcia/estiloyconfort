#!/usr/bin/env bash
#
# Despliega un ambiente. Se ejecuta EN EL SERVIDOR.
#
#   ./deploy.sh staging      → publica la rama `development`
#   ./deploy.sh production   → publica la rama `main`
#
# Trae los últimos cambios de git, reconstruye las imágenes y reinicia solo
# los contenedores de ese ambiente. El otro ambiente no se toca.

set -euo pipefail

ENVIRONMENT="${1:-}"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "${DEPLOY_DIR}/../.." && pwd)"

case "${ENVIRONMENT}" in
  production)
    BRANCH="main"
    WORKTREE="${ROOT_DIR}/app"
    SERVICES="backend-prod frontend-prod"
    ;;
  staging)
    BRANCH="development"
    WORKTREE="${ROOT_DIR}/app-staging"
    SERVICES="backend-staging frontend-staging"
    ;;
  *)
    echo "Uso: $0 [production|staging]" >&2
    exit 1
    ;;
esac

# Evita que dos despliegues corran a la vez y se pisen entre ellos.
LOCK="/tmp/estiloyconfort-deploy.lock"
exec 9>"${LOCK}"
if ! flock -n 9; then
  echo "❌ Ya hay un despliegue en curso. Espera a que termine." >&2
  exit 1
fi

echo "🚀 Desplegando ${ENVIRONMENT} (rama ${BRANCH})"
echo

# ---- 1. Traer el código nuevo ----
echo "📥 Actualizando ${WORKTREE}..."
git -C "${WORKTREE}" fetch --prune origin
git -C "${WORKTREE}" checkout "${BRANCH}"
git -C "${WORKTREE}" reset --hard "origin/${BRANCH}"
COMMIT="$(git -C "${WORKTREE}" rev-parse --short HEAD)"
echo "   Commit: ${COMMIT} — $(git -C "${WORKTREE}" log -1 --pretty=%s)"
echo

# En producción, respaldar la base ANTES de tocar nada: si la migración o el
# código nuevo rompen algo, se puede volver atrás.
if [[ "${ENVIRONMENT}" == "production" ]]; then
  echo "💾 Respaldando base de datos antes del despliegue..."
  "${DEPLOY_DIR}/scripts/backup.sh" production
  echo
fi

# ---- 2. Reconstruir imágenes ----
echo "🔨 Construyendo imágenes..."
cd "${DEPLOY_DIR}"
# shellcheck disable=SC2086
docker compose build ${SERVICES}
echo

# ---- 3. Reemplazar contenedores ----
echo "♻️  Reiniciando contenedores..."
# shellcheck disable=SC2086
docker compose up -d ${SERVICES}
echo

# ---- 4. Verificar que arrancó bien ----
echo "🔍 Verificando salud del API..."
BACKEND_SERVICE="$(echo "${SERVICES}" | awk '{print $1}')"
for i in $(seq 1 30); do
  if docker compose exec -T "${BACKEND_SERVICE}" \
       node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "   ✅ API respondiendo"
    break
  fi
  if [[ "${i}" -eq 30 ]]; then
    echo "   ❌ El API no respondió tras 60 s. Revisa los logs:" >&2
    echo "      docker compose logs --tail=50 ${BACKEND_SERVICE}" >&2
    exit 1
  fi
  sleep 2
done

# ---- 5. Limpiar imágenes viejas ----
# Sin esto el disco de 40 GB se llena de capas huérfanas en pocos meses.
docker image prune -f >/dev/null

echo
echo "✅ ${ENVIRONMENT} desplegado correctamente (${COMMIT})"

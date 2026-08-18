#!/bin/bash
#
# Genera los tres archivos de secretos (.env, .env.production, .env.staging)
# con contraseñas aleatorias, a partir de los .example.
#
# Por qué existe: los valores tienen que coincidir entre archivos
# (PROD_DB_PASSWORD del .env == DB_PASSWORD del .env.production, o el backend
# no puede conectarse a MySQL y el error no dice por qué). Hacerlo a mano con
# copiar y pegar es la forma más común de romper el despliegue.
#
# Uso:  ./deploy/scripts/init-secrets.sh
#
# No sobrescribe nada: si los archivos ya existen, se detiene.

set -euo pipefail

cd "$(dirname "$0")/.."   # -> deploy/

# ---------- 1. No destruir secretos existentes ----------
for f in .env .env.production .env.staging; do
  if [ -f "$f" ]; then
    echo "❌ Ya existe $f"
    echo "   Este script no sobrescribe secretos. Si de verdad quieres"
    echo "   regenerarlos, muévelos antes:  mv $f $f.viejo"
    echo ""
    echo "   ⚠️ Regenerar las contraseñas de MySQL NO cambia las de una base"
    echo "      de datos ya creada: el contenedor solo las aplica la primera"
    echo "      vez. Tendrías que borrar el volumen para que surtan efecto."
    exit 1
  fi
done

for f in .env.example .env.production.example .env.staging.example; do
  [ -f "$f" ] || { echo "❌ Falta $f (¿estás en la carpeta deploy/?)"; exit 1; }
done

# ---------- 2. Generar ----------
# `tr -d '/+='` quita los caracteres que rompen algunos parsers de .env y las
# URLs de conexión. Quedan solo alfanuméricos, lo que también hace seguro
# usarlos con sed más abajo.
gen() { openssl rand -base64 "$1" | tr -d '/+=\n'; }

PROD_DB_PASS=$(gen 32)
PROD_DB_ROOT=$(gen 32)
STAGING_DB_PASS=$(gen 32)
STAGING_DB_ROOT=$(gen 32)

PROD_JWT_ACCESS=$(gen 48)
PROD_JWT_REFRESH=$(gen 48)
STAGING_JWT_ACCESS=$(gen 48)
STAGING_JWT_REFRESH=$(gen 48)

# ---------- 3. Escribir ----------
cp .env.example .env
sed -i "s|^PROD_DB_PASSWORD=.*|PROD_DB_PASSWORD=${PROD_DB_PASS}|" .env
sed -i "s|^PROD_DB_ROOT_PASSWORD=.*|PROD_DB_ROOT_PASSWORD=${PROD_DB_ROOT}|" .env
sed -i "s|^STAGING_DB_PASSWORD=.*|STAGING_DB_PASSWORD=${STAGING_DB_PASS}|" .env
sed -i "s|^STAGING_DB_ROOT_PASSWORD=.*|STAGING_DB_ROOT_PASSWORD=${STAGING_DB_ROOT}|" .env

cp .env.production.example .env.production
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${PROD_DB_PASS}|" .env.production
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=${PROD_JWT_ACCESS}|" .env.production
sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${PROD_JWT_REFRESH}|" .env.production

cp .env.staging.example .env.staging
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${STAGING_DB_PASS}|" .env.staging
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=${STAGING_JWT_ACCESS}|" .env.staging
sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${STAGING_JWT_REFRESH}|" .env.staging

# Solo el dueño puede leerlos.
chmod 600 .env .env.production .env.staging

# ---------- 4. Verificar que no quedó ningún hueco ----------
huecos=0
for f in .env .env.production .env.staging; do
  vacias=$(grep -nE '^[A-Z_]+=$' "$f" || true)
  if [ -n "$vacias" ]; then
    echo "⚠️  $f tiene variables sin valor:"
    echo "$vacias"
    huecos=1
  fi
done

if [ "$huecos" -ne 0 ]; then
  echo ""
  echo "❌ Quedaron variables vacías. Revísalas antes de desplegar."
  exit 1
fi

# ---------- 5. Comprobar que las contraseñas coinciden entre archivos ----------
a=$(grep '^PROD_DB_PASSWORD=' .env | cut -d= -f2-)
b=$(grep '^DB_PASSWORD=' .env.production | cut -d= -f2-)
[ "$a" = "$b" ] || { echo "❌ PROD_DB_PASSWORD no coincide con .env.production"; exit 1; }

a=$(grep '^STAGING_DB_PASSWORD=' .env | cut -d= -f2-)
b=$(grep '^DB_PASSWORD=' .env.staging | cut -d= -f2-)
[ "$a" = "$b" ] || { echo "❌ STAGING_DB_PASSWORD no coincide con .env.staging"; exit 1; }

# Producción y staging no deben compartir secretos JWT: un token robado en
# pruebas no debe abrir producción.
a=$(grep '^JWT_ACCESS_SECRET=' .env.production | cut -d= -f2-)
b=$(grep '^JWT_ACCESS_SECRET=' .env.staging | cut -d= -f2-)
[ "$a" != "$b" ] || { echo "❌ Los JWT de producción y staging son iguales"; exit 1; }

echo "✅ Secretos generados y verificados:"
echo "   $(pwd)/.env"
echo "   $(pwd)/.env.production"
echo "   $(pwd)/.env.staging"
echo ""
echo "   Permisos 600 (solo $(id -un) puede leerlos)."
echo "   Las contraseñas de MySQL coinciden entre archivos."
echo "   Los secretos JWT de producción y staging son distintos."
echo ""
echo "📋 GUARDA UNA COPIA FUERA DEL SERVIDOR (gestor de contraseñas)."
echo "   Si pierdes el servidor sin respaldo de estos archivos, la copia"
echo "   de seguridad de MySQL te sirve, pero todas las sesiones abiertas"
echo "   de tus usuarios se invalidan al cambiar los secretos JWT."
echo ""
echo "   Para verlos:  cat deploy/.env deploy/.env.production deploy/.env.staging"

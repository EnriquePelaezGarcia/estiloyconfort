#!/usr/bin/env bash
# Compara el esquema de la BD de producción contra la de staging.
# Copiar al servidor con scp y correr:  ssh estiloyconfort 'bash /tmp/schema-diff.sh'
set -euo pipefail
export LC_ALL=C
cd /opt/estiloyconfort/app/deploy
PP=$(grep "^DB_PASSWORD=" .env.production | cut -d= -f2-)
SP=$(grep "^DB_PASSWORD=" .env.staging   | cut -d= -f2-)

qc='SELECT CONCAT(table_name,".",column_name) FROM information_schema.columns WHERE table_schema=DATABASE()'
qt='SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()'

dump() { docker compose exec -T -e MYSQL_PWD="$2" "$1" mysql -u estilo estilo_confort -N -e "$3" | tr -d '\r' | LC_ALL=C sort; }

dump db-prod    "$PP" "$qc" > /tmp/prod_cols.txt
dump db-staging "$SP" "$qc" > /tmp/stg_cols.txt
dump db-prod    "$PP" "$qt" > /tmp/prod_tbl.txt
dump db-staging "$SP" "$qt" > /tmp/stg_tbl.txt

echo "=== prod: $(wc -l < /tmp/prod_tbl.txt) tablas / $(wc -l < /tmp/prod_cols.txt) columnas | staging: $(wc -l < /tmp/stg_tbl.txt) tablas / $(wc -l < /tmp/stg_cols.txt) columnas ==="
echo
echo "=== TABLAS en staging que NO existen en prod ==="
comm -13 /tmp/prod_tbl.txt /tmp/stg_tbl.txt
echo
echo "=== TABLAS en prod que NO existen en staging ==="
comm -23 /tmp/prod_tbl.txt /tmp/stg_tbl.txt
echo
echo "=== COLUMNAS nuevas en tablas que YA existen en prod ==="
comm -13 /tmp/prod_cols.txt /tmp/stg_cols.txt | while read c; do
  t="${c%%.*}"
  grep -qx "$t" /tmp/prod_tbl.txt && echo "$c"
done
echo
echo "=== En prod pero NO en staging (deriva a revisar) ==="
comm -23 /tmp/prod_cols.txt /tmp/stg_cols.txt

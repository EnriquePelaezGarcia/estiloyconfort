---
name: desplegar-preprod
description: Despliega la rama development a preproducción (dev.estiloyconfortm.com) siguiendo la checklist completa — avisa de migraciones .sql y variables de entorno nuevas ANTES de tocar el servidor, y verifica el resultado. Úsalo solo cuando el usuario lo pida explícitamente.
disable-model-invocation: true
---

# Desplegar a preproducción

Publica `origin/development` en **dev.estiloyconfortm.com** (por dentro el
ambiente se llama `staging`). Producción es otra cosa y **no** se toca aquí.

## Antes de nada

Este skill se ejecuta **solo cuando el usuario lo pide**. Nunca despliegues
por iniciativa propia ni "de pasada" al terminar un cambio.

Todos los comandos contra el VPS van por **PowerShell**, no por Bash: la
llave `id_ed25519_v2` tiene passphrase y solo el agente de Windows la tiene
cargada. Desde Git Bash siempre da `Permission denied (publickey)`.

Escribe los comandos SIEMPRE como `ssh estiloyconfort '<comando>'`, con el
host pegado a `ssh` y sin banderas `-o` delante: la regla de permisos de
`.claude/settings.json` (`PowerShell(ssh estiloyconfort *)`) es un prefijo, así
que cualquier otra forma vuelve a pedir aprobación.

Si el `ssh` se cuelga o falla por la llave, es que el agente de Windows no la
tiene cargada: pídele al usuario que corra una vez
`ssh-add ~/.ssh/id_ed25519_v2` en su terminal. No intentes rodearlo.

## Datos del ambiente

| | |
|---|---|
| Host SSH | `estiloyconfort` (alias en `~/.ssh/config`, usuario `enrique`) |
| Worktree | `/opt/estiloyconfort/app-staging` (rama `development`) |
| Script | `/opt/estiloyconfort/app/deploy/scripts/deploy.sh staging` |
| URL | `https://dev.estiloyconfortm.com` · API `https://api-dev.estiloyconfortm.com` |
| Contenedores | `estiloyconfort-{backend,frontend,db}-staging-1` |

## Paso 1 — Qué va a salir

El deploy hace `git reset --hard origin/development`: publica **la rama
entera**, no solo el cambio en el que estabas trabajando.

```bash
git fetch
git status --short                       # ¿hay trabajo sin commitear?
git log --oneline origin/development..development   # ¿hay commits sin pushear?
```

Y el commit que hoy corre en el servidor:

```powershell
ssh estiloyconfort 'git -C /opt/estiloyconfort/app-staging log --oneline -1'
```

Enséñale al usuario la lista de commits que van a salir (los que hay entre el
commit desplegado y `origin/development`). Si hay trabajo de otras sesiones
que él no esperaba publicar, **pregúntale antes de seguir**.

## Paso 2 — Migraciones y variables de entorno

`deploy.sh` hace git → build → up → health check. **No aplica `.sql` ni
actualiza los `.env`.** Estos dos chequeos son la razón de existir de este
skill; no los saltes.

Con `<desplegado>` = el commit que corre en el servidor:

```bash
git diff --name-only <desplegado>..origin/development -- '*.sql'
git diff <desplegado>..origin/development -- backend/.env.example
```

- **Si hay `.sql` nuevos**: hay que correrlos en la base de staging **antes**
  del deploy (`node src/database/run-schema.js <archivo>.sql` dentro del
  contenedor del backend). Dile al usuario cuáles son y confirma antes de
  tocar la base.
- **Si `.env.example` cambió**: el `.env.staging` del servidor probablemente
  no tiene las variables nuevas. El deploy va a decir "✅ correctamente" y la
  función nueva va a fallar en silencio. Avísale al usuario qué variables
  faltan; él pone los valores — **nunca le pidas que pegue secretos en el
  chat**, ni los imprimas en la salida de un comando.

## Paso 3 — Publicar

Si hay commits locales sin pushear y el usuario quiere incluirlos, `git push
origin development` primero. Luego:

```powershell
ssh estiloyconfort '/opt/estiloyconfort/app/deploy/scripts/deploy.sh staging 2>&1'
```

Tarda varios minutos (reconstruye las imágenes de Angular SSR y del API), así
que lánzalo en segundo plano y avisa cuando termine. Producción no se toca:
el script solo levanta `backend-staging` y `frontend-staging`.

## Paso 4 — Verificar

No des por bueno el "✅" del script sin comprobar que el cambio está servido:

```powershell
ssh estiloyconfort 'git -C /opt/estiloyconfort/app-staging log --oneline -1'
ssh estiloyconfort 'docker exec estiloyconfort-frontend-staging-1 grep -rl <texto-nuevo> /app/dist/estiloyconfort/browser | head -3'
```

Reporta: commit desplegado, health del API (lo imprime el script) y la
evidencia de que el bundle trae el cambio. Recuérdale al usuario recargar con
**Ctrl+Shift+R**: el caché del navegador es la causa más común de "sigo
viendo lo viejo".

## Comillas en PowerShell → ssh

PowerShell se come las comillas dobles al pasar argumentos a `ssh.exe`. Para
comandos remotos con comillas anidadas (`docker inspect --format`, `mysql
-e`), escribe el script en un archivo, cópialo con `scp` y ejecútalo allá.
Canalizarlo con `Get-Content | ssh bash -s` **no** funciona: PowerShell le
mete BOM y CRLF.

## Producción es otra conversación

`estiloyconfortm.com` corre la rama `main` y hoy va muy por detrás de
`development`. Estrenarla implica respaldo previo, aplicar todos los `.sql`
pendientes (a agosto 2026 le falta al menos `schema_product_list_price.sql`)
y `./deploy.sh production`. Nada de eso es parte de este skill.

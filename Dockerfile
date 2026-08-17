# Imagen del frontend Angular con SSR (Server-Side Rendering).
# Multi-etapa: la etapa `build` trae todo el toolchain de Angular (~500 MB),
# pero solo el resultado compilado pasa a la imagen final.

# ---------- Etapa 1: compilar ----------
FROM node:22-alpine AS build

WORKDIR /app

# Aquí sí se instalan las devDependencies: el Angular CLI vive ahí.
COPY package*.json ./
RUN npm ci

COPY . .

# Qué environment usar: "production" o "staging".
# Lo define docker-compose.yml con `args:` (ver deploy/docker-compose.yml).
ARG BUILD_CONFIGURATION=production
RUN npx ng build --configuration=${BUILD_CONFIGURATION}

# ---------- Etapa 2: ejecutar ----------
FROM node:22-alpine AS runtime

ENV TZ=America/Mexico_City
ENV NODE_ENV=production
RUN apk add --no-cache tzdata

WORKDIR /app

# Solo el bundle compilado: sin código fuente, sin node_modules, sin toolchain.
# El SSR de Angular empaqueta express, qrcode y heic2any dentro de dist/; lo
# único que necesita de fuera son módulos nativos de Node. Verificado con:
#   grep -rhoE 'from"[a-z@][^"]*"' dist/estiloyconfort/server/*.mjs | sort -u
COPY --from=build /app/dist ./dist

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/estiloyconfort/server/server.mjs"]

# Imagen del API (Express + MySQL).
FROM node:22-alpine

# Zona horaria: los cron jobs (limpieza de cotizaciones, gastos fijos,
# recordatorios de entrega) dependen de la hora local, no de UTC.
ENV TZ=America/Mexico_City
RUN apk add --no-cache tzdata

WORKDIR /app

# Se copian primero los manifiestos para que Docker cachee `npm ci`
# y no reinstale dependencias en cada cambio de código.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Carpeta de imágenes subidas. En el servidor se monta un volumen encima,
# de modo que las fotos sobreviven a cada redespliegue.
RUN mkdir -p uploads/products uploads/categories

# No correr como root: si alguien logra ejecutar código, queda sin privilegios.
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]

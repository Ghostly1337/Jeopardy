# Jeopardy – Image für den eigenen Server (Coolify). Startet server.mjs auf Port 3000.
# Nur Laufzeit-Abhängigkeiten, nur die Dateien, die der Server braucht; läuft nicht als root.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node server.mjs middleware.js index.html host.html player.html editor.html ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node js ./js
COPY --chown=node:node css ./css
COPY --chown=node:node fonts ./fonts
COPY --chown=node:node icons ./icons
COPY --chown=node:node vendor ./vendor
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/__login || exit 1
CMD ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "server.mjs"]

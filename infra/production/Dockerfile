# Images de production (tâche 11, ADR 0016), construites depuis la racine du dépôt :
#   docker compose -f infra/production/compose.yml build
#
#   · api : l'API seule, avec ses seules dépendances de production, sans droits root ;
#   · web : Caddy (HTTPS automatique) avec la gestion et l'espace client construits, qui transmet /api à l'API.
# Le site vitrine est publié à part (Netlify, apps/site-vitrine/LISEZMOI.md).

FROM node:22-bookworm-slim AS construction
WORKDIR /depot
# Dépendances d'abord : cette étape reste en cache tant que package-lock.json ne change pas
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/portail/package.json apps/portail/
COPY apps/site-vitrine/package.json apps/site-vitrine/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w @dbs/api && npm run build -w @dbs/admin && npm run build -w @dbs/portail
# Ne garder que les dépendances de production de l'API
RUN rm -rf node_modules apps/*/node_modules && npm ci --omit=dev --workspace @dbs/api --include-workspace-root=false --no-audit --no-fund

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=construction /depot/package.json ./
COPY --from=construction /depot/node_modules ./node_modules
COPY --from=construction /depot/apps/api/package.json ./apps/api/
COPY --from=construction /depot/apps/api/dist ./apps/api/dist
# Fichiers en lecture seule pour le compte qui fait tourner l'API
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/sante').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "apps/api/dist/serveur.js"]

FROM caddy:2.10-alpine AS web
COPY --from=construction /depot/apps/admin/dist /srv/gestion
COPY --from=construction /depot/apps/portail/dist /srv/client
COPY infra/production/Caddyfile /etc/caddy/Caddyfile

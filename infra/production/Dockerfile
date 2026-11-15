# Images de production de DBS-ASSURANCES (infra/production/compose.yml). Contexte : la racine du dépôt.
#   docker build -f infra/production/Dockerfile --target api -t dbs-api .
#   docker build -f infra/production/Dockerfile --target web -t dbs-web .
# Deux images, construites à partir du même code : l'API (Node.js, sans outil de compilation ni dépendance de
# développement, lancée sans privilège) et le serveur web (Caddy : HTTPS automatique, en-têtes de sécurité,
# back-office et espace client servis en fichiers statiques, API derrière /api).

# ---------- Construction : tout le code, compilé une fois ----------
FROM node:22-bookworm-slim AS construction
WORKDIR /depot
# Dépendances d'abord : cette étape reste en cache tant que package-lock.json ne change pas
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/portail/package.json apps/portail/
COPY apps/site-vitrine/package.json apps/site-vitrine/
RUN npm ci --no-audit --no-fund --workspace @dbs/api --workspace @dbs/admin --workspace @dbs/portail
COPY apps/api apps/api
COPY apps/admin apps/admin
COPY apps/portail apps/portail
RUN npm run build -w @dbs/api \
  && npm run build -w @dbs/admin \
  && npm run build -w @dbs/portail

# ---------- API ----------
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
# Dépendances de production de l'API seulement (quatre : fastify, @fastify/cookie, pg, @node-rs/argon2)
COPY --from=construction /depot/package.json /depot/package-lock.json ./
COPY --from=construction /depot/apps/api/package.json apps/api/
COPY --from=construction /depot/apps/admin/package.json apps/admin/
COPY --from=construction /depot/apps/portail/package.json apps/portail/
COPY --from=construction /depot/apps/site-vitrine/package.json apps/site-vitrine/
RUN npm ci --omit=dev --no-audit --no-fund --workspace @dbs/api && npm cache clean --force
COPY --from=construction /depot/apps/api/dist apps/api/dist
# Jamais root : l'utilisateur « node » de l'image, sans droit d'écriture sur le code
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/sante').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "apps/api/dist/serveur.js"]

# ---------- Serveur web : Caddy, back-office et espace client ----------
FROM caddy:2.10-alpine AS web
COPY infra/production/Caddyfile /etc/caddy/Caddyfile
COPY --from=construction /depot/apps/admin/dist /srv/gestion
COPY --from=construction /depot/apps/portail/dist /srv/portail

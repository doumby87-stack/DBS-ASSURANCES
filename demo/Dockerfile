# Image de la démonstration locale (demo/compose.yml) : tout le projet construit, lancé par demo/lanceur.mjs.
# Jamais pour la production : ses clés et mots de passe sont publics.
FROM node:22-bookworm-slim

# La base est préparée par le conteneur PostgreSQL (demo/preparer-base.sh) : rien d'autre à installer ici
WORKDIR /depot

# Dépendances d'abord : cette étape reste en cache tant que package-lock.json ne change pas
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/portail/package.json apps/portail/
COPY apps/site-vitrine/package.json apps/site-vitrine/
RUN npm ci --no-audit --no-fund

COPY . .
# Le site appelle l'API de la démonstration pour enregistrer les demandes (devis, rendez-vous, rappels…)
RUN npm run build -w @dbs/api \
  && npm run build -w @dbs/admin \
  && npm run build -w @dbs/portail \
  && URL_API=http://localhost:3000 npm run build -w @dbs/site-vitrine

ENV NODE_ENV=development DEMO_BASE_PREPAREE=oui
EXPOSE 8080 3000 4173 4174 4321
HEALTHCHECK --interval=5s --timeout=3s --start-period=120s --retries=24 \
  CMD node -e "fetch('http://127.0.0.1:8080/etat.json').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "demo/lanceur.mjs"]

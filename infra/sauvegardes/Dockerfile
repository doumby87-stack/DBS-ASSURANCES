# Conteneur des sauvegardes et de la surveillance (infra/production/compose.yml, service « sauvegarde »).
# Contexte : le dossier infra/.
#   docker build -f infra/sauvegardes/Dockerfile -t dbs-sauvegarde infra
# Les outils PostgreSQL de la version en service (16), age (chiffrement), rclone (copie hors site), curl et
# openssl (surveillance), et le planificateur (planifier.sh).
FROM postgres:16-alpine
RUN apk add --no-cache age rclone curl openssl tzdata
COPY sauvegardes/sauvegarder.sh sauvegardes/restaurer.sh sauvegardes/tester-restauration.sh sauvegardes/planifier.sh /outils/sauvegardes/
COPY surveillance/controler.sh /outils/surveillance/
RUN chmod 0755 /outils/sauvegardes/*.sh /outils/surveillance/*.sh
ENV SAUVEGARDE_DOSSIER=/sauvegardes
HEALTHCHECK --interval=60s --timeout=5s CMD pgrep -f planifier.sh >/dev/null || exit 1
# L'image PostgreSQL démarre un serveur par défaut : ici, seulement le planificateur
ENTRYPOINT []
CMD ["bash", "/outils/sauvegardes/planifier.sh"]

# Image de la sauvegarde planifiée (tâche 11, ADR 0016) : les outils de PostgreSQL 16 (pg_dump de la même version
# que le serveur), age pour chiffrer par clé publique, rclone pour la copie hors site. Tourne sans droits root.
FROM postgres:16-alpine
RUN apk add --no-cache age rclone tzdata coreutils findutils \
  && mkdir -p /sauvegardes && chown postgres:postgres /sauvegardes
COPY --chmod=0755 infra/sauvegardes/sauvegarder.sh infra/sauvegardes/planifier.sh infra/sauvegardes/inscrire-test-restauration.sh /usr/local/bin/
USER postgres
VOLUME /sauvegardes
ENTRYPOINT ["/usr/local/bin/planifier.sh"]

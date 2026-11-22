#!/usr/bin/env bash
# Test de restauration, chaque mois (tâche 11, docs/securite/sauvegardes-et-reprise.md) : une sauvegarde qui n'a
# jamais été restaurée n'est pas une sauvegarde.
#
#   restaurer-et-verifier.sh dbs-20261122T020000Z.dump.age
#
#   1. vérifie l'empreinte du fichier (fichier .empreinte posé à côté par sauvegarder.sh) ;
#   2. recrée une base isolée sur un serveur PostgreSQL DE TEST, avec les rôles de l'application ;
#   3. déchiffre (clé privée age, qui n'est jamais sur le serveur de production) et restaure, au fil de l'eau ;
#   4. vérifie la chaîne du journal d'audit, et que la dernière empreinte connue au moment de la sauvegarde s'y
#      trouve ; relève quelques totaux à comparer avec la production ;
#   5. écrit le résultat à côté de la sauvegarde (FICHIER.resultat), à inscrire dans la production depuis le
#      serveur avec inscrire-test-restauration.sh (ou tout de suite si JOURNAL_URL est donnée) ; supprime la base
#      de test.
#
# Variables :
#   PGHOST, PGPORT, PGUSER, PGPASSWORD  un serveur de TEST, avec un superutilisateur ; jamais la production
#   SAUVEGARDE_CLE_PRIVEE_FICHIER       fichier de la clé privée age (sur le poste qui fait le test seulement)
#   EFFECTUE_PAR                        nom de la personne qui fait le test
#   RESTAURATION_BASE                   nom de la base de test (défaut : dbs_restauration)
#   JOURNAL_URL                         facultatif : connexion à la production avec le compte dbs_sauvegarde,
#                                       pour y inscrire le résultat (postgresql://dbs_sauvegarde@…/dbs)
#   GARDER_BASE                         « oui » pour garder la base restaurée et l'examiner
#
# Code de sortie : 0 si la restauration est réussie et la chaîne d'audit intacte, 1 sinon.
set -euo pipefail
umask 077

FICHIER="${1:?Usage : restaurer-et-verifier.sh FICHIER.dump.age}"
: "${SAUVEGARDE_CLE_PRIVEE_FICHIER:?Fichier de la clé privée age (SAUVEGARDE_CLE_PRIVEE_FICHIER) manquant}"
: "${EFFECTUE_PAR:?Nom de la personne qui fait le test (EFFECTUE_PAR) manquant}"
BASE="${RESTAURATION_BASE:-dbs_restauration}"
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
nom="$(basename "$FICHIER")"

if [[ ! "$BASE" =~ ^[a-z_][a-z0-9_]{0,62}$ || "$BASE" == "dbs" ]]; then
  echo "RESTAURATION_BASE doit être le nom d'une base de test, jamais « dbs »" >&2
  exit 1
fi
if [[ ! "$nom" =~ ^[A-Za-z0-9._-]{1,200}$ ]]; then
  echo "Nom de fichier inattendu : $nom" >&2
  exit 1
fi
debut="$(date +%s)"
remarques=()

# 1. Empreinte du fichier
empreinte_audit_attendue=""
if [[ -f "$FICHIER.empreinte" ]]; then
  attendue="$(sed -n 's/^sha256=//p' "$FICHIER.empreinte")"
  empreinte_audit_attendue="$(sed -n 's/^derniere_empreinte_audit=//p' "$FICHIER.empreinte")"
  if [[ "$(sha256sum "$FICHIER" | cut -d' ' -f1)" != "$attendue" ]]; then
    echo "Le fichier ne correspond pas à son empreinte : copie abîmée ou modifiée" >&2
    exit 1
  fi
else
  remarques+=("fichier d'empreinte absent : intégrité du fichier non vérifiée")
fi

# 2. Base isolée, avec les rôles de l'application (sans mot de passe : personne ne s'y connecte)
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE)"
"${PSQL[@]}" -d postgres -v base="$BASE" -f "$RACINE/database/initialisation/01_roles_et_base.sql" >/dev/null

# 3. Déchiffrement et restauration, au fil de l'eau
reussi=true
if ! age --decrypt --identity "$SAUVEGARDE_CLE_PRIVEE_FICHIER" "$FICHIER" | pg_restore --exit-on-error --dbname="$BASE"; then
  reussi=false
  remarques+=("la restauration a échoué")
fi

# 4. Vérifications sur la base restaurée
lignes_audit=""
chaine_intacte=false
totaux="{}"
if [[ "$reussi" == true ]]; then
  IFS=';' read -r lignes_audit anomalie _ <<<"$("${PSQL[@]}" -F ';' -d "$BASE" -c "SELECT lignes_verifiees, coalesce(premiere_anomalie::text, ''), derniere_empreinte FROM audit.verifier_chaine()")"
  if [[ -z "$anomalie" ]]; then
    chaine_intacte=true
  else
    remarques+=("anomalie dans le journal d'audit à la ligne $anomalie")
  fi
  if [[ -n "$empreinte_audit_attendue" ]]; then
    contenue="$("${PSQL[@]}" -d "$BASE" -v empreinte="$empreinte_audit_attendue" <<'SQL'
SELECT EXISTS (SELECT 1 FROM audit.journal WHERE encode(empreinte, 'hex') = :'empreinte');
SQL
)"
    if [[ "$contenue" != "t" ]]; then
      chaine_intacte=false
      remarques+=("la dernière empreinte d'audit connue au moment de la sauvegarde est absente de la base restaurée")
    fi
  fi
  totaux="$("${PSQL[@]}" -d "$BASE" -c "SELECT jsonb_build_object(
      'clients', (SELECT count(*) FROM app.clients),
      'contrats', (SELECT count(*) FROM app.contrats),
      'vehicules', (SELECT count(*) FROM app.vehicules),
      'sinistres', (SELECT count(*) FROM app.sinistres),
      'encaissements', (SELECT count(*) FROM app.encaissements),
      'montant_encaisse', (SELECT coalesce(sum(montant), 0) FROM app.encaissements),
      'dernier_encaissement', (SELECT max(encaisse_le) FROM app.encaissements),
      'journal_audit', (SELECT count(*) FROM audit.journal))")"
fi
duree=$(( $(date +%s) - debut ))
[[ "$chaine_intacte" == true ]] || reussi=false
remarque="$(IFS='; '; echo "${remarques[*]:-}")"

# 5. Résultat
echo "Restauration de $nom : $([[ "$reussi" == true ]] && echo réussie || echo ÉCHEC) en $duree s"
echo "Journal d'audit : ${lignes_audit:-?} lignes, chaîne $([[ "$chaine_intacte" == true ]] && echo intacte || echo À EXAMINER)"
echo "Totaux à comparer avec la production : $totaux"
[[ -n "$remarque" ]] && echo "Remarques : $remarque"
# Résultat écrit à côté de la sauvegarde : inscrit tout de suite dans la production si JOURNAL_URL est donnée, sinon
# plus tard, depuis le serveur, avec inscrire-test-restauration.sh
resultat="$FICHIER.resultat"
{
  echo "fichier=$nom"
  echo "reussi=$reussi"
  echo "duree=$duree"
  echo "lignes=$lignes_audit"
  echo "intacte=$chaine_intacte"
  echo "totaux=$(tr -d '\n' <<<"$totaux")"
  echo "par=$(tr -d '\n' <<<"$EFFECTUE_PAR")"
  echo "remarque=$remarque"
} > "$resultat"
if [[ -n "${JOURNAL_URL:-}" ]]; then
  JOURNAL_URL="$JOURNAL_URL" "$(dirname "$0")/inscrire-test-restauration.sh" < "$resultat"
else
  echo "Résultat dans $resultat : inscrivez-le depuis le serveur (infra/sauvegardes/README.md, test de restauration)."
fi
if [[ "${GARDER_BASE:-non}" != "oui" ]]; then
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $BASE WITH (FORCE)"
fi
[[ "$reussi" == true ]]

-- =====================================================================
-- 0016 · Lecture automatique des documents (tâche 14)
--
-- Chaque lecture automatique (carte grise, pièce d'identité, constat amiable) est consignée au journal de
-- sécurité : qui, quand, quel document. Les valeurs lues n'y figurent jamais. Elles ne sont d'ailleurs pas
-- gardées : elles ne font que pré-remplir un formulaire, qu'une personne vérifie puis enregistre.
-- Le même journal sert à limiter le nombre de lectures par personne et par heure.
-- Conception : docs/architecture/adr/0015-lecture-automatique.md
-- =====================================================================

ALTER TABLE securite.evenements DROP CONSTRAINT evenements_type;
ALTER TABLE securite.evenements ADD CONSTRAINT evenements_type CHECK (type IN (
  'connexion_reussie', 'connexion_echouee', 'mfa_echoue', 'compte_bloque', 'mfa_active',
  'mot_de_passe_modifie', 'acces_reinitialise', 'compte_cree', 'compte_modifie', 'deconnexion',
  'export_donnees', 'piece_telechargee', 'donnee_sensible_consultee', 'lecture_automatique'
));

-- Limite par personne et par heure : compte rapide des lectures récentes d'un utilisateur
CREATE INDEX evenements_lectures_idx ON securite.evenements (utilisateur_id, horodatage)
  WHERE type = 'lecture_automatique';

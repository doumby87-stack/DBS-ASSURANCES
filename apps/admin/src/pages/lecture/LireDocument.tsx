// « Lire un document » (ADR 0018) : la porte d'entrée de la lecture automatique quand on ne part d'aucune fiche.
// On dépose une photo, un PDF ou un classeur ; l'outil reconnaît de quel document il s'agit, en lit les valeurs, les
// contrôle et dit ce qu'il en sait déjà : véhicule connu et chez qui, contrat de l'agence, client existant,
// échéance à reporter (appliquée d'un clic), contrat d'une autre compagnie à reprendre à son échéance.

import { useEffect, useState } from "react";
import { Alerte, Chargement, Section } from "../../composants/communs";
import { LectureAutomatique } from "../../composants/LectureAutomatique";
import { api } from "../../services/api";

export function LireDocument() {
  const [disponible, setDisponible] = useState<boolean | null>(null);
  useEffect(() => {
    void api<{ disponible: boolean }>("/lecture-automatique").then((r) => setDisponible(r.disponible)).catch(() => setDisponible(false));
  }, []);

  return (
    <>
      <h1>Lire un document</h1>
      <p>
        Carte grise, pièce d'identité, constat amiable, attestation d'assurance, registre de commerce, carte de transport, visite technique
        ou liste de véhicules : déposez-le, l'outil le reconnaît, en lit les informations utiles et les rapproche des fiches de l'agence.
      </p>
      {disponible === null ? <Chargement /> : !disponible ? (
        <Alerte type="info">La lecture automatique n'est pas activée : saisissez les informations à la main depuis la fiche du client.</Alerte>
      ) : (
        <Section titre="Document à lire">
          <LectureAutomatique document="auto" titre="Déposer un document" />
          <p className="note">
            Pour pré-remplir un formulaire, lisez plutôt le document depuis l'écran concerné : fiche du client (véhicule, identification),
            flotte (liste des véhicules, échéances), sinistre (constat) ou demande du site (pièces jointes). Les valeurs y sont aussi comparées
            à la fiche du client.
          </p>
        </Section>
      )}
    </>
  );
}

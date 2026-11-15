// Carte de transport (autorisation de transport public de marchandises ou de personnes) : sa date de fin de
// validité alimente l'échéance suivie sur le véhicule.

import {
  chaine, controleDatePassee, controleImmatriculation, date, dateValide, definir, immatriculation, ouNul, texte, type Commun, type Controle,
} from "./outils.js";

export interface ChampsCarteTransport extends Commun {
  numero: string | null;
  titulaire: string | null;
  immatriculation: string | null;
  categorie: string | null;
  dateDelivrance: string | null;
  dateExpiration: string | null;
}

export const carteTransport = definir<ChampsCarteTransport>({
  libelle: "Carte de transport",
  signes: "carte ou autorisation de transport délivrée par l'administration des transports pour un véhicule : titulaire, immatriculation, catégorie de transport, validité",
  demande: "Ce document devrait être une carte de transport (autorisation de transport public de marchandises ou de personnes) d'un véhicule. Recopie ses champs.",
  proprietes: {
    numero: ouNul(texte), titulaire: ouNul(texte), immatriculation: ouNul(texte), categorie: ouNul(texte),
    dateDelivrance: ouNul(date), dateExpiration: ouNul(date),
  },
  descriptions: {
    titulaire: "transporteur ou propriétaire au nom duquel la carte est délivrée",
    categorie: "catégorie ou nature du transport autorisé (marchandises, personnes, mixte…)",
    dateExpiration: "date de fin de validité",
  },
  nettoyer: (brut) => ({
    numero: chaine(brut.numero, 60), titulaire: chaine(brut.titulaire, 160), immatriculation: immatriculation(brut.immatriculation),
    categorie: chaine(brut.categorie, 120), dateDelivrance: dateValide(brut.dateDelivrance), dateExpiration: dateValide(brut.dateExpiration),
  }),
  controler: (c, aujourdhui) => {
    const controles: Controle[] = [
      ...controleImmatriculation("immatriculation", c.immatriculation, "la carte de transport"),
      ...controleDatePassee("dateExpiration", c.dateExpiration, aujourdhui, "Carte de transport expirée : le véhicule ne peut plus transporter pour autrui."),
    ];
    if (c.dateDelivrance && c.dateExpiration && c.dateDelivrance >= c.dateExpiration) {
      controles.push({ champ: "dateExpiration", niveau: "attention", message: "Fin de validité avant la date de délivrance : vérifiez les deux dates." });
    }
    return controles;
  },
  exemple: {
    documentReconnu: true, lisibilite: "bonne", remarques: null, champsIncertains: [],
    numero: "CT-2026-018734", titulaire: "Transports Exemple Lagunaires", immatriculation: "7310 HJ 01",
    categorie: "Transport public de marchandises", dateDelivrance: "2026-02-01", dateExpiration: "2027-01-31",
  },
});

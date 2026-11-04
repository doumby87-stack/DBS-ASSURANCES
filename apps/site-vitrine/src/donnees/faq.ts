// Questions fréquentes, par thème. Reprises sur la page dédiée (avec leurs données structurées pour
// les moteurs de recherche) et, en partie, sur les autres pages. Réponses en texte simple.

import { AGENCE } from "./agence";

export interface Question {
  id: string;
  question: string;
  reponse: string;
}

export interface Theme {
  id: string;
  titre: string;
  questions: Question[];
}

export const FAQ: Theme[] = [
  {
    id: "souscrire",
    titre: "Souscrire et payer",
    questions: [
      {
        id: "auto-obligatoire",
        question: "L'assurance automobile est-elle obligatoire en Côte d'Ivoire ?",
        reponse:
          "Oui. Tout véhicule à moteur qui circule, avec ses remorques et semi-remorques, doit être couvert au minimum en responsabilité civile (Code CIMA, article 200). Les autres garanties (vol, incendie, bris de glace, dommages…) sont facultatives et dépendent de vos besoins.",
      },
      {
        id: "debut-couverture",
        question: "À partir de quand suis-je couvert ?",
        reponse:
          "Dès le paiement de la prime. L'article 13 du Code CIMA subordonne la prise d'effet du contrat au paiement : sans paiement, pas de garantie.",
      },
      {
        id: "paiement",
        question: "Comment puis-je payer ?",
        reponse:
          "En espèces (jusqu'à 1 000 000 F CFA par police), par chèque à l'ordre de SanlamAllianz CI, par Mobile Money ou par virement bancaire. Un reçu numéroté vous est remis pour chaque paiement.",
      },
      {
        id: "documents-devis-auto",
        question: "Quels documents fournir pour un devis auto ?",
        reponse:
          "La carte grise du véhicule et une pièce d'identité suffisent en général pour établir le devis. Nous vous indiquons ensuite les autres pièces utiles à la souscription.",
      },
      {
        id: "rappels",
        question: "Me prévenez-vous avant l'échéance de mon contrat ?",
        reponse:
          "Oui, si vous l'acceptez : nous vous envoyons un rappel sur WhatsApp ou par SMS un mois avant l'échéance, puis à quinze jours, à une semaine et le jour même, pour renouveler sans interruption de garantie. Vous pouvez arrêter ces rappels à tout moment en répondant STOP ou en nous appelant.",
      },
    ],
  },
  {
    id: "attestation",
    titre: "Attestation et sécurité",
    questions: [
      {
        id: "attestation-digitale",
        question: "Qu'est-ce que l'attestation digitale ?",
        reponse:
          "Depuis le 1er janvier 2023, les attestations d'assurance automobile sont digitales en Côte d'Ivoire. Émises sur la plateforme de l'ASACI, elles portent un QR code qui permet de vérifier leur authenticité lors d'un contrôle.",
      },
      {
        id: "arnaques",
        question: "Comment éviter les fausses attestations et les arnaques ?",
        reponse: `Scannez le QR code de votre attestation pour vérifier qu'elle est authentique. Ne réglez votre prime qu'à l'agence ou sur les moyens de paiement que nous vous indiquons depuis le ${AGENCE.telephone.affichage} ou ${AGENCE.email}, et demandez un reçu pour chaque paiement. En cas de doute sur un message reçu en notre nom, appelez-nous avant de payer.`,
      },
    ],
  },
  {
    id: "entreprises",
    titre: "Entreprises et transporteurs",
    questions: [
      {
        id: "flotte",
        question: "Pouvez-vous assurer toute la flotte de mon entreprise ?",
        reponse:
          "Oui. Envoyez-nous la liste de vos véhicules (type, immatriculation, usage, valeur) : nous préparons la cotation, éditons les attestations en lot et suivons les renouvellements.",
      },
      {
        id: "appel-offres",
        question: "Je réponds à un appel d'offres : pouvez-vous m'aider pour les assurances exigées ?",
        reponse:
          "Oui. Tous risques chantier, décennale, responsabilité civile : nous vous transmettons le questionnaire SanlamAllianz correspondant et suivons l'étude de votre dossier jusqu'à la proposition.",
      },
    ],
  },
  {
    id: "sinistre",
    titre: "En cas de sinistre",
    questions: [
      {
        id: "que-faire",
        question: "J'ai un accident ou un vol : que dois-je faire ?",
        reponse:
          "Mettez d'abord les personnes en sécurité, puis rassemblez les preuves (constat amiable, photos, témoins ; plainte en cas de vol). Prévenez-nous au plus vite, dans le délai prévu par votre contrat : nous vous aidons à constituer le dossier et le suivons avec SanlamAllianz jusqu'à son règlement.",
      },
      {
        id: "suivi",
        question: "Comment suivre l'avancement de mon dossier ?",
        reponse:
          "Nous vous informons à chaque étape : transmission à la compagnie, expertise, offre d'indemnisation, règlement. Vous pouvez aussi nous appeler ou nous écrire sur WhatsApp à tout moment.",
      },
    ],
  },
];

export function question(id: string): Question {
  for (const theme of FAQ) {
    const trouvee = theme.questions.find((q) => q.id === id);
    if (trouvee) return trouvee;
  }
  throw new Error(`Question introuvable : ${id}`);
}

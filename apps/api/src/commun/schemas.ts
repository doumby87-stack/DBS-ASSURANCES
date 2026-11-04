// Morceaux de schémas de validation partagés par les routes.

export const BRANCHES = [
  "automobile", "deux_roues", "flotte", "habitation", "multirisque_professionnelle",
  "incendie_risques_divers", "responsabilite_civile", "individuelle_accident",
  "transport_marchandises", "chantier_construction", "industrie_bris_de_machines",
  "agricole", "evenementiel", "autre",
] as const;
export type Branche = (typeof BRANCHES)[number];

export const parametreId = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

export const date = { type: "string", format: "date" } as const;
/** Montant en francs CFA : entier strictement positif, plafonné à mille milliards. */
export const montant = { type: "integer", minimum: 1, maximum: 1_000_000_000_000 } as const;
export const texteCourt = (max: number, min = 1) => ({ type: "string", minLength: min, maxLength: max }) as const;

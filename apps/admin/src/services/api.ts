// Appels à l'API, servie sous la même adresse (/api). Le cookie de session est géré par le navigateur
// (HttpOnly : ce code n'y a jamais accès) ; aucune donnée n'est conservée dans le navigateur.

export type Role = "gerant" | "charge_clientele" | "caissier" | "commercial" | "apporteur" | "auditeur";

export interface Utilisateur {
  id: string;
  email: string;
  nom: string;
  role: Role;
}

export interface Session {
  utilisateur: Utilisateur;
  motDePasseProvisoire: boolean;
  expireLe: string;
}

export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
    readonly donnees: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let surSessionPerdue: (() => void) | null = null;

/** Appelé quand l'API répond « non connecté » : la session a expiré ou a été fermée. */
export function quandSessionPerdue(rappel: () => void): void {
  surSessionPerdue = rappel;
}

export async function api<T>(chemin: string, options: { methode?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; corps?: unknown } = {}): Promise<T> {
  const reponse = await fetch(`/api${chemin}`, {
    method: options.methode ?? (options.corps === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: options.corps === undefined ? {} : { "Content-Type": "application/json" },
    body: options.corps === undefined ? null : JSON.stringify(options.corps),
  });
  if (reponse.status === 204) return undefined as T;

  const donnees = (await reponse.json().catch(() => ({}))) as Record<string, unknown>;
  if (!reponse.ok) {
    if (reponse.status === 401 && donnees.code === "non_authentifie") surSessionPerdue?.();
    throw new ErreurApi(
      reponse.status,
      typeof donnees.code === "string" ? donnees.code : "erreur",
      typeof donnees.message === "string" ? donnees.message : "Une erreur est survenue. Réessayez.",
      donnees,
    );
  }
  return donnees as T;
}

/** Message à afficher pour une erreur quelconque. */
export function messageErreur(erreur: unknown): string {
  if (erreur instanceof ErreurApi) return erreur.message;
  return "Impossible de joindre le serveur. Vérifiez la connexion Internet et réessayez.";
}

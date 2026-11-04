// Appels à l'API, sous la même adresse que le portail (/api). La session tient dans un cookie HttpOnly
// que ce code ne peut pas lire ; rien n'est gardé dans le navigateur.

export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let surSessionPerdue: (() => void) | null = null;

/** Appelé quand l'API répond que la session n'est plus valide (expirée, accès retiré). */
export function quandSessionPerdue(rappel: () => void): void {
  surSessionPerdue = rappel;
}

export async function api<T>(chemin: string, options: { methode?: "GET" | "POST" | "DELETE"; corps?: unknown } = {}): Promise<T> {
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
    );
  }
  return donnees as T;
}

export function messageErreur(erreur: unknown): string {
  if (erreur instanceof ErreurApi) return erreur.message;
  return "Connexion impossible. Vérifiez votre réseau, puis réessayez.";
}

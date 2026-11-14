// Documents joints aux demandes (composant PiecesJointes.astro) : contrôle dans le navigateur (type d'après
// l'extension, taille, nombre, poids total ; l'API vérifie ensuite le contenu réel), lecture en base64 pour
// l'envoi à l'API, et liste des fichiers pour le récapitulatif ou le message WhatsApp.

import {
  LIBELLES_NATURE, NATURES_AVEC_CLASSEUR, PIECES_MAX, TAILLE_PIECE_MAX, TAILLE_PIECES_TOTAL_MAX, TYPE_CLASSEUR, TYPES_FICHIER,
  type NaturePiece,
} from "../donnees/pieces";

export interface PieceChoisie {
  nature: NaturePiece;
  fichier: File;
}

export interface PieceEnvoyee {
  nature: NaturePiece;
  type: string;
  contenu: string;
}

export interface PiecesJointes {
  /** Ne propose que ces natures ; les fichiers des champs cachés sont oubliés */
  afficher(natures: readonly string[]): void;
  /** Contrôle tous les champs ; place le curseur sur le premier à corriger */
  valider(): boolean;
  choisies(): PieceChoisie[];
  /** « Carte grise : photo.jpg », pour le récapitulatif et le message WhatsApp */
  libelles(): string[];
  /** Contenus en base64, prêts pour l'API */
  lire(): Promise<PieceEnvoyee[]>;
}

const MO = 1024 * 1024;
const enMo = (octets: number) => `${(octets / MO).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

export function typeFichier(fichier: File, nature: NaturePiece): string | null {
  const extension = fichier.name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES_FICHIER[fichier.type] ?? TYPES_FICHIER[extension] ?? null;
  if (type === TYPE_CLASSEUR && !NATURES_AVEC_CLASSEUR.includes(nature)) return null;
  return type;
}

function lireEnBase64(fichier: File): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.addEventListener("load", () => resoudre(String(lecteur.result).split(",")[1] ?? ""));
    lecteur.addEventListener("error", () => rejeter(lecteur.error));
    lecteur.readAsDataURL(fichier);
  });
}

export function initialiserPieces(form: HTMLFormElement): PiecesJointes | null {
  const bloc = form.querySelector<HTMLElement>("[data-pieces]");
  if (!bloc) return null;
  // Dans l'ordre de la page, qui suit celui des natures proposées (afficher les range)
  const champs = () => Array.from(bloc!.querySelectorAll<HTMLInputElement>("input[type=file][data-nature]"));
  const total = bloc.querySelector<HTMLElement>("[data-pieces-total]");
  const erreurGlobale = bloc.querySelector<HTMLElement>("#erreur-pieces");

  const conteneur = (champ: HTMLInputElement) => champ.closest<HTMLElement>("[data-piece]");
  const visible = (champ: HTMLInputElement) => !(conteneur(champ)?.hidden ?? false);
  const natureDe = (champ: HTMLInputElement) => champ.dataset.nature as NaturePiece;

  function signaler(champ: HTMLInputElement, message: string): boolean {
    const erreur = document.getElementById(`erreur-piece-${natureDe(champ)}`);
    if (message) champ.setAttribute("aria-invalid", "true");
    else champ.removeAttribute("aria-invalid");
    if (erreur) erreur.textContent = message;
    return !message;
  }

  function choisies(): PieceChoisie[] {
    return champs().filter(visible).flatMap((champ) => Array.from(champ.files ?? []).map((fichier) => ({ nature: natureDe(champ), fichier })));
  }

  /** Contrôle d'un champ : type et taille de chacun de ses fichiers */
  function validerChamp(champ: HTMLInputElement): boolean {
    const nature = natureDe(champ);
    const formats = NATURES_AVEC_CLASSEUR.includes(nature) ? "une photo (JPEG ou PNG), un PDF ou un classeur Excel (.xlsx)" : "une photo (JPEG ou PNG) ou un PDF";
    for (const fichier of Array.from(champ.files ?? [])) {
      if (!typeFichier(fichier, nature)) return signaler(champ, `Choisissez ${formats}.`);
      if (fichier.size > TAILLE_PIECE_MAX) return signaler(champ, `« ${fichier.name} » dépasse ${enMo(TAILLE_PIECE_MAX)} : envoyez une photo moins lourde.`);
    }
    return signaler(champ, "");
  }

  /** Nombre et poids total, sur l'ensemble des champs proposés */
  function validerEnsemble(): boolean {
    const pieces = choisies();
    const poids = pieces.reduce((somme, p) => somme + p.fichier.size, 0);
    let message = "";
    if (pieces.length > PIECES_MAX) message = `${PIECES_MAX} documents au plus par demande : retirez-en ${pieces.length - PIECES_MAX}.`;
    else if (poids > TAILLE_PIECES_TOTAL_MAX) message = `Vos documents dépassent ${enMo(TAILLE_PIECES_TOTAL_MAX)} en tout : envoyez des photos moins lourdes, ou moins de documents.`;
    if (erreurGlobale) erreurGlobale.textContent = message;
    if (total) {
      total.textContent = pieces.length === 0 ? "" : `${pieces.length} document${pieces.length > 1 ? "s" : ""} (${enMo(poids)} sur ${enMo(TAILLE_PIECES_TOTAL_MAX)}).`;
    }
    return !message;
  }

  for (const champ of champs()) {
    champ.addEventListener("change", () => {
      validerChamp(champ);
      validerEnsemble();
    });
  }

  return {
    afficher(natures) {
      for (const champ of champs()) {
        const element = conteneur(champ);
        if (!element) continue;
        const propose = natures.includes(natureDe(champ));
        if (!propose && champ.files?.length) {
          champ.value = "";
          signaler(champ, "");
        }
        element.hidden = !propose;
      }
      // Les champs proposés prennent l'ordre des natures : la plus utile d'abord
      for (const nature of natures) {
        const element = bloc!.querySelector<HTMLElement>(`[data-piece="${nature}"]`);
        if (element && total) total.before(element);
      }
      validerEnsemble();
    },
    valider() {
      let premier: HTMLInputElement | null = null;
      for (const champ of champs().filter(visible)) {
        if (!validerChamp(champ) && !premier) premier = champ;
      }
      if (!validerEnsemble() && !premier) premier = champs().find((c) => visible(c) && c.files?.length) ?? null;
      premier?.focus();
      return !premier;
    },
    choisies,
    libelles() {
      return choisies().map((p) => `${LIBELLES_NATURE[p.nature]} : ${p.fichier.name}`);
    },
    async lire() {
      const pieces: PieceEnvoyee[] = [];
      for (const { nature, fichier } of choisies()) {
        const type = typeFichier(fichier, nature);
        if (!type) continue;
        pieces.push({ nature, type, contenu: await lireEnBase64(fichier) });
      }
      return pieces;
    },
  };
}

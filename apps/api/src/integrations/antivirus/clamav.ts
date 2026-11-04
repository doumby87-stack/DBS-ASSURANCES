// Analyse antivirus par ClamAV : le démon clamd, joint en TCP, reçoit le fichier en flux (commande INSTREAM)
// et répond « stream: OK » ou « stream: <menace> FOUND ». Aucune dépendance, aucun fichier écrit sur disque :
// le contenu est envoyé tel quel, par morceaux, et n'est connu que de clamd le temps de l'analyse.
//
// Une analyse qui n'aboutit pas (antivirus non configuré, injoignable, trop lent, erreur) ne vaut jamais
// « saine » : c'est à l'appelant de décider (refus du téléchargement, nouvel essai plus tard).
// Documentation du protocole : https://docs.clamav.net/manual/Usage/Scanning.html#clamd

import { connect } from "node:net";

export type Verdict =
  | { etat: "saine" }
  | { etat: "infectee"; signature: string }
  | { etat: "indisponible"; raison: string };

export interface Antivirus {
  /** Antivirus réellement branché (pour l'indiquer au back-office). */
  readonly configure: boolean;
  analyser(contenu: Buffer): Promise<Verdict>;
}

export interface AdresseAntivirus {
  hote: string;
  port: number;
}

const TAILLE_MORCEAU = 64 * 1024;

/** Lit « hote:port » (port 3310 par défaut), ou null si l'adresse est invalide. */
export function lireAdresseAntivirus(texte: string): AdresseAntivirus | null {
  const correspondance = /^([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$/.exec(texte.trim());
  if (!correspondance) return null;
  const port = correspondance[2] ? Number(correspondance[2]) : 3310;
  if (port < 1 || port > 65535) return null;
  return { hote: correspondance[1]!.replace(/^\[|\]$/g, ""), port };
}

/** Réponse de clamd (sans le zéro final) → verdict. */
export function lireReponse(reponse: string): Verdict {
  const texte = reponse.replace(/\0+$/, "").trim();
  if (/^stream: OK$/.test(texte)) return { etat: "saine" };
  const menace = /^stream: (.+) FOUND$/.exec(texte);
  if (menace) return { etat: "infectee", signature: menace[1]!.slice(0, 200) };
  return { etat: "indisponible", raison: `Réponse de l'antivirus : ${texte.slice(0, 120) || "vide"}` };
}

export function creerAntivirus(adresse: AdresseAntivirus | null, delaiMs = 20_000): Antivirus {
  if (!adresse) {
    return {
      configure: false,
      analyser: async () => ({ etat: "indisponible", raison: "Antivirus non configuré (ANTIVIRUS_ADRESSE)" }),
    };
  }

  return {
    configure: true,
    analyser: (contenu) =>
      new Promise<Verdict>((resoudre) => {
        let fini = false;
        const morceaux: Buffer[] = [];
        const socket = connect({ host: adresse.hote, port: adresse.port });
        const terminer = (verdict: Verdict) => {
          if (fini) return;
          fini = true;
          socket.destroy();
          resoudre(verdict);
        };
        socket.setTimeout(delaiMs, () => terminer({ etat: "indisponible", raison: "Antivirus trop lent à répondre" }));
        socket.on("error", (erreur: NodeJS.ErrnoException) =>
          terminer({ etat: "indisponible", raison: `Antivirus injoignable (${erreur.code ?? erreur.message})` }));
        socket.on("data", (donnees: Buffer) => {
          morceaux.push(donnees);
          const reponse = Buffer.concat(morceaux);
          // Les réponses aux commandes préfixées par « z » se terminent par un octet nul
          if (reponse.includes(0)) terminer(lireReponse(reponse.toString("utf8")));
        });
        socket.on("end", () => terminer(lireReponse(Buffer.concat(morceaux).toString("utf8"))));
        socket.on("connect", () => {
          socket.write("zINSTREAM\0");
          for (let debut = 0; debut < contenu.length; debut += TAILLE_MORCEAU) {
            const morceau = contenu.subarray(debut, debut + TAILLE_MORCEAU);
            const longueur = Buffer.alloc(4);
            longueur.writeUInt32BE(morceau.length);
            socket.write(longueur);
            socket.write(morceau);
          }
          // Longueur nulle : fin du fichier, clamd analyse et répond
          socket.write(Buffer.alloc(4));
        });
      }),
  };
}

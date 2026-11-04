// Démon ClamAV factice pour les tests : il parle le protocole de clamd (zPING, zINSTREAM avec ses morceaux
// préfixés par leur longueur) et déclare infecté tout fichier qui contient la chaîne de test EICAR.
// Le vrai ClamAV est testé à part (tests/antivirus/demarrer-clamd.sh).
//   node tests/antivirus/clamd-factice.mjs [port]

import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EICAR = Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");

/** @param {(fichier: Buffer) => void} [surFichier] reçoit chaque fichier reconstitué */
export function creerClamdFactice(surFichier) {
  return createServer((socket) => {
    let tampon = Buffer.alloc(0);
    let commande = null;
    const morceaux = [];
    socket.on("error", () => {});
    socket.on("data", (donnees) => {
      tampon = Buffer.concat([tampon, donnees]);
      if (commande === null) {
        const fin = tampon.indexOf(0);
        if (fin < 0) return;
        commande = tampon.subarray(0, fin).toString("latin1");
        tampon = tampon.subarray(fin + 1);
        if (commande === "zPING") return void socket.end("PONG\0");
        if (commande !== "zINSTREAM") return void socket.end("UNKNOWN COMMAND\0");
      }
      while (tampon.length >= 4) {
        const longueur = tampon.readUInt32BE(0);
        if (longueur === 0) {
          const fichier = Buffer.concat(morceaux);
          surFichier?.(fichier);
          return void socket.end(fichier.includes(EICAR) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
        }
        if (tampon.length < 4 + longueur) return;
        morceaux.push(tampon.subarray(4, 4 + longueur));
        tampon = tampon.subarray(4 + longueur);
      }
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 3310);
  creerClamdFactice().listen(port, "127.0.0.1", () => console.log(`clamd factice sur 127.0.0.1:${port}`));
}

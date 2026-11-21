// Fabrique les documents d'exemple de la lecture automatique (tâche 14) : une carte grise et un passeport, FICTIFS
// (le passeport reprend le spécimen de la norme ICAO 9303, pays imaginaire « Utopia »). Ils servent aux tests du
// lecteur local et à la démonstration. Chaque document existe en version nette (scan) et en version « photo »
// (légèrement penchée, floue, sur un fond), comme celles que le personnel prendra au téléphone.
//
//   node apps/api/tests/donnees/lecture/generer.mjs      (CHROMIUM=/chemin/vers/chromium pour un autre navigateur)

import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dossier = dirname(fileURLToPath(import.meta.url));

const style = `
  body { margin: 0; background: #fff; font-family: "DejaVu Sans", sans-serif; }
  .doc { width: 860px; padding: 28px 34px; background: #f4f1e8; border: 2px solid #6b6b6b; border-radius: 14px; color: #111; }
  .titre { font-size: 26px; font-weight: bold; letter-spacing: 1px; margin: 0 0 6px; }
  .specimen { font-size: 15px; font-weight: bold; color: #a40000; margin: 0 0 18px; }
  table { border-collapse: collapse; width: 100%; font-size: 21px; }
  td { padding: 7px 6px; vertical-align: top; }
  td.l { width: 46%; color: #333; }
  td.v { font-weight: bold; }
  .mrz { margin-top: 22px; font-family: "DejaVu Sans Mono", monospace; font-size: 27px; letter-spacing: 3px; line-height: 1.5; background: #fff; padding: 8px 10px; }
  .photo { padding: 70px; background: linear-gradient(135deg, #5b4b3a, #2f2a25); display: inline-block; }
  .photo .doc { transform: rotate(-1.6deg); filter: blur(0.7px) brightness(0.95) contrast(0.92); box-shadow: 0 10px 30px rgba(0,0,0,.5); }
`;

const carteGrise = `
  <div class="doc">
    <p class="titre">CERTIFICAT D'IMMATRICULATION</p>
    <p class="specimen">SPÉCIMEN — DOCUMENT FICTIF POUR LES TESTS DE DBS-ASSURANCES</p>
    <table>
      <tr><td class="l">N° d'immatriculation</td><td class="v">4521 KM 01</td></tr>
      <tr><td class="l">Date de 1re mise en circulation</td><td class="v">14/03/2019</td></tr>
      <tr><td class="l">Nom ou raison sociale</td><td class="v">KONE MARIAM</td></tr>
      <tr><td class="l">Marque</td><td class="v">TOYOTA</td></tr>
      <tr><td class="l">Type</td><td class="v">COROLLA</td></tr>
      <tr><td class="l">Genre</td><td class="v">VP</td></tr>
      <tr><td class="l">Carrosserie</td><td class="v">BERLINE</td></tr>
      <tr><td class="l">Énergie</td><td class="v">ESSENCE</td></tr>
      <tr><td class="l">Puissance fiscale</td><td class="v">8 CV</td></tr>
      <tr><td class="l">Places assises</td><td class="v">5</td></tr>
      <tr><td class="l">N° de série (châssis)</td><td class="v">JTDBR32E720123456</td></tr>
      <tr><td class="l">Usage</td><td class="v">PROMENADE ET AFFAIRES</td></tr>
    </table>
  </div>`;

const passeport = `
  <div class="doc">
    <p class="titre">PASSEPORT — UTOPIA</p>
    <p class="specimen">SPÉCIMEN ICAO 9303 — DOCUMENT FICTIF POUR LES TESTS DE DBS-ASSURANCES</p>
    <table>
      <tr><td class="l">Type / Code du pays</td><td class="v">P / UTO</td></tr>
      <tr><td class="l">N° du passeport</td><td class="v">L898902C3</td></tr>
      <tr><td class="l">Nom</td><td class="v">ERIKSSON</td></tr>
      <tr><td class="l">Prénoms</td><td class="v">ANNA MARIA</td></tr>
      <tr><td class="l">Nationalité</td><td class="v">UTOPIENNE</td></tr>
      <tr><td class="l">Date de naissance</td><td class="v">12/08/1974</td></tr>
      <tr><td class="l">Sexe</td><td class="v">F</td></tr>
      <tr><td class="l">Lieu de naissance</td><td class="v">ZENITH</td></tr>
      <tr><td class="l">Date de délivrance</td><td class="v">16/04/2024</td></tr>
      <tr><td class="l">Date d'expiration</td><td class="v">15/04/2034</td></tr>
    </table>
    <div class="mrz">P&lt;UTOERIKSSON&lt;&lt;ANNA&lt;MARIA&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;<br>L898902C36UTO7408122F3404159ZE184226B&lt;&lt;&lt;&lt;&lt;16</div>
  </div>`;

const navigateur = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await navigateur.newPage({ deviceScaleFactor: 1 });
for (const [nom, contenu] of [["carte-grise", carteGrise], ["passeport", passeport]]) {
  for (const photo of [false, true]) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${style}</style><div id="cadre" class="${photo ? "photo" : ""}">${contenu}</div>`);
    const cadre = page.locator(photo ? "#cadre" : ".doc");
    await cadre.screenshot({ path: join(dossier, `${nom}${photo ? "-photo" : ""}.${photo ? "jpg" : "png"}`), ...(photo ? { type: "jpeg", quality: 80 } : {}) });
  }
}
await navigateur.close();
console.log("Documents d'exemple fabriqués dans", dossier);

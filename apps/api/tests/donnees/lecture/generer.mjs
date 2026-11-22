// Fabrique les documents d'exemple de la lecture automatique (tâche 14). Tous sont FICTIFS, marqués « spécimen »,
// sans emblème officiel : ils servent aux tests du lecteur local et à la démonstration.
//
//   · carte-grise(-photo) : présentation simple, libellé et valeur sur la même ligne ;
//   · carte-grise-2023-recto/verso : présentation des cartes grises récentes (colonne grise écrite en blanc,
//     libellés au-dessus des valeurs sur plusieurs colonnes, fond en dégradé, châssis au verso), photographiée et
//     réduite comme une photo envoyée par WhatsApp (720 × 1280, JPEG compressé) ;
//   · passeport(-photo) : spécimen de la norme ICAO 9303, pays imaginaire « Utopia » ;
//   · cni-recto/verso : carte d'identité avec zone lisible par machine au format TD1 (pays CIV), chiffres de contrôle
//     calculés ici, photographiée comme ci-dessus.
//
//   node apps/api/tests/donnees/lecture/generer.mjs      (CHROMIUM=/chemin/vers/chromium pour un autre navigateur)

import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dossier = dirname(fileURLToPath(import.meta.url));

/** Chiffre de contrôle ICAO 9303 : poids 7, 3, 1 ; A = 10 ; < = 0 */
function chiffre(texte) {
  let somme = 0;
  [...texte].forEach((c, i) => {
    const v = c === "<" ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55;
    somme += v * [7, 3, 1][i % 3];
  });
  return String(somme % 10);
}
const zoneTd1 = ({ numero, naissance, sexe, expiration, pays, nom, prenoms }) => {
  const l1 = `ID${pays}${numero}${chiffre(numero)}`.padEnd(30, "<");
  const debut2 = `${naissance}${chiffre(naissance)}${sexe}${expiration}${chiffre(expiration)}${pays}`.padEnd(29, "<");
  const l2 = debut2 + chiffre(l1.slice(5, 30) + debut2.slice(0, 7) + debut2.slice(8, 15) + debut2.slice(18, 29));
  const l3 = `${nom}<<${prenoms.replace(/ /g, "<")}`.padEnd(30, "<");
  return [l1, l2, l3];
};
const echapper = (t) => t.replace(/</g, "&lt;");

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

  /* Cartes au format bancaire, photographiées sur une table, comme les photos reçues par WhatsApp */
  .table { width: 720px; height: 1280px; background: linear-gradient(160deg, #4f6b66, #33463f); display: flex; align-items: center; justify-content: center; }
  .carte { width: 660px; height: 400px; border-radius: 14px; position: relative; overflow: hidden; transform: rotate(-0.4deg);
           box-shadow: 0 8px 24px rgba(0,0,0,.45); filter: blur(0.35px); color: #111; font-family: "Liberation Sans", "DejaVu Sans", sans-serif; }
  .recto { background: linear-gradient(115deg, #f0a35e 0%, #f4efe6 35%, #f4efe6 55%, #4cae62 100%); }
  .colonne { position: absolute; left: 22px; top: 0; bottom: 18px; width: 172px; background: #8c9098; color: #fff; padding: 14px 10px; }
  .colonne .l { font-size: 10px; margin-top: 16px; }
  .colonne .v { font-size: 16px; font-weight: bold; margin-top: 4px; }
  .droite { position: absolute; left: 210px; right: 14px; top: 12px; }
  .entete { text-align: center; font-weight: bold; font-size: 15px; }
  .entete small { display: block; font-size: 9px; color: #a40000; }
  .rang { display: flex; gap: 10px; margin-top: 5px; }
  .rang > div { flex: 1; }
  .l { font-size: 10px; color: #222; }
  .v { font-size: 15px; font-weight: bold; }
  .verso { background: #f7f7f5; padding: 20px 26px; box-sizing: border-box; }
  .verso .codebarre { height: 40px; width: 420px; background: repeating-linear-gradient(90deg, #333 0 2px, #fff 2px 7px, #333 7px 9px, #fff 9px 13px); margin-bottom: 22px; }
  .deux { display: flex; gap: 30px; }
  .deux > div { flex: 1; }
  .cni { background: linear-gradient(120deg, #f6e7cf, #f2f2ee 60%, #d8ecd9); padding: 18px 24px; box-sizing: border-box; }
  .cni .mrz { font-size: 17px; letter-spacing: 2px; margin-top: 14px; padding: 4px 8px; }
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

const rang = (...cases) => `<div class="rang">${cases.map(([l, v]) => `<div><div class="l">${l}</div><div class="v">${v}</div></div>`).join("")}</div>`;

const carteGrise2023Recto = `
  <div class="table"><div class="carte recto">
    <div class="colonne">
      <div class="l">Numéro d'immatriculation</div><div class="v">CD-123-EF-01</div>
      <div class="l">Numéro de carte grise</div><div class="v">CG12345678</div>
      <div class="l">Date de 1ère mise en circulation</div><div class="v">14-03-2019</div>
      <div class="l">Date d'édition</div><div class="v">02-09-2025</div>
    </div>
    <div class="droite">
      <div class="entete">CARTE GRISE</div>
      <div class="l">Identité du propriétaire</div>
      <div class="v">TRANSPORTS KOUASSI</div>
      ${rang(["Marque", "MERCEDES"], ["Genre", "Tracteur Routier"])}
      ${rang(["Type commercial", "ACTROS 1845"], ["", ""])}
      ${rang(["Couleur", "BLANC"], ["", ""])}
      ${rang(["Carrosserie", "Pour Semi-Remorque"], ["", ""])}
      ${rang(["Energie", "Gas-Oil"], ["Usage du véhicule", "Privé"], ["Nombre d'essieux", "2"])}
      ${rang(["Places assises", "2"], ["Puissance fiscale (CV)", "26"], ["Cylindrée (CC)", "12809"])}
      <p class="l" style="margin-top:34px; color:#a40000; font-weight:bold">SPÉCIMEN FICTIF — TESTS DBS-ASSURANCES</p>
    </div>
  </div></div>`;

const carteGrise2023Verso = `
  <div class="table"><div class="carte verso">
    <div class="codebarre"></div>
    <div class="deux">
      <div><div class="l">Numéro du VIN/Chassis</div><div class="v">WDB9634031L123456</div><div class="l" style="margin-top:12px">Société de crédit</div></div>
      <div><div class="l">Numéro de moteur</div><div class="v">47192873125</div><div class="l" style="margin-top:12px">Type technique</div><div class="v">MP4</div>
        <div class="l" style="margin-top:12px">Numéro d'immatriculation précédent</div><div class="v">7712 GH 01</div></div>
    </div>
    <p class="l" style="margin-top:26px">SPÉCIMEN FICTIF — Cette carte n'est valable que pour les tests de DBS-ASSURANCES.</p>
  </div></div>`;

const identite = { numero: "CI4567890", naissance: "900203", sexe: "F", expiration: "300202", pays: "CIV", nom: "KOUASSI", prenoms: "AWA" };
const cniRecto = `
  <div class="table"><div class="carte cni">
    <div class="entete">CARTE NATIONALE D'IDENTITÉ<small>SPÉCIMEN FICTIF — TESTS DBS-ASSURANCES</small></div>
    ${rang(["Nom", "KOUASSI"], ["N° de la carte", identite.numero])}
    ${rang(["Prénoms", "AWA"], ["", ""])}
    ${rang(["Date de naissance", "03/02/1990"], ["Sexe", "F"])}
    ${rang(["Lieu de naissance", "BOUAKE"], ["Taille", "1,68 m"])}
    ${rang(["Date d'expiration", "02/02/2030"], ["", ""])}
  </div></div>`;
const cniVerso = `
  <div class="table"><div class="carte cni">
    ${rang(["NNI", "12345678901"], ["Profession", "COMMERÇANTE"])}
    ${rang(["Date de délivrance", "03/02/2020"], ["Domicile", "YOPOUGON"])}
    <div class="mrz">${zoneTd1(identite).map(echapper).join("<br>")}</div>
  </div></div>`;

const navigateur = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await navigateur.newPage({ deviceScaleFactor: 1, viewport: { width: 720, height: 1280 } });
const rendre = async (contenu, selecteur, fichier, options = {}) => {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${style}</style>${contenu}`);
  await page.locator(selecteur).screenshot({ path: join(dossier, fichier), ...options });
};
for (const [nom, contenu] of [["carte-grise", carteGrise], ["passeport", passeport]]) {
  await rendre(contenu, ".doc", `${nom}.png`);
  await rendre(`<div id="cadre" class="photo">${contenu}</div>`, "#cadre", `${nom}-photo.jpg`, { type: "jpeg", quality: 80 });
}
for (const [nom, contenu] of [
  ["carte-grise-2023-recto", carteGrise2023Recto], ["carte-grise-2023-verso", carteGrise2023Verso], ["cni-recto", cniRecto], ["cni-verso", cniVerso],
]) {
  // JPEG compressé comme une photo transmise par WhatsApp
  await rendre(contenu, ".table", `${nom}.jpg`, { type: "jpeg", quality: 62 });
}
await navigateur.close();
console.log("Documents d'exemple fabriqués dans", dossier);

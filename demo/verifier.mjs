// Vérifie une démonstration démarrée (demo/compose.yml) : chaque espace répond, un compte du personnel se connecte
// avec le code affiché sur la page d'accueil, et une cliente reçoit son code puis entre dans son espace.
// Lancé par l'intégration continue ; utilisable à la main : node demo/verifier.mjs

const ACCUEIL = "http://localhost:8080";
const GESTION = "http://localhost:4173";
const ESPACE_CLIENT = "http://localhost:4174";
const SITE = "http://localhost:4321";
const MOT_DE_PASSE = "Demo DBS Assurances 2026";

let echecs = 0;
function verifier(condition, message) {
  console.log(`${condition ? "✓" : "✗"} ${message}`);
  if (!condition) echecs += 1;
}
const etat = async () => (await fetch(`${ACCUEIL}/etat.json`)).json();
const cookie = (reponse) => reponse.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const poster = (base, chemin, corps, enTetes = {}) =>
  fetch(`${base}/api${chemin}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, ...enTetes },
    body: JSON.stringify(corps),
  });

for (const [nom, adresse] of [["page d'accueil", ACCUEIL], ["site", `${SITE}/rendez-vous/`], ["gestion", GESTION], ["espace client", ESPACE_CLIENT]]) {
  const reponse = await fetch(adresse);
  verifier(reponse.ok, `${nom} : ${adresse} répond`);
}

// Personnel : mot de passe, puis code à 6 chiffres de la page d'accueil
const { personnel, clients } = await etat();
verifier(personnel.length === 5 && personnel.every((p) => /^\d{6}$/.test(p.code)), "cinq comptes du personnel, avec leur code du moment");
const gerante = personnel.find((p) => p.role === "gerant");
const connexion = await poster(GESTION, "/auth/connexion", { email: gerante.email, motDePasse: MOT_DE_PASSE });
verifier(connexion.ok && (await connexion.json()).etape === "mfa", "la gérante passe l'étape du mot de passe");
const mfa = await poster(GESTION, "/auth/mfa", { code: gerante.code }, { Cookie: cookie(connexion) });
verifier(mfa.ok, "puis celle du code à 6 chiffres affiché sur la page d'accueil");
const clientsGestion = await fetch(`${GESTION}/api/clients`, { headers: { Cookie: cookie(mfa) } });
verifier(clientsGestion.ok && JSON.stringify(await clientsGestion.json()).includes("Transports Kouassi"), "elle voit les clients d'exemple");
const lecture = await fetch(`${GESTION}/api/lecture-automatique`, { headers: { Cookie: cookie(mfa) } });
verifier(lecture.ok && (await lecture.json()).prestataire === "simulation", "la lecture automatique des documents est proposée, simulée");

// Espace client : le code qui partirait sur WhatsApp apparaît sur la page d'accueil
const mariam = clients.find((c) => c.nom === "Koné Mariam");
const demande = await poster(ESPACE_CLIENT, "/portail/connexion/code", { telephone: mariam.telephone });
verifier(demande.ok, "Koné Mariam demande un code");
const code = (await etat()).clients.find((c) => c.nom === "Koné Mariam").code;
verifier(/^\d{6}$/.test(code ?? ""), "son code apparaît sur la page d'accueil");
const entree = await poster(ESPACE_CLIENT, "/portail/connexion", { telephone: mariam.telephone, code });
verifier(entree.ok, "elle entre dans son espace avec ce code");

if (echecs > 0) {
  console.error(`\n${echecs} vérification(s) en échec.`);
  process.exit(1);
}
console.log("\nDémonstration en état de marche.");

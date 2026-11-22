// Page d'accueil de la démonstration : comptes et codes de connexion, rafraîchis toutes les 2 secondes.

const personnel = document.querySelector("[data-personnel]");
const clients = document.querySelector("[data-clients]");
const reste = document.querySelector("[data-reste]");

function ligne(cellules) {
  const tr = document.createElement("tr");
  for (const [texte, classe] of cellules) {
    const td = document.createElement("td");
    td.textContent = texte;
    if (classe) td.className = classe;
    tr.append(td);
  }
  return tr;
}

const heure = (iso) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Cellule du code : le code, ou pourquoi il n'y en a pas pour l'instant */
function codeAffiche(p, reste) {
  if (p.bloqueJusqua) return [`compte bloqué jusqu'à ${heure(p.bloqueJusqua)} : cliquez sur « Débloquer les comptes »`, "alerte"];
  if (!p.code) return [`code déjà utilisé : le suivant arrive dans ${reste} s`, "note"];
  return [p.code, "code"];
}

const lisible = (telephone) => telephone.replace(/^\+225(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4 $5");

async function rafraichir() {
  try {
    const reponse = await fetch("/etat.json", { cache: "no-store" });
    const etat = await reponse.json();
    reste.textContent = String(etat.resteSecondes);
    personnel.replaceChildren(...etat.personnel.map((p) => ligne([[p.libelle], [p.nom], [p.email, "a-copier"], codeAffiche(p, etat.resteSecondes)])));
    clients.replaceChildren(...etat.clients.map((c) => ligne([
      [`${c.nom} — ${c.qualite}`], [lisible(c.telephone), "a-copier"], [c.code ?? "aucun pour l'instant", c.code ? "code" : "note"],
    ])));
  } catch {
    reste.textContent = "…";
  }
}

const boutonDeblocage = document.querySelector("[data-debloquer]");
const messageDeblocage = document.querySelector("[data-message-deblocage]");
boutonDeblocage.addEventListener("click", async () => {
  boutonDeblocage.disabled = true;
  messageDeblocage.textContent = "";
  try {
    const reponse = await fetch("/debloquer", { method: "POST" });
    messageDeblocage.textContent = reponse.ok
      ? "C'est fait : tous les comptes sont débloqués. Reprenez la connexion depuis le début (e-mail et mot de passe)."
      : "Le déblocage a échoué. Arrêtez puis relancez la démonstration (arreter, puis demarrer).";
    await rafraichir();
  } catch {
    messageDeblocage.textContent = "La démonstration ne répond pas. Vérifiez qu'elle est démarrée.";
  } finally {
    boutonDeblocage.disabled = false;
  }
});

await rafraichir();
setInterval(rafraichir, 2000);

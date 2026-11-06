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

const lisible = (telephone) => telephone.replace(/^\+225(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4 $5");

async function rafraichir() {
  try {
    const reponse = await fetch("/etat.json", { cache: "no-store" });
    const etat = await reponse.json();
    reste.textContent = String(etat.resteSecondes);
    personnel.replaceChildren(...etat.personnel.map((p) => ligne([[p.libelle], [p.nom], [p.email, "a-copier"], [p.code, "code"]])));
    clients.replaceChildren(...etat.clients.map((c) => ligne([
      [`${c.nom} — ${c.qualite}`], [lisible(c.telephone), "a-copier"], [c.code ?? "aucun pour l'instant", c.code ? "code" : "note"],
    ])));
  } catch {
    reste.textContent = "…";
  }
}

await rafraichir();
setInterval(rafraichir, 2000);

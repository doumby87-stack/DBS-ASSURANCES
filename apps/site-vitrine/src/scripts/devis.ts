// Formulaire de devis en trois étapes (src/pages/devis.astro).
// Le message est préparé dans le navigateur puis ouvert dans WhatsApp ou la messagerie du visiteur :
// rien n'est envoyé au site lui-même. Sans JavaScript, le formulaire est remplacé par les coordonnées
// de l'agence (public/styles/sans-js.css).

interface Coordonnees {
  whatsapp: string;
  email: string;
}

type Canal = "whatsapp" | "email";

const MESSAGES = {
  assurance: "Choisissez l'assurance qui vous intéresse, ou « Autre besoin ».",
  nom: "Indiquez votre nom ou celui de votre entreprise.",
  telephone: "Indiquez un numéro à 10 chiffres, par exemple 07 49 36 07 02, ou un numéro étranger commençant par +.",
  email: "Cette adresse e-mail semble incomplète.",
  consentement: "Cochez cette case pour que nous puissions vous répondre.",
} as const;

const PROFILS: Record<string, string> = {
  particulier: "Particulier",
  professionnel: "Professionnel",
  entreprise: "Entreprise",
};

/** Numéro ivoirien à 10 chiffres (avec ou sans 225), ou numéro étranger commençant par + ou 00. */
export function telephoneValide(valeur: string): boolean {
  const brut = valeur.trim();
  let chiffres = brut.replace(/\D/g, "");
  if (/^(\+|00)/.test(brut)) {
    if (brut.startsWith("00")) chiffres = chiffres.slice(2);
    if (chiffres.startsWith("225")) return chiffres.length === 13;
    return chiffres.length >= 8 && chiffres.length <= 15;
  }
  return chiffres.length === 10 || (chiffres.length === 13 && chiffres.startsWith("225"));
}

function emailValide(valeur: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur);
}

const formulaire = document.querySelector<HTMLFormElement>("#formulaire-devis");
if (formulaire) initialiser(formulaire);

function initialiser(form: HTMLFormElement): void {
  const aides = JSON.parse(form.dataset.aides ?? "{}") as Record<string, string>;
  const coordonnees = JSON.parse(form.dataset.coordonnees ?? "{}") as Coordonnees;
  const etapes = Array.from(form.querySelectorAll<HTMLFieldSetElement>("[data-etape]"));
  const reperes = Array.from(form.querySelectorAll<HTMLLIElement>("[data-progression] li"));
  const etat = form.querySelector<HTMLElement>("[data-statut-envoi]");
  const aideBesoin = form.querySelector<HTMLElement>("[data-aide-besoin]");
  const recapitulatif = form.querySelector<HTMLElement>("[data-recapitulatif]");
  const reduireAnimations = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const saisie = (nom: string) => form.elements.namedItem(nom) as HTMLInputElement | HTMLTextAreaElement;
  const radios = (nom: string) => Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${nom}"]`));
  const choisi = (nom: string) => radios(nom).find((r) => r.checked);
  const libelle = (radio: HTMLInputElement | undefined) => radio?.closest("label")?.textContent?.trim() ?? "";

  const nom = saisie("nom") as HTMLInputElement;
  const telephone = saisie("telephone") as HTMLInputElement;
  const email = saisie("email") as HTMLInputElement;
  const commune = saisie("commune") as HTMLInputElement;
  const besoin = saisie("besoin") as HTMLTextAreaElement;
  const consentement = saisie("consentement") as HTMLInputElement;

  let courante = 0;
  let dernierCanal: Canal = "whatsapp";

  /* ---------- Erreurs ---------- */
  function signaler(champ: HTMLInputElement | HTMLTextAreaElement, idErreur: string, message: string): boolean {
    const erreur = document.getElementById(idErreur);
    if (message) champ.setAttribute("aria-invalid", "true");
    else champ.removeAttribute("aria-invalid");
    if (erreur) erreur.textContent = message;
    return !message;
  }

  function signalerAssurance(message: string): boolean {
    const erreur = document.getElementById("erreur-assurance");
    for (const radio of radios("assurance")) {
      if (message) radio.setAttribute("aria-invalid", "true");
      else radio.removeAttribute("aria-invalid");
    }
    if (erreur) erreur.textContent = message;
    return !message;
  }

  /* ---------- Aide contextuelle de l'étape 2 ---------- */
  function majAide(): void {
    if (!aideBesoin) return;
    const id = choisi("assurance")?.value ?? "autre";
    aideBesoin.textContent = `À préciser : ${aides[id] ?? aides.autre ?? ""}`;
  }

  /* ---------- Récapitulatif de l'étape 3 ---------- */
  function majRecapitulatif(): void {
    if (!recapitulatif) return;
    const lignes: [string, string][] = [
      ["Assurance", libelle(choisi("assurance"))],
      ["Profil", choisi("profil")?.value ?? ""],
    ];
    if (commune.value.trim()) lignes.push(["Commune", commune.value.trim()]);
    const liste = document.createElement("dl");
    liste.append(
      ...lignes.map(([terme, valeur]) => {
        const groupe = document.createElement("div");
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = terme;
        dd.textContent = valeur;
        groupe.append(dt, dd);
        return groupe;
      }),
    );
    const modifier = document.createElement("button");
    modifier.type = "button";
    modifier.className = "lien-bouton recapitulatif__modifier";
    modifier.textContent = "Modifier";
    modifier.addEventListener("click", () => afficher(0));
    recapitulatif.replaceChildren(liste, modifier);
    recapitulatif.hidden = false;
  }

  /* ---------- Navigation entre les étapes ---------- */
  function afficher(index: number, deplacerFocus = true): void {
    courante = index;
    etapes.forEach((etape, i) => {
      etape.hidden = i !== index;
    });
    reperes.forEach((repere, i) => {
      if (i === index) repere.setAttribute("aria-current", "step");
      else repere.removeAttribute("aria-current");
      if (i < index) repere.dataset.etat = "faite";
      else delete repere.dataset.etat;
    });
    if (index === 1) majAide();
    if (index === 2) majRecapitulatif();
    if (etat) etat.textContent = "";
    if (!deplacerFocus) return;
    const etape = etapes[index];
    etape?.focus({ preventScroll: true });
    // On ramène le haut du formulaire à l'écran, sans le faire défiler s'il y est déjà
    if (form.getBoundingClientRect().top < 0) {
      form.scrollIntoView({ behavior: reduireAnimations ? "auto" : "smooth", block: "start" });
    }
  }

  function etapeValide(index: number): boolean {
    if (index === 0) {
      const ok = signalerAssurance(choisi("assurance") ? "" : MESSAGES.assurance);
      if (!ok) radios("assurance")[0]?.focus();
      return ok;
    }
    if (index === 2) return coordonneesValides();
    return true;
  }

  function coordonneesValides(): boolean {
    const verifications: [HTMLInputElement, string, string][] = [
      [nom, "erreur-nom", nom.value.trim().length < 2 ? MESSAGES.nom : ""],
      [telephone, "erreur-telephone", telephoneValide(telephone.value) ? "" : MESSAGES.telephone],
      [email, "erreur-email", email.value.trim() && !emailValide(email.value.trim()) ? MESSAGES.email : ""],
      [consentement, "erreur-consentement", consentement.checked ? "" : MESSAGES.consentement],
    ];
    let premier: HTMLInputElement | undefined;
    for (const [champ, idErreur, message] of verifications) {
      if (!signaler(champ, idErreur, message) && !premier) premier = champ;
    }
    premier?.focus();
    return !premier;
  }

  function suivant(): void {
    if (etapeValide(courante) && courante < etapes.length - 1) afficher(courante + 1);
  }

  for (const bouton of form.querySelectorAll<HTMLButtonElement>("[data-suivant]")) {
    bouton.addEventListener("click", suivant);
  }
  for (const bouton of form.querySelectorAll<HTMLButtonElement>("[data-precedent]")) {
    bouton.addEventListener("click", () => afficher(Math.max(0, courante - 1)));
  }

  /* ---------- Effacement des erreurs pendant la saisie ---------- */
  for (const radio of radios("assurance")) {
    radio.addEventListener("change", () => {
      signalerAssurance("");
      majAide();
    });
  }
  for (const [champ, idErreur] of [
    [nom, "erreur-nom"],
    [telephone, "erreur-telephone"],
    [email, "erreur-email"],
  ] as const) {
    champ.addEventListener("input", () => {
      if (champ.getAttribute("aria-invalid") === "true") signaler(champ, idErreur, "");
    });
  }
  consentement.addEventListener("change", () => {
    if (consentement.checked) signaler(consentement, "erreur-consentement", "");
  });

  /* ---------- Message envoyé à l'agence ---------- */
  function message(): string {
    const lignes = [
      "Bonjour DBS-ASSURANCES,",
      "",
      "Je souhaite recevoir un devis.",
      `• Assurance : ${libelle(choisi("assurance"))}`,
      `• Profil : ${choisi("profil")?.value ?? "-"}`,
      `• Nom : ${nom.value.trim()}`,
      `• Téléphone : ${telephone.value.trim()}`,
    ];
    if (email.value.trim()) lignes.push(`• E-mail : ${email.value.trim()}`);
    if (commune.value.trim()) lignes.push(`• Commune / ville : ${commune.value.trim()}`);
    if (besoin.value.trim()) lignes.push("", "Mon besoin :", besoin.value.trim());
    lignes.push("", "(Demande envoyée depuis le site DBS-ASSURANCES)");
    return lignes.join("\n");
  }

  function annoncer(texte: string, lien?: { href: string; libelle: string; nouvelOnglet?: boolean }): void {
    if (!etat) return;
    etat.classList.remove("etat-envoi--erreur");
    etat.replaceChildren(texte);
    if (lien) {
      const a = document.createElement("a");
      a.href = lien.href;
      a.textContent = lien.libelle;
      if (lien.nouvelOnglet) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      etat.append(" ", a);
    }
  }

  // Bouton utilisé pour envoyer, y compris sur les navigateurs qui ne connaissent pas event.submitter
  for (const bouton of form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')) {
    bouton.addEventListener("click", () => {
      dernierCanal = bouton.value === "email" ? "email" : "whatsapp";
    });
  }

  form.addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    // Touche Entrée dans un champ des premières étapes : on avance au lieu d'envoyer
    if (courante < etapes.length - 1) {
      suivant();
      return;
    }
    if (!coordonneesValides()) return;

    const soumetteur = (evenement as SubmitEvent).submitter as HTMLButtonElement | null;
    const canal: Canal = soumetteur ? (soumetteur.value === "email" ? "email" : "whatsapp") : dernierCanal;
    const texte = message();

    if (canal === "email") {
      const sujet = `Demande de devis – ${libelle(choisi("assurance"))}`;
      const adresse = `mailto:${coordonnees.email}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(texte)}`;
      window.location.href = adresse;
      annoncer("Votre messagerie s'ouvre avec la demande pré-remplie : il ne reste qu'à l'envoyer. Rien ne s'ouvre ?", {
        href: adresse,
        libelle: "Réessayer",
      });
      return;
    }

    const adresse = `https://wa.me/${coordonnees.whatsapp}?text=${encodeURIComponent(texte)}`;
    const fenetre = window.open(adresse, "_blank");
    if (fenetre) {
      try {
        fenetre.opener = null;
      } catch {
        /* sans effet */
      }
    } else {
      window.location.href = adresse;
    }
    annoncer("WhatsApp s'ouvre avec votre demande pré-remplie : il ne reste qu'à l'envoyer. Rien ne s'ouvre ?", {
      href: adresse,
      libelle: "Ouvrir WhatsApp",
      nouvelOnglet: true,
    });
  });

  /* ---------- Préremplissage depuis les pages d'offres (?assurance=…&profil=…) ---------- */
  const parametres = new URLSearchParams(window.location.search);
  const assuranceDemandee = parametres.get("assurance");
  const radioDemandee = radios("assurance").find((r) => r.value === assuranceDemandee);
  if (radioDemandee) radioDemandee.checked = true;
  const profilDemande = PROFILS[parametres.get("profil")?.toLowerCase() ?? ""];
  const radioProfil = radios("profil").find((r) => r.value === profilDemande);
  if (radioProfil) radioProfil.checked = true;

  form.noValidate = true;
  afficher(0, false);
}

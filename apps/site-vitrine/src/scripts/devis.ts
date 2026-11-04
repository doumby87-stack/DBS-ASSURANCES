// Formulaire de devis en trois étapes (src/pages/devis.astro).
// Deux façons d'envoyer :
//   · par défaut, le message est préparé dans le navigateur puis ouvert dans WhatsApp ou la messagerie du
//     visiteur : rien n'est envoyé au site lui-même ;
//   · si le site a été construit avec l'adresse de l'API (data-api, tâche 7), la demande est enregistrée
//     par l'agence, avec la carte grise éventuelle ; WhatsApp et l'e-mail restent proposés, et servent de
//     repli si l'envoi échoue.
// Sans JavaScript, le formulaire est remplacé par les coordonnées de l'agence (public/styles/sans-js.css).

interface Coordonnees {
  whatsapp: string;
  email: string;
}

type Canal = "whatsapp" | "email" | "site";

const TYPES_CARTE_GRISE: Record<string, string> = {
  "image/jpeg": "image/jpeg", "image/png": "image/png", "application/pdf": "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf",
};
const TAILLE_CARTE_GRISE_MAX = 5 * 1024 * 1024;

const MESSAGES = {
  assurance: "Choisissez l'assurance qui vous intéresse, ou « Autre besoin ».",
  nom: "Indiquez votre nom ou celui de votre entreprise.",
  telephone: "Indiquez un numéro à 10 chiffres, par exemple 07 49 36 07 02, ou un numéro étranger commençant par +.",
  email: "Cette adresse e-mail semble incomplète.",
  consentement: "Cochez cette case pour que nous puissions vous répondre.",
  carteGriseType: "Choisissez une photo (JPEG ou PNG) ou un PDF.",
  carteGriseTaille: "La carte grise dépasse 5 Mo : envoyez une photo moins lourde.",
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
  // Enregistrement par l'API (tâche 7)
  const adresseApi = form.dataset.api ?? null;
  const assurancesAvecCarteGrise = JSON.parse(form.dataset.carteGrise ?? "[]") as string[];
  const champCarteGrise = form.querySelector<HTMLElement>("[data-champ-carte-grise]");
  const confirmation = form.querySelector<HTMLElement>("[data-confirmation]");

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
  const carteGrise = form.elements.namedItem("carteGrise") as HTMLInputElement | null;
  const rappelsWhatsApp = form.elements.namedItem("rappelsWhatsApp") as HTMLInputElement | null;
  const piege = form.elements.namedItem("siteWeb") as HTMLInputElement | null;

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
    const id = choisi("assurance")?.value ?? "autre";
    if (aideBesoin) aideBesoin.textContent = `À préciser : ${aides[id] ?? aides.autre ?? ""}`;
    if (champCarteGrise) champCarteGrise.hidden = !assurancesAvecCarteGrise.includes(id);
  }

  /** Carte grise choisie, si le champ est proposé pour l'assurance choisie */
  function fichierCarteGrise(): File | null {
    if (!carteGrise || !champCarteGrise || champCarteGrise.hidden) return null;
    return carteGrise.files?.[0] ?? null;
  }

  function typeCarteGrise(fichier: File): string | null {
    const extension = fichier.name.split(".").pop()?.toLowerCase() ?? "";
    return TYPES_CARTE_GRISE[fichier.type] ?? TYPES_CARTE_GRISE[extension] ?? null;
  }

  function carteGriseValide(): boolean {
    const fichier = fichierCarteGrise();
    if (!carteGrise || !fichier) {
      if (carteGrise) signaler(carteGrise, "erreur-carte-grise", "");
      return true;
    }
    const message = !typeCarteGrise(fichier) ? MESSAGES.carteGriseType : fichier.size > TAILLE_CARTE_GRISE_MAX ? MESSAGES.carteGriseTaille : "";
    const ok = signaler(carteGrise, "erreur-carte-grise", message);
    if (!ok) carteGrise.focus();
    return ok;
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
    if (index === 1) return carteGriseValide();
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
  carteGrise?.addEventListener("change", () => {
    carteGriseValide();
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

  function lienWhatsApp(texte: string): string {
    return `https://wa.me/${coordonnees.whatsapp}?text=${encodeURIComponent(texte)}`;
  }

  function annoncer(texte: string, lien?: { href: string; libelle: string; nouvelOnglet?: boolean }, erreur = false): void {
    if (!etat) return;
    etat.classList.toggle("etat-envoi--erreur", erreur);
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
      dernierCanal = canalDe(bouton.value);
    });
  }

  function canalDe(valeur: string): Canal {
    return valeur === "email" ? "email" : valeur === "site" && adresseApi ? "site" : "whatsapp";
  }

  /* ---------- Enregistrement de la demande par l'agence (tâche 7) ---------- */
  /** Texte exact de la case cochée : il est enregistré comme preuve de l'accord */
  function texteAccord(caseACocher: HTMLInputElement): string {
    return caseACocher.closest("label")?.querySelector("[data-texte-accord]")?.textContent?.trim() ?? "";
  }

  function lireEnBase64(fichier: File): Promise<string> {
    return new Promise((resoudre, rejeter) => {
      const lecteur = new FileReader();
      lecteur.addEventListener("load", () => resoudre(String(lecteur.result).split(",")[1] ?? ""));
      lecteur.addEventListener("error", () => rejeter(lecteur.error));
      lecteur.readAsDataURL(fichier);
    });
  }

  function occupe(enCours: boolean): void {
    form.toggleAttribute("aria-busy", enCours);
    for (const bouton of form.querySelectorAll<HTMLButtonElement>("button")) bouton.disabled = enCours;
  }

  function echec(texte: string): void {
    annoncer(`${texte} Vous pouvez aussi`, { href: lienWhatsApp(message()), libelle: "envoyer votre demande sur WhatsApp.", nouvelOnglet: true }, true);
    etat?.focus();
  }

  function confirmer(numero: number | null): void {
    for (const etape of etapes) etape.hidden = true;
    form.querySelector<HTMLElement>("[data-progression]")?.setAttribute("hidden", "");
    if (etat) etat.textContent = "";
    if (!confirmation) return;
    const titre = confirmation.querySelector("[data-confirmation-titre]");
    if (titre && numero) titre.textContent = `Demande n° ${numero} enregistrée`;
    const suivi = confirmation.querySelector<HTMLAnchorElement>("[data-confirmation-whatsapp]");
    if (suivi && numero) suivi.href = lienWhatsApp(`Bonjour DBS-ASSURANCES, j'ai envoyé la demande de devis n° ${numero} depuis le site.`);
    confirmation.hidden = false;
    confirmation.focus();
    if (confirmation.getBoundingClientRect().top < 0) confirmation.scrollIntoView({ block: "start" });
  }

  async function enregistrer(): Promise<void> {
    if (!adresseApi) return;
    const corps: Record<string, unknown> = {
      assurance: choisi("assurance")?.value ?? "autre",
      profil: (choisi("profil")?.value ?? "Particulier").toLowerCase(),
      nom: nom.value.trim(),
      telephone: telephone.value.trim(),
      accordTraitement: texteAccord(consentement),
    };
    if (email.value.trim()) corps.email = email.value.trim();
    if (commune.value.trim()) corps.commune = commune.value.trim();
    if (besoin.value.trim()) corps.besoin = besoin.value.trim();
    if (rappelsWhatsApp?.checked) corps.accordWhatsApp = texteAccord(rappelsWhatsApp);
    if (piege?.value) corps.siteWeb = piege.value;

    occupe(true);
    annoncer("Envoi de votre demande…");
    try {
      const fichier = fichierCarteGrise();
      if (fichier) corps.piece = { type: typeCarteGrise(fichier), contenu: await lireEnBase64(fichier) };
      const reponse = await fetch(adresseApi, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps),
        credentials: "omit",
      });
      const donnees = (await reponse.json().catch(() => ({}))) as { numero?: number | null; message?: string };
      if (!reponse.ok) {
        echec(donnees.message ?? "Votre demande n'a pas pu être enregistrée.");
        return;
      }
      confirmer(donnees.numero ?? null);
    } catch {
      echec("Votre demande n'a pas pu être envoyée : vérifiez votre connexion et réessayez.");
    } finally {
      occupe(false);
    }
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
    const canal: Canal = soumetteur ? canalDe(soumetteur.value) : dernierCanal;
    if (canal === "site") {
      void enregistrer();
      return;
    }
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

    const adresse = lienWhatsApp(texte);
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
  if (adresseApi) dernierCanal = "site";
  afficher(0, false);
}

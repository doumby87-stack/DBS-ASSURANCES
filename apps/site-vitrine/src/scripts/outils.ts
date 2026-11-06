// Outils du site (tâche 13) : rappel d'échéance (src/pages/rappel-echeance.astro), assistant « appel d'offres »
// (src/pages/appel-offres.astro) et demande de rendez-vous (src/pages/rendez-vous.astro).
// Comme le formulaire de devis (devis.ts) :
//   · par défaut, la demande est préparée dans le navigateur puis ouverte dans WhatsApp ou la messagerie du
//     visiteur : rien n'est envoyé au site ;
//   · si le site a été construit avec l'adresse de l'API (data-api), elle est enregistrée par l'agence, et
//     WhatsApp reste proposé en repli.
// Les contrôles de dates reprennent ceux de la base, qui reste seule juge : son message s'affiche s'il diffère.

type Outil = "rappel" | "appel-offres" | "rendez-vous";
type Canal = "whatsapp" | "email" | "site";
type Champ = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface Reglages {
  whatsapp: string;
  email: string;
  telephoneAgence: string;
  fetes: string[];
  avanceRappel: number;
  horizonRendezVous: number;
  delaiDossier: number;
  garanties: { id: string; titre: string; aPreparer: string[] }[];
  dossier: string[];
}

const OBJETS: Record<Outil, string> = {
  rappel: "Rappel avant l'échéance de mon assurance",
  "appel-offres": "Assurances pour un appel d'offres",
  "rendez-vous": "Demande de rendez-vous",
};

/** Numéro ivoirien à 10 chiffres (avec ou sans 225), ou numéro étranger commençant par + ou 00 (comme devis.ts). */
function telephoneValide(valeur: string): boolean {
  const brut = valeur.trim();
  let chiffres = brut.replace(/\D/g, "");
  if (/^(\+|00)/.test(brut)) {
    if (brut.startsWith("00")) chiffres = chiffres.slice(2);
    if (chiffres.startsWith("225")) return chiffres.length === 13;
    return chiffres.length >= 8 && chiffres.length <= 15;
  }
  return chiffres.length === 10 || (chiffres.length === 13 && chiffres.startsWith("225"));
}

/* ---------- Dates, au jour près, dans le fuseau du visiteur ---------- */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const jour = (valeur: string) => {
  const [a, m, j] = valeur.split("-").map(Number);
  return new Date(a!, m! - 1, j!);
};
const ajouter = (d: Date, jours: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + jours);
const aujourdhui = () => jour(iso(new Date()));
const enLettres = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const courte = (d: Date) => d.toLocaleDateString("fr-FR");

function estOuvre(d: Date, fetes: string[]): boolean {
  const semaine = d.getDay();
  return semaine >= 1 && semaine <= 5 && !fetes.includes(iso(d).slice(5));
}
/** Jour ouvré situé n jours ouvrés avant une date */
function joursOuvresAvant(d: Date, n: number, fetes: string[]): Date {
  let resultat = d;
  let restants = n;
  while (restants > 0) {
    resultat = ajouter(resultat, -1);
    if (estOuvre(resultat, fetes)) restants -= 1;
  }
  return resultat;
}

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-outil]")) initialiser(form);

function initialiser(form: HTMLFormElement): void {
  const outil = form.dataset.outil as Outil;
  const reglages = JSON.parse(form.dataset.reglages ?? "{}") as Reglages;
  const adresseApi = form.dataset.api ?? null;
  const etat = form.querySelector<HTMLElement>("[data-statut-envoi]");
  const confirmation = form.querySelector<HTMLElement>("[data-confirmation]");
  const contenu = form.querySelector<HTMLElement>("[data-contenu]");
  let dernierCanal: Canal = adresseApi ? "site" : "whatsapp";

  const champ = <T extends Champ = HTMLInputElement>(nom: string) => form.elements.namedItem(nom) as T | null;
  const valeur = (nom: string) => {
    const element = form.elements.namedItem(nom);
    if (element instanceof RadioNodeList) return element.value;
    return (element as Champ | null)?.value.trim() ?? "";
  };
  const coches = (nom: string) => Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${nom}"]:checked`)).map((c) => c.value);
  const libelleChoisi = (nom: string) => {
    const element = form.elements.namedItem(nom);
    if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.textContent?.trim() ?? "";
    const coche = form.querySelector<HTMLInputElement>(`input[name="${nom}"]:checked`);
    return coche?.closest("label")?.textContent?.trim() ?? "";
  };

  /* ---------- Bornes des dates, connues seulement dans le navigateur ---------- */
  const bornes: Record<string, [Date, Date]> = {
    echeance: [aujourdhui(), ajouter(aujourdhui(), 395)],
    dateLimite: [aujourdhui(), ajouter(aujourdhui(), 365)],
    jour: [ajouter(aujourdhui(), 1), ajouter(aujourdhui(), reglages.horizonRendezVous)],
  };
  for (const [nom, [min, max]] of Object.entries(bornes)) {
    const date = champ(nom);
    if (date) {
      date.min = iso(min);
      date.max = iso(max);
    }
  }

  /* ---------- Erreurs ---------- */
  function signaler(nom: string, message: string): boolean {
    const element = form.elements.namedItem(nom);
    const champs = element instanceof RadioNodeList ? (Array.from(element) as HTMLInputElement[]) : element ? [element as Champ] : [];
    for (const c of champs) {
      if (message) c.setAttribute("aria-invalid", "true");
      else c.removeAttribute("aria-invalid");
    }
    const erreur = document.getElementById(`erreur-${nom}`);
    if (erreur) erreur.textContent = message;
    return !message;
  }

  function messageDate(nom: string): string {
    const brut = valeur(nom);
    const borne = bornes[nom];
    if (!brut || !borne) return "Indiquez une date.";
    const d = jour(brut);
    if (nom === "echeance" && (d < borne[0] || d > borne[1])) return "Indiquez une échéance entre aujourd'hui et les 13 prochains mois.";
    if (nom === "dateLimite" && (d < borne[0] || d > borne[1])) return "La date limite doit être à venir, dans l'année.";
    if (nom === "jour") {
      if (d < borne[0] || d > borne[1]) return "Choisissez un jour entre demain et les deux prochains mois.";
      if (!estOuvre(d, reglages.fetes)) return "L'agence reçoit du lundi au vendredi, hors jours fériés : choisissez un autre jour.";
    }
    return "";
  }

  /** Contrôle de tout le formulaire ; place le curseur sur le premier champ à corriger */
  function valide(): boolean {
    const verifications: [string, string][] = [];
    if (outil === "rappel") verifications.push(["echeance", messageDate("echeance")]);
    if (outil === "appel-offres") {
      verifications.push(
        ["maitreOuvrage", valeur("maitreOuvrage").length < 2 ? "Indiquez qui lance l'appel d'offres." : ""],
        ["objet", valeur("objet").length < 3 ? "Indiquez l'objet du marché." : ""],
        ["dateLimite", messageDate("dateLimite")],
        ["montant", valeur("montant") && !/^\d{1,13}$/.test(valeur("montant").replace(/\s/g, "")) ? "Indiquez un montant en chiffres, sans virgule." : ""],
        ["garanties", coches("garanties").length === 0 ? "Cochez au moins une assurance, ou « Je ne sais pas encore »." : ""],
      );
    }
    if (outil === "rendez-vous") {
      verifications.push(
        ["jour", messageDate("jour")],
        ["mode", valeur("mode") === "chez_le_client" && valeur("profil") === "particulier" ? "La visite sur place est réservée aux professionnels et aux entreprises." : ""],
      );
    }
    verifications.push(
      ["nom", valeur("nom").length < 2 ? "Indiquez votre nom ou celui de votre entreprise." : ""],
      ["telephone", telephoneValide(valeur("telephone")) ? "" : "Indiquez un numéro à 10 chiffres, par exemple 07 49 36 07 02, ou un numéro étranger commençant par +."],
      ["email", valeur("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur("email")) ? "Cette adresse e-mail semble incomplète." : ""],
      ["consentement", champ("consentement")?.checked ? "" : "Cochez cette case pour que nous puissions vous répondre."],
    );
    let premier: string | null = null;
    for (const [nom, message] of verifications) {
      if (!signaler(nom, message) && !premier) premier = nom;
    }
    if (premier) {
      const element = form.elements.namedItem(premier);
      (element instanceof RadioNodeList ? (element[0] as HTMLInputElement) : (element as Champ | null))?.focus();
    }
    return !premier;
  }

  // Une erreur s'efface dès que le visiteur corrige le champ
  form.addEventListener("input", (evenement) => {
    const cible = evenement.target as Champ;
    if (cible.name && cible.getAttribute("aria-invalid") === "true") signaler(cible.name, "");
  });
  form.addEventListener("change", (evenement) => {
    const cible = evenement.target as Champ;
    if (cible.name === "garanties" || cible.name === "mode" || cible.name === "profil") signaler(cible.name === "profil" ? "mode" : cible.name, "");
    if (cible.name === "dateLimite" || cible.name === "garanties") majDossier();
  });

  /* ---------- Assistant « appel d'offres » : ce qu'il faut préparer, et pour quand ---------- */
  const dossier = form.querySelector<HTMLElement>("[data-dossier]");
  function majDossier(): void {
    if (!dossier) return;
    const choisies = reglages.garanties.filter((g) => coches("garanties").includes(g.id));
    const elements: HTMLElement[] = [];
    if (valeur("dateLimite") && !messageDate("dateLimite")) {
      const limite = jour(valeur("dateLimite"));
      const conseille = joursOuvresAvant(limite, reglages.delaiDossier, reglages.fetes);
      const p = document.createElement("p");
      const fort = document.createElement("strong");
      if (conseille < aujourdhui()) {
        fort.textContent = `Délai serré : appelez-nous aujourd'hui au ${reglages.telephoneAgence}.`;
        p.append(fort, ` La date limite est le ${enLettres(limite)}.`);
      } else {
        fort.textContent = `Envoyez-nous votre dossier au plus tard le ${enLettres(conseille)}`;
        p.append(fort, `, pour un dépôt le ${enLettres(limite)} : il faut ce temps pour étudier le cahier des charges avec SanlamAllianz et établir l'attestation.`);
      }
      elements.push(p);
    }
    const aPreparer = [...reglages.dossier, ...choisies.flatMap((g) => g.aPreparer.map((x) => `${x} (${g.titre})`))];
    if (choisies.length > 0) {
      const titre = document.createElement("p");
      titre.textContent = "À préparer :";
      const liste = document.createElement("ul");
      liste.className = "liste-losanges";
      for (const x of aPreparer) {
        const li = document.createElement("li");
        li.textContent = x;
        liste.append(li);
      }
      elements.push(titre, liste);
    }
    dossier.replaceChildren(...elements);
    dossier.hidden = elements.length === 0;
  }

  /* ---------- Rappel : ajouter l'échéance à son agenda (fichier .ics, rien n'est envoyé) ---------- */
  form.querySelector<HTMLButtonElement>("[data-agenda]")?.addEventListener("click", () => {
    const message = messageDate("echeance");
    if (!signaler("echeance", message)) {
      champ("echeance")?.focus();
      return;
    }
    const echeance = jour(valeur("echeance"));
    const rappel = ajouter(echeance, -reglages.avanceRappel) < aujourdhui() ? aujourdhui() : ajouter(echeance, -reglages.avanceRappel);
    const compact = (d: Date) => iso(d).replace(/-/g, "");
    const horodatage = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const assurance = libelleChoisi("assurance").toLowerCase();
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DBS-ASSURANCES//Rappel d'echeance//FR", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
      `UID:${horodatage}-${Math.random().toString(36).slice(2)}@dbs-assurances`, `DTSTAMP:${horodatage}`,
      `DTSTART;VALUE=DATE:${compact(rappel)}`, `DTEND;VALUE=DATE:${compact(ajouter(rappel, 1))}`,
      `SUMMARY:Renouveler mon assurance ${assurance} (échéance le ${courte(echeance)})`,
      `DESCRIPTION:Demandez votre devis à DBS-ASSURANCES : ${reglages.telephoneAgence} (appel ou WhatsApp).`,
      "END:VEVENT", "END:VCALENDAR", "",
    ].join("\r\n");
    const adresse = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const lien = document.createElement("a");
    lien.href = adresse;
    lien.download = "rappel-echeance-assurance.ics";
    lien.click();
    setTimeout(() => URL.revokeObjectURL(adresse), 60_000);
    annoncer(`Rappel ajouté à votre agenda pour le ${enLettres(rappel)}.`);
  });

  /* ---------- Message pour WhatsApp ou l'e-mail ---------- */
  function message(): string {
    const lignes = ["Bonjour DBS-ASSURANCES,", ""];
    if (outil === "rappel") {
      lignes.push(
        `Pouvez-vous me rappeler avant l'échéance de mon assurance (${libelleChoisi("assurance")}), le ${courte(jour(valeur("echeance")))}, pour me proposer un devis ?`,
      );
    } else if (outil === "appel-offres") {
      lignes.push(
        "Je réponds à un appel d'offres et j'ai besoin des assurances exigées.",
        `• Marché : ${libelleChoisi("typeMarche")} — ${valeur("objet")}`,
        `• Maître d'ouvrage : ${valeur("maitreOuvrage")}`,
        `• Date limite de dépôt : ${courte(jour(valeur("dateLimite")))}`,
      );
      if (valeur("lieu")) lignes.push(`• Lieu : ${valeur("lieu")}`);
      if (valeur("montant")) lignes.push(`• Montant estimé : ${valeur("montant")} F CFA`);
      if (valeur("dureeMois")) lignes.push(`• Durée : ${valeur("dureeMois")} mois`);
      const titres = reglages.garanties.filter((g) => coches("garanties").includes(g.id)).map((g) => g.titre);
      lignes.push(`• Assurances demandées : ${titres.join(", ")}`);
    } else {
      lignes.push(
        `Je souhaite un rendez-vous pour ${libelleChoisi("motif").toLowerCase()}.`,
        `• Jour souhaité : ${enLettres(jour(valeur("jour")))}, ${libelleChoisi("creneau").toLowerCase()}`,
        `• Où : ${libelleChoisi("mode")}`,
      );
    }
    lignes.push("", `• Nom : ${valeur("nom")}`, `• Profil : ${libelleChoisi("profil")}`, `• Téléphone : ${valeur("telephone")}`);
    if (valeur("email")) lignes.push(`• E-mail : ${valeur("email")}`);
    const precision = valeur("besoin") || valeur("message");
    if (precision) lignes.push("", precision);
    lignes.push("", "(Envoyé depuis le site DBS-ASSURANCES)");
    return lignes.join("\n");
  }

  const lienWhatsApp = (texte: string) => `https://wa.me/${reglages.whatsapp}?text=${encodeURIComponent(texte)}`;

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

  /* ---------- Enregistrement par l'agence ---------- */
  function texteAccord(nom: string): string {
    return champ(nom)?.closest("label")?.querySelector("[data-texte-accord]")?.textContent?.trim() ?? "";
  }

  function corps(): Record<string, unknown> {
    const c: Record<string, unknown> = {
      profil: valeur("profil"), nom: valeur("nom"), telephone: valeur("telephone"), accordTraitement: texteAccord("consentement"),
    };
    if (valeur("email")) c.email = valeur("email");
    if (champ("rappelsWhatsApp")?.checked) c.accordWhatsApp = texteAccord("rappelsWhatsApp");
    if (valeur("siteWeb")) c.siteWeb = valeur("siteWeb");
    if (outil === "rappel") Object.assign(c, { assurance: valeur("assurance"), echeance: valeur("echeance") });
    if (outil === "appel-offres") {
      const marche: Record<string, unknown> = { typeMarche: valeur("typeMarche"), maitreOuvrage: valeur("maitreOuvrage"), objet: valeur("objet") };
      if (valeur("lieu")) marche.lieu = valeur("lieu");
      if (valeur("montant")) marche.montant = Number(valeur("montant").replace(/\s/g, ""));
      if (valeur("dureeMois")) marche.dureeMois = Number(valeur("dureeMois"));
      Object.assign(c, { dateLimite: valeur("dateLimite"), marche, garanties: coches("garanties") });
      if (valeur("besoin")) c.besoin = valeur("besoin");
    }
    if (outil === "rendez-vous") {
      Object.assign(c, { motif: valeur("motif"), mode: valeur("mode"), jour: valeur("jour"), creneau: valeur("creneau") });
      if (valeur("message")) c.message = valeur("message");
    }
    return c;
  }

  function occupe(enCours: boolean): void {
    form.toggleAttribute("aria-busy", enCours);
    for (const bouton of form.querySelectorAll<HTMLButtonElement>("button")) bouton.disabled = enCours;
  }

  function confirmer(numero: number | null, aTraiterLe: string | null): void {
    if (contenu) contenu.hidden = true;
    if (etat) etat.textContent = "";
    if (!confirmation) return;
    const titre = confirmation.querySelector("[data-confirmation-titre]");
    if (titre && numero) titre.textContent = `${titre.textContent} (n° ${numero})`;
    const precision = confirmation.querySelector("[data-confirmation-date]");
    if (precision && aTraiterLe) precision.textContent = enLettres(jour(aTraiterLe));
    const suivi = confirmation.querySelector<HTMLAnchorElement>("[data-confirmation-whatsapp]");
    if (suivi && numero) suivi.href = lienWhatsApp(`Bonjour DBS-ASSURANCES, au sujet de ma demande n° ${numero} envoyée depuis le site : `);
    confirmation.hidden = false;
    confirmation.focus();
    if (confirmation.getBoundingClientRect().top < 0) confirmation.scrollIntoView({ block: "start" });
  }

  async function enregistrer(): Promise<void> {
    if (!adresseApi) return;
    occupe(true);
    annoncer("Envoi de votre demande…");
    try {
      const reponse = await fetch(adresseApi, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps()), credentials: "omit",
      });
      const donnees = (await reponse.json().catch(() => ({}))) as { numero?: number | null; aTraiterLe?: string | null; message?: string };
      if (!reponse.ok) {
        annoncer(`${donnees.message ?? "Votre demande n'a pas pu être enregistrée."} Vous pouvez aussi`,
          { href: lienWhatsApp(message()), libelle: "l'envoyer sur WhatsApp.", nouvelOnglet: true }, true);
        etat?.focus();
        return;
      }
      confirmer(donnees.numero ?? null, donnees.aTraiterLe ?? null);
    } catch {
      annoncer("Votre demande n'a pas pu être envoyée : vérifiez votre connexion et réessayez. Vous pouvez aussi",
        { href: lienWhatsApp(message()), libelle: "l'envoyer sur WhatsApp.", nouvelOnglet: true }, true);
      etat?.focus();
    } finally {
      occupe(false);
    }
  }

  for (const bouton of form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')) {
    bouton.addEventListener("click", () => {
      dernierCanal = canalDe(bouton.value);
    });
  }
  function canalDe(valeurBouton: string): Canal {
    return valeurBouton === "email" ? "email" : valeurBouton === "site" && adresseApi ? "site" : "whatsapp";
  }

  form.addEventListener("submit", (evenement) => {
    evenement.preventDefault();
    if (!valide()) return;
    const soumetteur = (evenement as SubmitEvent).submitter as HTMLButtonElement | null;
    const canal = soumetteur ? canalDe(soumetteur.value) : dernierCanal;
    if (canal === "site") {
      void enregistrer();
      return;
    }
    if (canal === "email") {
      const adresse = `mailto:${reglages.email}?subject=${encodeURIComponent(OBJETS[outil])}&body=${encodeURIComponent(message())}`;
      window.location.href = adresse;
      annoncer("Votre messagerie s'ouvre avec la demande pré-remplie : il ne reste qu'à l'envoyer. Rien ne s'ouvre ?", { href: adresse, libelle: "Réessayer" });
      return;
    }
    const adresse = lienWhatsApp(message());
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
      href: adresse, libelle: "Ouvrir WhatsApp", nouvelOnglet: true,
    });
  });

  // Préremplissage depuis les autres pages (?motif=sinistre, ?assurance=habitation)
  const parametres = new URLSearchParams(window.location.search);
  for (const nom of ["motif", "assurance"]) {
    const demande = parametres.get(nom);
    const select = champ<HTMLSelectElement>(nom);
    if (demande && select && Array.from(select.options).some((o) => o.value === demande)) select.value = demande;
  }
  form.noValidate = true;
  majDossier();
}

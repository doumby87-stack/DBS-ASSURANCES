// Formulaire de devis en trois étapes (src/pages/devis.astro).
// Deux façons d'envoyer :
//   · par défaut, le message est préparé dans le navigateur puis ouvert dans WhatsApp ou la messagerie du
//     visiteur : rien n'est envoyé au site lui-même ;
//   · si le site a été construit avec l'adresse de l'API (data-api, tâche 7), la demande est enregistrée
//     par l'agence, avec les documents joints ; WhatsApp et l'e-mail restent proposés, et servent de
//     repli si l'envoi échoue.
// L'étape 2 pose les questions de l'assurance choisie et propose ses documents (donnees/devis-par-assurance.ts).
// Sans JavaScript, le formulaire est remplacé par les coordonnées de l'agence (public/styles/sans-js.css).

import {
  LIBELLES_NATURE, NATURES_AVEC_CLASSEUR, PIECES_MAX, PIECES_PAR_BRANCHE, QUESTIONNAIRES, TAILLE_CLASSEUR_MAX,
  TAILLE_PIECE_MAX, TAILLE_PIECES_TOTAL_MAX, TYPE_CLASSEUR, type NaturePiece, type Question,
} from "../donnees/devis-par-assurance";

interface Coordonnees {
  whatsapp: string;
  email: string;
}

type Canal = "whatsapp" | "email" | "site";

/** Type envoyé à l'API d'après le type ou l'extension du fichier (l'API vérifie ensuite son contenu) */
const TYPES_FICHIER: Record<string, string> = {
  "image/jpeg": "image/jpeg", "image/png": "image/png", "application/pdf": "application/pdf", [TYPE_CLASSEUR]: TYPE_CLASSEUR,
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf", xlsx: TYPE_CLASSEUR,
};

/** Assurances d'entreprise : le profil passe à « Entreprise » si le visiteur ne l'a pas choisi lui-même */
const ASSURANCES_ENTREPRISE = ["flotte", "transport_marchandises", "chantier_construction", "industrie_bris_de_machines"];

const MESSAGES = {
  assurance: "Choisissez l'assurance qui vous intéresse, ou « Autre besoin ».",
  nom: "Indiquez votre nom ou celui de votre entreprise.",
  telephone: "Indiquez un numéro à 10 chiffres, par exemple 07 49 36 07 02, ou un numéro étranger commençant par +.",
  email: "Cette adresse e-mail semble incomplète.",
  consentement: "Cochez cette case pour que nous puissions vous répondre.",
  obligatoire: "Répondez à cette question.",
  obligatoireCases: "Cochez au moins une réponse.",
  date: "Indiquez une date valide.",
  fichierType: "Choisissez une photo (JPEG ou PNG) ou un PDF.",
  fichierTypeListe: "Choisissez une photo (JPEG ou PNG), un PDF ou un classeur Excel (.xlsx).",
  fichierTaille: "dépasse 5 Mo : envoyez une photo moins lourde.",
  classeurTaille: "dépasse 2 Mo : enregistrez la liste en PDF, ou découpez-la.",
  tropDeFichiers: `${PIECES_MAX} documents au plus : retirez-en quelques-uns.`,
  tropLourds: `Vos documents dépassent ensemble ${TAILLE_PIECES_TOTAL_MAX / 1024 / 1024} Mo : envoyez des photos moins lourdes, ou moins de documents.`,
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

const enChiffres = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/\s/g, " ");
const enMo = (octets: number) => `${(octets / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

/** Une réponse, en texte lisible (récapitulatif, message WhatsApp) */
function reponseLisible(q: Question, reponse: string | number | string[]): string {
  if (q.type === "nombre") return `${enChiffres(Number(reponse))}${q.unite ? ` ${q.unite}` : ""}`;
  if (q.type === "date") return String(reponse).split("-").reverse().join("/");
  if (q.type === "choix") return q.options[String(reponse)] ?? String(reponse);
  if (q.type === "plusieurs") return (reponse as string[]).map((v) => q.options[v] ?? v).join(", ");
  return String(reponse);
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
  const libelleBesoin = form.querySelector<HTMLElement>("[data-libelle-besoin]");
  const recapitulatif = form.querySelector<HTMLElement>("[data-recapitulatif]");
  const reduireAnimations = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Enregistrement par l'API (tâche 7)
  const adresseApi = form.dataset.api ?? null;
  const blocPieces = form.querySelector<HTMLFieldSetElement>("[data-pieces]");
  const totalPieces = form.querySelector<HTMLElement>("[data-pieces-total]");
  const documentsUtiles = form.querySelector<HTMLElement>("[data-documents-utiles]");
  const champsPieces = Array.from(form.querySelectorAll<HTMLInputElement>("input[data-nature]"));
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
  const rappelsWhatsApp = form.elements.namedItem("rappelsWhatsApp") as HTMLInputElement | null;
  const piege = form.elements.namedItem("siteWeb") as HTMLInputElement | null;

  let courante = 0;
  let dernierCanal: Canal = "whatsapp";
  // Le visiteur a choisi son profil lui-même (ou par le lien d'une page) : on ne le change plus
  let profilChoisi = false;

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

  /* ---------- Étape 2 : questions et documents de l'assurance choisie ---------- */
  const assurance = () => choisi("assurance")?.value ?? "autre";
  const questions = (): readonly Question[] => QUESTIONNAIRES[assurance()] ?? [];
  const questionnaire = () => form.querySelector<HTMLElement>(`[data-questionnaire="${assurance()}"]`);
  const piecesProposees = (): readonly NaturePiece[] => PIECES_PAR_BRANCHE[assurance()] ?? [];
  const champsQuestion = (q: Question) =>
    Array.from(questionnaire()?.querySelectorAll<HTMLInputElement>(`[name="q-${assurance()}-${q.cle}"]`) ?? []);
  const erreurQuestion = (q: Question) => `erreur-q-${assurance()}-${q.cle}`;

  function majEtape2(): void {
    const id = assurance();
    for (const bloc of form.querySelectorAll<HTMLElement>("[data-questionnaire]")) bloc.hidden = bloc.dataset.questionnaire !== id;
    const avecQuestions = questions().length > 0;
    if (libelleBesoin) libelleBesoin.textContent = avecQuestions ? "Autres précisions" : "Votre besoin";
    if (aideBesoin) {
      aideBesoin.textContent = avecQuestions
        ? "Tout ce qui n'est pas demandé ci-dessus et qui vous paraît utile."
        : `À préciser : ${aides[id] ?? aides.autre ?? ""}`;
    }
    // Documents de cette assurance, le plus utile d'abord
    const proposees = piecesProposees();
    if (blocPieces) {
      blocPieces.hidden = proposees.length === 0;
      for (const champ of blocPieces.querySelectorAll<HTMLElement>("[data-piece]")) champ.hidden = true;
      for (const nature of proposees) {
        const champ = blocPieces.querySelector<HTMLElement>(`[data-piece="${nature}"]`);
        if (!champ) continue;
        champ.hidden = false;
        blocPieces.insertBefore(champ, totalPieces);
      }
      piecesValides(false);
    }
    // Sans enregistrement par le site : les documents s'envoient ensuite sur WhatsApp
    if (documentsUtiles) {
      documentsUtiles.hidden = proposees.length === 0;
      documentsUtiles.textContent = `Documents utiles : ${proposees.map((n) => LIBELLES_NATURE[n].toLowerCase()).join(", ")}. `
        + "Vous pourrez nous les envoyer sur WhatsApp, juste après votre message.";
    }
  }

  /** Réponses aux questions de l'assurance choisie (les réponses vides ne sont pas gardées) */
  function reponses(): Record<string, string | number | string[]> {
    const resultat: Record<string, string | number | string[]> = {};
    for (const q of questions()) {
      const champs = champsQuestion(q);
      if (q.type === "plusieurs") {
        const coches = champs.filter((c) => c.checked).map((c) => c.value);
        if (coches.length > 0) resultat[q.cle] = coches;
      } else if (q.type === "choix") {
        const coche = champs.find((c) => c.checked);
        if (coche) resultat[q.cle] = coche.value;
      } else {
        const valeur = champs[0]?.value.trim() ?? "";
        if (valeur) resultat[q.cle] = q.type === "nombre" ? Number(valeur) : valeur;
      }
    }
    return resultat;
  }

  function signalerQuestion(q: Question, message: string): boolean {
    for (const champ of champsQuestion(q)) {
      if (message) champ.setAttribute("aria-invalid", "true");
      else champ.removeAttribute("aria-invalid");
    }
    const erreur = document.getElementById(erreurQuestion(q));
    if (erreur) erreur.textContent = message;
    return !message;
  }

  function questionsValides(): boolean {
    const donnees = reponses();
    let premiere: HTMLInputElement | undefined;
    for (const q of questions()) {
      const champ = champsQuestion(q)[0];
      const valeur = donnees[q.cle];
      let message = "";
      if (q.type === "nombre" && champ && (champ.validity.badInput || (valeur !== undefined
        && (!Number.isInteger(valeur) || (valeur as number) < q.min || (valeur as number) > q.max)))) {
        message = `Indiquez un nombre entier entre ${enChiffres(q.min)} et ${enChiffres(q.max)}.`;
      } else if (q.type === "date" && champ?.validity.badInput) {
        message = MESSAGES.date;
      } else if (q.obligatoire && valeur === undefined) {
        message = q.type === "plusieurs" ? MESSAGES.obligatoireCases : MESSAGES.obligatoire;
      }
      if (!signalerQuestion(q, message) && !premiere) premiere = champ;
    }
    premiere?.focus();
    return !premiere;
  }

  /** Fichiers choisis dans les champs des documents de l'assurance choisie, dans l'ordre où ils sont proposés */
  function fichiersChoisis(): { nature: NaturePiece; fichier: File; champ: HTMLInputElement }[] {
    return piecesProposees().flatMap((nature) => {
      const champ = champsPieces.find((c) => c.dataset.nature === nature);
      return champ ? Array.from(champ.files ?? []).map((fichier) => ({ nature, fichier, champ })) : [];
    });
  }

  function typeFichier(fichier: File): string | null {
    const extension = fichier.name.split(".").pop()?.toLowerCase() ?? "";
    return TYPES_FICHIER[fichier.type] ?? TYPES_FICHIER[extension] ?? null;
  }

  /** Contrôle des documents : type et taille de chacun, nombre et poids total ; affiche le total choisi */
  function piecesValides(deplacerFocus = true): boolean {
    if (!blocPieces) return true;
    const choisis = fichiersChoisis();
    let premier: HTMLInputElement | undefined;
    for (const champ of champsPieces) {
      const nature = champ.dataset.nature as NaturePiece;
      const avecClasseur = NATURES_AVEC_CLASSEUR.includes(nature);
      let message = "";
      for (const { fichier } of choisis.filter((c) => c.champ === champ)) {
        const type = typeFichier(fichier);
        if (!type || (type === TYPE_CLASSEUR && !avecClasseur)) message = avecClasseur ? MESSAGES.fichierTypeListe : MESSAGES.fichierType;
        else if (type === TYPE_CLASSEUR && fichier.size > TAILLE_CLASSEUR_MAX) message = `« ${fichier.name} » ${MESSAGES.classeurTaille}`;
        else if (fichier.size > TAILLE_PIECE_MAX) message = `« ${fichier.name} » ${MESSAGES.fichierTaille}`;
        if (message) break;
      }
      if (!signaler(champ, `erreur-piece-${nature}`, message) && !premier) premier = champ;
    }
    const total = choisis.reduce((somme, c) => somme + c.fichier.size, 0);
    const global = choisis.length > PIECES_MAX ? MESSAGES.tropDeFichiers : total > TAILLE_PIECES_TOTAL_MAX ? MESSAGES.tropLourds : "";
    const erreurGlobale = document.getElementById("erreur-pieces");
    if (erreurGlobale) erreurGlobale.textContent = global;
    if (totalPieces) {
      totalPieces.textContent = choisis.length === 0 ? ""
        : `${choisis.length} document${choisis.length > 1 ? "s" : ""} choisi${choisis.length > 1 ? "s" : ""}, ${enMo(total)} sur ${enMo(TAILLE_PIECES_TOTAL_MAX)} au plus.`;
    }
    if (global && !premier) premier = choisis[choisis.length - 1]?.champ;
    if (deplacerFocus) premier?.focus();
    return !premier;
  }

  /* ---------- Récapitulatif de l'étape 3 ---------- */
  function majRecapitulatif(): void {
    if (!recapitulatif) return;
    const lignes: [string, string][] = [
      ["Assurance", libelle(choisi("assurance"))],
      ["Profil", choisi("profil")?.value ?? ""],
    ];
    if (commune.value.trim()) lignes.push(["Commune", commune.value.trim()]);
    const donnees = reponses();
    for (const q of questions()) {
      const valeur = donnees[q.cle];
      if (valeur !== undefined) lignes.push([q.libelle, reponseLisible(q, valeur)]);
    }
    const choisis = fichiersChoisis();
    if (choisis.length > 0) lignes.push(["Documents joints", choisis.map((c) => LIBELLES_NATURE[c.nature]).join(", ")]);
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
    if (index === 1) majEtape2();
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
    if (index === 1) {
      // Les deux contrôles s'affichent ; le focus va à la première erreur, question d'abord
      const reponsesOk = questionsValides();
      return piecesValides(reponsesOk) && reponsesOk;
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
      // Une flotte, un chantier… : c'est en général une entreprise qui demande
      const profilEntreprise = radios("profil").find((r) => r.value === "Entreprise");
      if (!profilChoisi && profilEntreprise && ASSURANCES_ENTREPRISE.includes(radio.value)) profilEntreprise.checked = true;
      majEtape2();
    });
  }
  for (const radio of radios("profil")) {
    radio.addEventListener("change", () => {
      profilChoisi = true;
    });
  }
  // Questions : l'erreur s'efface dès que le visiteur corrige
  for (const champ of form.querySelectorAll<HTMLInputElement>("[data-questionnaire] input")) {
    champ.addEventListener(champ.type === "radio" || champ.type === "checkbox" ? "change" : "input", () => {
      const cle = champ.closest<HTMLElement>("[data-question]")?.dataset.question;
      const q = questions().find((question) => question.cle === cle);
      if (q && champ.getAttribute("aria-invalid") === "true") signalerQuestion(q, "");
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
  for (const champ of champsPieces) {
    champ.addEventListener("change", () => {
      piecesValides(false);
    });
  }

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
    const donnees = reponses();
    for (const q of questions()) {
      const valeur = donnees[q.cle];
      if (valeur !== undefined) lignes.push(`• ${q.libelle} : ${reponseLisible(q, valeur)}`);
    }
    if (besoin.value.trim()) lignes.push("", questions().length > 0 ? "Autres précisions :" : "Mon besoin :", besoin.value.trim());
    const proposees = piecesProposees();
    if (proposees.length > 0) {
      lignes.push("", `Je peux vous envoyer : ${proposees.map((n) => LIBELLES_NATURE[n].toLowerCase()).join(", ")}.`);
    }
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
    const donnees = reponses();
    if (Object.keys(donnees).length > 0) corps.details = donnees;
    if (rappelsWhatsApp?.checked) corps.accordWhatsApp = texteAccord(rappelsWhatsApp);
    if (piege?.value) corps.siteWeb = piege.value;

    occupe(true);
    annoncer("Envoi de votre demande…");
    try {
      const choisis = fichiersChoisis();
      if (choisis.length > 0) {
        corps.pieces = await Promise.all(choisis.map(async ({ nature, fichier }) => ({
          nature, type: typeFichier(fichier), contenu: await lireEnBase64(fichier),
        })));
      }
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
  if (radioProfil) {
    radioProfil.checked = true;
    profilChoisi = true;
  }
  const profilEntreprise = radios("profil").find((r) => r.value === "Entreprise");
  if (!profilChoisi && radioDemandee && profilEntreprise && ASSURANCES_ENTREPRISE.includes(radioDemandee.value)) profilEntreprise.checked = true;

  form.noValidate = true;
  if (adresseApi) dernierCanal = "site";
  afficher(0, false);
}

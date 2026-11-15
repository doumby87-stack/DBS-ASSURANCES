// Lecture automatique d'un document (tâche 14 ; étendue à tout l'outil par l'ADR 0018). Un seul composant pour tous
// les écrans : carte grise, pièce d'identité, constat amiable, attestation d'assurance, RCCM, carte de transport,
// visite technique, liste de véhicules, ou « auto » quand on ne sait pas encore ce que c'est. La personne choisit une
// pièce déjà enregistrée ou un fichier, l'outil la lit et montre :
//   · les points à vérifier (pièce expirée, valeur douteuse, visite refusée…) et les valeurs lues, les douteuses
//     surlignées ;
//   · ce que la lecture apprend des fiches de l'agence (véhicule déjà connu, contrat, client, échéance à reporter),
//     avec un lien vers la fiche et, s'il y a lieu, la mise à jour proposée, qu'elle applique d'un clic ;
//   · un bouton pour pré-remplir le formulaire de l'écran.
// Rien n'est enregistré tant que la personne n'a pas vérifié et validé elle-même. Invisible si la lecture
// automatique n'est pas activée, ou si le rôle ne permet de lire aucun des documents attendus.

import { useEffect, useState } from "react";
import { Lien } from "../routeur";
import { api, messageErreur } from "../services/api";
import { montant } from "../services/format";
import { Alerte, Champ } from "./communs";

export type DocumentLisible =
  | "carte_grise" | "piece_identite" | "constat_amiable" | "attestation_assurance" | "registre_commerce" | "carte_transport"
  | "visite_technique" | "liste_vehicules";
export interface Controle { champ: string | null; niveau: "ok" | "attention"; message: string }
export interface Rapprochement {
  niveau: "info" | "attention";
  message: string;
  lien?: { type: "client" | "contrat"; id: string };
  proposition?: {
    type: "echeances_vehicule"; vehiculeId: string; clientId: string; immatriculation: string;
    valeurs: { echeanceVisiteTechnique?: string; echeanceCarteTransport?: string };
  };
}
export interface ResultatLecture {
  document: DocumentLisible;
  libelle: string;
  reconnaissance: { confiance: "haute" | "moyenne" | "faible"; description: string | null } | null;
  prestataire: "anthropic" | "simulation" | "classeur";
  champs: Record<string, unknown> & { champsIncertains?: string[] };
  controles: Controle[];
  rapprochements: Rapprochement[];
  avertissement: string;
}
export interface PieceLisible {
  id: string;
  libelle: string;
  source: "justificatifId" | "pieceSinistreId" | "demandeSiteId" | "pieceDemandeSiteId";
  /** Document attendu pour cette pièce (par défaut, celui du composant) */
  document?: DocumentLisible | "auto";
}

/** Pièce jointe à une demande du site : le document qui y correspond (comme DOCUMENT_PAR_NATURE de l'API) */
export const DOCUMENT_PAR_NATURE: Record<string, DocumentLisible> = {
  carte_grise: "carte_grise", attestation_precedente: "attestation_assurance", liste_vehicules: "liste_vehicules",
  carte_transport: "carte_transport", registre_commerce: "registre_commerce",
};

const NOMS: Record<DocumentLisible, string> = {
  carte_grise: "la carte grise", piece_identite: "la pièce d'identité", constat_amiable: "le constat amiable",
  attestation_assurance: "l'attestation d'assurance", registre_commerce: "le registre de commerce", carte_transport: "la carte de transport",
  visite_technique: "la visite technique", liste_vehicules: "la liste des véhicules",
};
const TYPE_CLASSEUR = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TYPES: Record<string, string> = { "image/jpeg": "image/jpeg", "image/png": "image/png", "application/pdf": "application/pdf", [TYPE_CLASSEUR]: TYPE_CLASSEUR };

const LIBELLES: Record<string, string> = {
  immatriculation: "Immatriculation", numeroChassis: "N° de châssis", marque: "Marque", modele: "Modèle", genre: "Genre", energie: "Énergie",
  puissanceFiscale: "Puissance fiscale (CV)", placesAssises: "Places assises", datePremiereMiseEnCirculation: "1re mise en circulation",
  proprietaire: "Titulaire", usage: "Usage",
  typePiece: "Type de pièce", numero: "Numéro", nom: "Nom", prenoms: "Prénoms", dateNaissance: "Date de naissance", lieuNaissance: "Lieu de naissance",
  sexe: "Sexe", nationalite: "Nationalité", dateDelivrance: "Délivrée le", dateExpiration: "Expire le",
  date: "Date de l'accident", heure: "Heure", lieu: "Lieu", blesses: "Blessés", degatsAutres: "Dégâts à d'autres biens", temoins: "Témoins", croquis: "Croquis",
  assureur: "Assureur", intermediaire: "Intermédiaire", numeroPolice: "N° de police", numeroAttestation: "N° d'attestation", souscripteur: "Assuré",
  risque: "Risque assuré", dateEffet: "Effet le", dateEcheance: "Échéance le", garanties: "Garanties", primeTtc: "Prime TTC",
  raisonSociale: "Raison sociale", sigle: "Sigle", formeJuridique: "Forme juridique", numeroRccm: "N° RCCM", dateImmatriculation: "Immatriculée le",
  siege: "Siège", activite: "Activité", capital: "Capital", numeroContribuable: "N° de compte contribuable", dirigeants: "Dirigeants",
  titulaire: "Titulaire", categorie: "Catégorie de transport", centre: "Centre de contrôle", dateVisite: "Visite le", dateValidite: "Valable jusqu'au",
  resultat: "Résultat", nombreVehiculesDocument: "Véhicules dans le document",
};
const VALEURS: Record<string, string> = {
  favorable: "Favorable", defavorable: "Défavorable", contre_visite: "Contre-visite", cni: "Carte nationale d'identité", passeport: "Passeport",
  carte_sejour: "Carte de résident", carte_consulaire: "Carte consulaire", permis_conduire: "Permis de conduire",
  attestation_identite: "Attestation d'identité", autre: "Autre",
};
const MONTANTS = new Set(["primeTtc", "capital", "valeurVenale"]);
const IGNORES = new Set(["documentReconnu", "lisibilite", "remarques", "champsIncertains", "mrz", "vehicules"]);
const COLONNES_LISTE: [string, string][] = [
  ["immatriculation", "Immatriculation"], ["numeroChassis", "Châssis"], ["marque", "Marque"], ["modele", "Modèle"], ["genre", "Genre"], ["usage", "Usage"],
  ["puissanceFiscale", "CV"], ["valeurVenale", "Valeur"], ["echeanceVisiteTechnique", "Visite technique"], ["echeanceVignette", "Vignette"],
  ["echeanceCarteTransport", "Carte de transport"],
];

/** Disponibilité et documents permis : demandés à l'API une fois par page */
let disponibilite: Promise<DocumentLisible[]> | null = null;
function documentsPermis(): Promise<DocumentLisible[]> {
  disponibilite ??= api<{ disponible: boolean; documents?: { document: DocumentLisible }[] }>("/lecture-automatique")
    .then((r) => (r.disponible ? (r.documents ?? []).map((d) => d.document) : []))
    .catch(() => []);
  return disponibilite;
}

function lireEnBase64(fichier: File): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.addEventListener("load", () => resoudre(String(lecteur.result).split(",")[1] ?? ""));
    lecteur.addEventListener("error", () => rejeter(lecteur.error));
    lecteur.readAsDataURL(fichier);
  });
}

const enTexte = (valeur: unknown): string => (typeof valeur === "boolean" ? (valeur ? "Oui" : "Non") : String(valeur));
const dateFr = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);

function afficher(cle: string, valeur: unknown): string {
  if (MONTANTS.has(cle) && typeof valeur === "number") return montant(valeur);
  if (Array.isArray(valeur)) {
    return valeur.map((v) => (typeof v === "object" && v !== null
      ? [String((v as Record<string, unknown>).nom ?? ""), (v as Record<string, unknown>).fonction ? `(${String((v as Record<string, unknown>).fonction)})` : ""].join(" ").trim()
      : String(v))).join(cle === "dirigeants" ? " ; " : ", ");
  }
  if (typeof valeur === "string") return VALEURS[valeur] ?? dateFr(valeur);
  return enTexte(valeur);
}

/** Résumé d'un constat lu, prêt à compléter la note interne d'un sinistre */
export function resumeConstat(champs: Record<string, unknown>): string {
  const lignes = ["Constat amiable (lu automatiquement, vérifié avec le document) :"];
  const quand = [champs.date ? `le ${dateFr(String(champs.date))}` : null, champs.heure ? `à ${String(champs.heure)}` : null].filter(Boolean).join(" ");
  if (quand || champs.lieu) lignes.push(`- Accident ${quand}${champs.lieu ? `, ${String(champs.lieu)}` : ""}.`);
  if (champs.blesses !== null && champs.blesses !== undefined) lignes.push(`- Blessés : ${enTexte(champs.blesses).toLowerCase()}.`);
  for (const v of (champs.vehicules as Record<string, unknown>[] | undefined) ?? []) {
    const details = [v.immatriculation, v.marque, v.conducteur && `conduit par ${String(v.conducteur)}`, v.assureur && `assuré chez ${String(v.assureur)}`]
      .filter(Boolean).join(", ");
    const cases = (v.circonstances as number[] | undefined)?.length ? ` ; cases cochées : ${(v.circonstances as number[]).join(", ")}` : "";
    lignes.push(`- Véhicule ${String(v.lettre)} : ${details || "non lu"}${cases}${v.pointDeChoc ? ` ; choc : ${String(v.pointDeChoc)}` : ""}.`);
  }
  if (champs.croquis) lignes.push(`- Croquis : ${String(champs.croquis)}`);
  if (champs.temoins) lignes.push(`- Témoins : ${String(champs.temoins)}`);
  return lignes.join("\n");
}

/** Liste de véhicules lue → fichier CSV au format de l'import des flottes (en base64), pour son aperçu contrôlé */
export function listeEnCsv(champs: Record<string, unknown>): string {
  const cellule = (valeur: unknown) => {
    const texte = valeur === null || valeur === undefined ? "" : typeof valeur === "string" ? dateFr(valeur) : String(valeur);
    return /[;"\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
  };
  const entetes = ["Immatriculation", "N° de châssis", "Marque", "Modèle", "Genre", "Usage", "Puissance fiscale (CV)", "Valeur vénale",
    "Visite technique", "Vignette", "Carte de transport"];
  const lignes = ((champs.vehicules as Record<string, unknown>[] | undefined) ?? [])
    .map((v) => COLONNES_LISTE.map(([cle]) => cellule(v[cle])).join(";"));
  const octets = new TextEncoder().encode([entetes.join(";"), ...lignes].join("\n") + "\n");
  let binaire = "";
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return btoa(binaire);
}

function ValeursLues({ resultat }: { resultat: ResultatLecture }) {
  const { champs } = resultat;
  const incertains = new Set(champs.champsIncertains ?? []);
  const lignes = Object.entries(champs).filter(([cle, valeur]) =>
    !IGNORES.has(cle) && valeur !== null && valeur !== undefined && !(Array.isArray(valeur) && valeur.length === 0));
  const vehicules = (champs.vehicules as Record<string, unknown>[] | undefined) ?? [];
  const valeur = (cle: string, v: unknown) => (
    <dd className={incertains.has(cle) ? "valeur-incertaine" : undefined}>
      {afficher(cle, v)}{incertains.has(cle) && <span className="note"> (lecture douteuse, à vérifier)</span>}
    </dd>
  );
  return (
    <>
      <dl className="details">
        {lignes.map(([cle, v]) => <div key={cle}><dt>{LIBELLES[cle] ?? cle}</dt>{valeur(cle, v)}</div>)}
      </dl>
      {resultat.document === "liste_vehicules" && vehicules.length > 0 && (
        <div className="tableau-defilant">
          <table className="tableau">
            <caption className="note">{vehicules.length} véhicule(s) lu(s)</caption>
            <thead><tr>{COLONNES_LISTE.map(([, libelle]) => <th key={libelle} scope="col">{libelle}</th>)}</tr></thead>
            <tbody>
              {vehicules.map((v, i) => (
                <tr key={i}>{COLONNES_LISTE.map(([cle]) => <td key={cle}>{v[cle] === null || v[cle] === undefined ? "—" : afficher(cle, v[cle])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resultat.document === "constat_amiable" && vehicules.map((v) => (
        <div key={String(v.lettre)}>
          <h4>Véhicule {String(v.lettre)}</h4>
          <dl className="details">
            {Object.entries(v).filter(([cle, x]) => cle !== "lettre" && x !== null && !(Array.isArray(x) && x.length === 0)).map(([cle, x]) => (
              <div key={cle}><dt>{({ conducteur: "Conducteur", assure: "Assuré", assureur: "Assureur", numeroPolice: "N° de police", numeroAttestation: "N° d'attestation",
                immatriculation: "Immatriculation", marque: "Marque", circonstances: "Cases cochées", pointDeChoc: "Point de choc", degatsApparents: "Dégâts apparents",
                observations: "Observations" } as Record<string, string>)[cle] ?? cle}</dt><dd>{Array.isArray(x) ? x.join(", ") : String(x)}</dd></div>
            ))}
          </dl>
        </div>
      ))}
    </>
  );
}

const LIBELLES_ECHEANCES: Record<string, string> = { echeanceVisiteTechnique: "visite technique", echeanceCarteTransport: "carte de transport" };

function Rapprochements({ rapprochements, onMisAJour }: { rapprochements: Rapprochement[]; onMisAJour?: () => void | Promise<void> }) {
  const [faites, setFaites] = useState<Set<number>>(new Set());
  const [envoi, setEnvoi] = useState<number | null>(null);
  const [erreur, setErreur] = useState("");
  if (rapprochements.length === 0) return null;

  async function appliquer(index: number, proposition: NonNullable<Rapprochement["proposition"]>) {
    setErreur("");
    setEnvoi(index);
    try {
      await api(`/vehicules/${proposition.vehiculeId}`, { methode: "PATCH", corps: proposition.valeurs });
      setFaites((f) => new Set([...f, index]));
      await onMisAJour?.();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <>
      <h4>D'après les fiches de l'agence</h4>
      <ul className="lecture__controles">
        {rapprochements.map((r, i) => (
          <li key={i} className={`controle controle--${r.niveau === "attention" ? "attention" : "info"}`}>
            {r.message}
            {r.lien && <> <Lien href={r.lien.type === "client" ? `/clients/${r.lien.id}` : `/contrats/${r.lien.id}`}>
              {r.lien.type === "client" ? "Ouvrir la fiche du client" : "Ouvrir le contrat"}
            </Lien></>}
            {r.proposition && (faites.has(i)
              ? <strong> Fiche du véhicule mise à jour.</strong>
              : <> <button type="button" className="bouton bouton--petit" disabled={envoi !== null}
                  onClick={() => void appliquer(i, r.proposition!)}>
                  {envoi === i ? "Mise à jour…" : `Reporter sur la fiche (${Object.keys(r.proposition.valeurs).map((c) => LIBELLES_ECHEANCES[c] ?? c).join(", ")})`}
                </button></>)}
          </li>
        ))}
      </ul>
      <Alerte>{erreur}</Alerte>
    </>
  );
}

export function LectureAutomatique({ document, parmi, clientId, pieces = [], libelleReport, onLu, onMisAJour, titre }: {
  /** Document attendu, ou « auto » pour le faire reconnaître (parmi `parmi`, sinon tous ceux que le rôle permet) */
  document: DocumentLisible | "auto";
  parmi?: DocumentLisible[];
  /** Client du dossier : les valeurs lues sont rapprochées de sa fiche */
  clientId?: string;
  /** Pièces déjà enregistrées qu'on peut lire (justificatifs, photos d'un sinistre, pièces d'une demande du site) */
  pieces?: PieceLisible[];
  /** Ce que fait le bouton de report, par exemple « Pré-remplir la fiche » ; sans lui, les valeurs sont seulement affichées */
  libelleReport?: string;
  onLu?: (resultat: ResultatLecture) => void;
  /** Appelé après une mise à jour appliquée depuis un rapprochement (pour recharger l'écran) */
  onMisAJour?: () => void | Promise<void>;
  titre?: string;
}) {
  const [permis, setPermis] = useState<DocumentLisible[]>([]);
  const [source, setSource] = useState(pieces[0] ? `${pieces[0].source}:${pieces[0].id}` : "fichier");
  const [fichier, setFichier] = useState<File | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const [resultat, setResultat] = useState<ResultatLecture | null>(null);
  const [reporte, setReporte] = useState(false);

  useEffect(() => {
    let actif = true;
    void documentsPermis().then((d) => actif && setPermis(d));
    return () => {
      actif = false;
    };
  }, []);
  const candidats = document === "auto" ? (parmi ?? permis).filter((d) => permis.includes(d)) : permis.includes(document) ? [document] : [];
  if (candidats.length === 0) return null;
  const accepteClasseur = candidats.includes("liste_vehicules");

  async function lire() {
    setErreur("");
    setResultat(null);
    setReporte(false);
    setEnvoi(true);
    try {
      let corps: Record<string, unknown> = { document, ...(document === "auto" && parmi ? { parmi: candidats } : {}), ...(clientId ? { clientId } : {}) };
      if (source === "fichier") {
        if (!fichier) return;
        const type = TYPES[fichier.type];
        if (!type || (type === TYPE_CLASSEUR && !accepteClasseur)) {
          throw new Error(accepteClasseur ? "Choisissez une photo (JPEG ou PNG), un PDF ou un classeur Excel (.xlsx)." : "Choisissez une photo (JPEG ou PNG) ou un PDF.");
        }
        corps = { ...corps, fichier: { type, contenu: await lireEnBase64(fichier) } };
      } else {
        const [cle, id] = source.split(":");
        const piece = pieces.find((p) => p.id === id);
        const attendu = piece?.document ?? document;
        corps = { ...corps, document: attendu, ...(attendu === "auto" ? {} : { parmi: undefined }), [cle!]: id };
      }
      setResultat(await api<ResultatLecture>("/lecture-automatique", { corps: JSON.parse(JSON.stringify(corps)) }));
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  const intitule = titre ?? (document === "auto" ? "Lire un document automatiquement" : `Lire ${NOMS[document]} automatiquement`);
  return (
    <div className="lecture" role="group" aria-label={intitule}>
      <p className="lecture__titre"><strong>{intitule}</strong></p>
      <p className="note">
        {document === "auto" && `Documents reconnus : ${candidats.map((d) => NOMS[d].replace(/^(la |le |l')/, "")).join(", ")}. `}
        L'outil propose les valeurs et les rapproche des fiches ; vous les vérifiez avec le document avant d'enregistrer. Chaque lecture est consignée.
      </p>
      <div className="formulaire formulaire--ligne">
        {pieces.length > 0 && (
          <Champ libelle="Document à lire">
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {pieces.map((p) => <option key={p.id} value={`${p.source}:${p.id}`}>{p.libelle}</option>)}
              <option value="fichier">Un fichier de l'ordinateur</option>
            </select>
          </Champ>
        )}
        {source === "fichier" && (
          <Champ libelle={accepteClasseur ? "Photo, PDF ou classeur Excel (5 Mo au plus)" : "Photo ou PDF (5 Mo au plus)"}>
            <input type="file" accept={`image/jpeg,image/png,application/pdf${accepteClasseur ? `,.xlsx,${TYPE_CLASSEUR}` : ""}`}
              onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
          </Champ>
        )}
        <button type="button" className="bouton" disabled={envoi || (source === "fichier" && !fichier)} onClick={() => void lire()}>
          {envoi ? "Lecture en cours…" : "Lire le document"}
        </button>
      </div>
      <Alerte>{erreur}</Alerte>
      {resultat && (
        <div className="lecture__resultat">
          {resultat.reconnaissance && (
            <p><strong>Document reconnu : {resultat.libelle}</strong>{resultat.reconnaissance.confiance !== "haute" && " (à confirmer)"}</p>
          )}
          <Alerte type="info">
            {resultat.avertissement}{resultat.prestataire === "simulation" && " (Démonstration : ces valeurs sont des exemples, pas celles du document.)"}
          </Alerte>
          {resultat.controles.length > 0 && (
            <>
              <h4>Points à vérifier</h4>
              <ul className="lecture__controles">
                {resultat.controles.map((c, i) => <li key={i} className={`controle controle--${c.niveau}`}>{c.message}</li>)}
              </ul>
            </>
          )}
          <Rapprochements key={JSON.stringify(resultat.rapprochements)} rapprochements={resultat.rapprochements} onMisAJour={onMisAJour} />
          <h4>Valeurs lues</h4>
          <ValeursLues resultat={resultat} />
          {libelleReport && onLu && (
            <button type="button" className="bouton bouton--principal" disabled={reporte} onClick={() => { onLu(resultat); setReporte(true); }}>
              {reporte ? "Reporté : vérifiez, puis enregistrez" : libelleReport}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

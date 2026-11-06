// Lecture automatique d'un document (tâche 14) : carte grise, pièce d'identité, constat amiable. La personne choisit
// une pièce déjà enregistrée ou une photo, l'outil la lit, montre les contrôles et les valeurs lues, puis pré-remplit
// le formulaire. Rien n'est enregistré tant que la personne n'a pas vérifié et validé le formulaire elle-même.
// Invisible si la lecture automatique n'est pas activée sur l'API.

import { useEffect, useState } from "react";
import { api, messageErreur } from "../services/api";
import { Alerte, Champ } from "./communs";

export type DocumentLisible = "carte_grise" | "piece_identite" | "constat_amiable";
export interface Controle { champ: string | null; niveau: "ok" | "attention"; message: string }
export interface ResultatLecture {
  document: DocumentLisible;
  prestataire: "anthropic" | "simulation";
  champs: Record<string, unknown>;
  controles: Controle[];
  avertissement: string;
}
export interface PieceLisible { id: string; libelle: string; source: "justificatifId" | "pieceSinistreId" | "demandeSiteId" }

const NOMS: Record<DocumentLisible, string> = { carte_grise: "la carte grise", piece_identite: "la pièce d'identité", constat_amiable: "le constat amiable" };
const TYPES: Record<string, string> = { "image/jpeg": "image/jpeg", "image/png": "image/png", "application/pdf": "application/pdf" };

const LIBELLES: Record<string, string> = {
  immatriculation: "Immatriculation", numeroChassis: "N° de châssis", marque: "Marque", modele: "Modèle", genre: "Genre", energie: "Énergie",
  puissanceFiscale: "Puissance fiscale (CV)", placesAssises: "Places assises", datePremiereMiseEnCirculation: "1re mise en circulation",
  proprietaire: "Titulaire", usage: "Usage",
  typePiece: "Type de pièce", numero: "Numéro", nom: "Nom", prenoms: "Prénoms", dateNaissance: "Date de naissance", lieuNaissance: "Lieu de naissance",
  sexe: "Sexe", nationalite: "Nationalité", dateDelivrance: "Délivrée le", dateExpiration: "Expire le",
  date: "Date de l'accident", heure: "Heure", lieu: "Lieu", blesses: "Blessés", degatsAutres: "Dégâts à d'autres biens", temoins: "Témoins", croquis: "Croquis",
};
const IGNORES = new Set(["documentReconnu", "lisibilite", "remarques", "mrz", "vehicules"]);

/** La lecture n'est demandée à l'API qu'une fois par page */
let disponibilite: Promise<boolean> | null = null;
function lectureDisponible(): Promise<boolean> {
  disponibilite ??= api<{ disponible: boolean }>("/lecture-automatique").then((r) => r.disponible).catch(() => false);
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

function ValeursLues({ champs }: { champs: Record<string, unknown> }) {
  const lignes = Object.entries(champs).filter(([cle, valeur]) => !IGNORES.has(cle) && valeur !== null && valeur !== undefined);
  const vehicules = (champs.vehicules as Record<string, unknown>[] | undefined) ?? [];
  return (
    <>
      <dl className="details">
        {lignes.map(([cle, valeur]) => (
          <div key={cle}><dt>{LIBELLES[cle] ?? cle}</dt><dd>{typeof valeur === "string" ? dateFr(valeur) : enTexte(valeur)}</dd></div>
        ))}
      </dl>
      {vehicules.map((v) => (
        <div key={String(v.lettre)}>
          <h4>Véhicule {String(v.lettre)}</h4>
          <dl className="details">
            {Object.entries(v).filter(([cle, valeur]) => cle !== "lettre" && valeur !== null && !(Array.isArray(valeur) && valeur.length === 0)).map(([cle, valeur]) => (
              <div key={cle}><dt>{({ conducteur: "Conducteur", assure: "Assuré", assureur: "Assureur", numeroPolice: "N° de police", numeroAttestation: "N° d'attestation",
                immatriculation: "Immatriculation", marque: "Marque", circonstances: "Cases cochées", pointDeChoc: "Point de choc", degatsApparents: "Dégâts apparents",
                observations: "Observations" } as Record<string, string>)[cle] ?? cle}</dt><dd>{Array.isArray(valeur) ? valeur.join(", ") : String(valeur)}</dd></div>
            ))}
          </dl>
        </div>
      ))}
    </>
  );
}

export function LectureAutomatique({ document, pieces = [], libelleReport, onLu }: {
  document: DocumentLisible;
  /** Pièces déjà enregistrées qu'on peut lire (justificatifs, photos d'un sinistre, carte grise d'une demande) */
  pieces?: PieceLisible[];
  /** Ce que fait le bouton de report, par exemple « Pré-remplir la fiche » ; sans lui, les valeurs sont seulement affichées */
  libelleReport?: string;
  onLu?: (resultat: ResultatLecture) => void;
}) {
  const [disponible, setDisponible] = useState(false);
  const [source, setSource] = useState(pieces[0] ? `${pieces[0].source}:${pieces[0].id}` : "fichier");
  const [fichier, setFichier] = useState<File | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const [resultat, setResultat] = useState<ResultatLecture | null>(null);
  const [reporte, setReporte] = useState(false);

  useEffect(() => {
    let actif = true;
    void lectureDisponible().then((d) => actif && setDisponible(d));
    return () => {
      actif = false;
    };
  }, []);
  if (!disponible) return null;

  async function lire() {
    setErreur("");
    setResultat(null);
    setReporte(false);
    setEnvoi(true);
    try {
      let corps: Record<string, unknown> = { document };
      if (source === "fichier") {
        if (!fichier) return;
        const type = TYPES[fichier.type];
        if (!type) throw new Error("Choisissez une photo (JPEG ou PNG) ou un PDF.");
        corps = { ...corps, fichier: { type, contenu: await lireEnBase64(fichier) } };
      } else {
        const [cle, id] = source.split(":");
        corps = { ...corps, [cle!]: id };
      }
      setResultat(await api<ResultatLecture>("/lecture-automatique", { corps }));
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="lecture" role="group" aria-label={`Lecture automatique de ${NOMS[document]}`}>
      <p className="lecture__titre"><strong>Lire {NOMS[document]} automatiquement</strong></p>
      <p className="note">L'outil propose les valeurs ; vous les vérifiez avec le document avant d'enregistrer. Chaque lecture est consignée.</p>
      <div className="formulaire formulaire--ligne">
        {pieces.length > 0 && (
          <Champ libelle="Document à lire">
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {pieces.map((p) => <option key={p.id} value={`${p.source}:${p.id}`}>{p.libelle}</option>)}
              <option value="fichier">Une photo ou un PDF de l'ordinateur</option>
            </select>
          </Champ>
        )}
        {source === "fichier" && (
          <Champ libelle="Photo ou PDF (5 Mo au plus)">
            <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
          </Champ>
        )}
        <button type="button" className="bouton" disabled={envoi || (source === "fichier" && !fichier)} onClick={() => void lire()}>
          {envoi ? "Lecture en cours…" : "Lire le document"}
        </button>
      </div>
      <Alerte>{erreur}</Alerte>
      {resultat && (
        <div className="lecture__resultat">
          <Alerte type="info">
            {resultat.avertissement}{resultat.prestataire === "simulation" && " (Démonstration : ces valeurs sont des exemples, pas celles du document.)"}
          </Alerte>
          {resultat.controles.length > 0 && (
            <ul className="lecture__controles">
              {resultat.controles.map((c, i) => <li key={i} className={`controle controle--${c.niveau}`}>{c.message}</li>)}
            </ul>
          )}
          <ValeursLues champs={resultat.champs} />
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

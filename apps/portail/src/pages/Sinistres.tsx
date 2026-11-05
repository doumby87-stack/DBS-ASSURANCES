// Sinistres : la liste et leur suivi, la déclaration en ligne (ce qui s'est passé, où, quand), puis les photos
// et documents (constat amiable, photos des dégâts, procès-verbal), envoyés à l'agence. L'agence transmet la
// déclaration à la compagnie et en fait suivre ici chaque étape.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ErreurApi, messageErreur } from "../api";
import { Alerte, Badge, Champ, Chargement, Ligne } from "../composants";
import { aujourdHui, BRANCHES, dateCourte, dateHeure, NATURES_SINISTRE, STATUTS_SINISTRE, taille, TELEPHONE_AGENCE } from "../format";
import { Lien, naviguer } from "../routeur";

interface Sinistre {
  id: string;
  survenuLe: string;
  declareLe: string;
  nature: string;
  statut: string;
  dommagesCorporels: boolean;
  lieu: string | null;
  circonstances: string | null;
  referenceCompagnie: string | null;
  declareEnLigne: boolean;
  numeroPolice: string | null;
  immatriculation: string | null;
  pieces: number;
  piecesAcceptees: boolean;
}

interface Piece {
  id: string;
  nom: string;
  type: string;
  taille: number;
  deposeLe: string;
}

const TYPES_ACCEPTES = ["image/jpeg", "image/png", "application/pdf"];
const TAILLE_MAX = 5 * 1024 * 1024;
const PIECES_MAX = 8;
const CLOS = ["regle", "refuse", "classe_sans_suite"];

function tonSinistre(statut: string): "vert" | "orange" | "rouge" | "gris" | "bleu" {
  if (statut === "regle") return "vert";
  if (statut === "refuse") return "rouge";
  if (statut === "classe_sans_suite") return "gris";
  return statut === "declare" ? "orange" : "bleu";
}

function lireEnBase64(fichier: File): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(String(lecteur.result).split(",")[1] ?? "");
    lecteur.onerror = () => rejeter(new Error("Lecture du fichier impossible"));
    lecteur.readAsDataURL(fichier);
  });
}

/** Contrôle avant l'envoi (l'API vérifie de nouveau le contenu réel) ; rend la raison du refus. */
function refusFichier(fichier: File): string | null {
  if (!TYPES_ACCEPTES.includes(fichier.type)) return `${fichier.name} : envoyez une photo (JPEG ou PNG) ou un PDF.`;
  if (fichier.size > TAILLE_MAX) return `${fichier.name} : fichier trop lourd (5 Mo au plus).`;
  return null;
}

/** Envoie les fichiers un à un ; rend les erreurs rencontrées. */
async function envoyerPieces(sinistreId: string, fichiers: File[], progression: (texte: string) => void): Promise<string[]> {
  const erreurs: string[] = [];
  for (const [rang, fichier] of fichiers.entries()) {
    progression(`Envoi de ${fichier.name} (${rang + 1} sur ${fichiers.length})…`);
    try {
      await api(`/portail/sinistres/${sinistreId}/pieces`, { corps: { nom: fichier.name, type: fichier.type, fichier: await lireEnBase64(fichier) } });
    } catch (e) {
      erreurs.push(`${fichier.name} : ${messageErreur(e)}`);
    }
  }
  progression("");
  return erreurs;
}

function ChoixFichiers({ fichiers, setFichiers, restant }: { fichiers: File[]; setFichiers(f: File[]): void; restant: number }) {
  const [refus, setRefus] = useState<string[]>([]);
  return (
    <div className="champ">
      <label className="champ__libelle" htmlFor="pieces-sinistre">Photos et documents (facultatif)</label>
      <input id="pieces-sinistre" aria-describedby="pieces-sinistre-aide" type="file" multiple accept="image/jpeg,image/png,application/pdf" onChange={(e) => {
        const choisis = Array.from(e.target.files ?? []);
        const refuses = choisis.map(refusFichier).filter((r): r is string => r !== null);
        const acceptes = choisis.filter((f) => refusFichier(f) === null).slice(0, restant);
        if (choisis.length - refuses.length > restant) refuses.push(`${PIECES_MAX} documents au plus par sinistre.`);
        setRefus(refuses);
        setFichiers(acceptes);
      }} />
      <span id="pieces-sinistre-aide" className="champ__aide">Constat amiable, photos des dégâts, procès-verbal : JPEG, PNG ou PDF, 5 Mo au plus chacun, {restant} au plus.</span>
      {fichiers.length > 0 && <ul className="liste-fichiers">{fichiers.map((f) => <li key={`${f.name}-${f.size}`}>{f.name} · {taille(f.size)}</li>)}</ul>}
      {refus.map((r) => <Alerte key={r}>{r}</Alerte>)}
    </div>
  );
}

export function ListeSinistres() {
  const [sinistres, setSinistres] = useState<Sinistre[] | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api<{ sinistres: Sinistre[] }>("/portail/sinistres").then((r) => setSinistres(r.sinistres)).catch((e: unknown) => setErreur(messageErreur(e)));
  }, []);

  return (
    <>
      <div className="section__entete">
        <h1>Vos sinistres</h1>
        <Lien href="/sinistres/declarer" className="bouton bouton--principal">Déclarer un sinistre</Lien>
      </div>
      <p>
        Déclarez un accident, un vol ou un incendie dès que possible (5 jours ouvrés au plus ; 2 jours pour un vol). En cas de blessé,
        appelez aussi l'agence au {TELEPHONE_AGENCE}.
      </p>
      <Alerte>{erreur}</Alerte>
      {!sinistres ? (!erreur && <Chargement />) : sinistres.length === 0 ? <p className="note">Aucun sinistre enregistré.</p> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Survenu le</th><th>Nature</th><th>Contrat</th><th>Suivi</th><th>Documents</th></tr></thead>
            <tbody>
              {sinistres.map((s) => (
                <tr key={s.id}>
                  <td><Lien href={`/sinistres/${s.id}`}>{dateCourte(s.survenuLe)}</Lien></td>
                  <td>{NATURES_SINISTRE[s.nature] ?? s.nature}{s.immatriculation && <span className="note"><br />{s.immatriculation}</span>}</td>
                  <td>{s.numeroPolice ?? "—"}</td>
                  <td>
                    <Badge ton={tonSinistre(s.statut)}>{STATUTS_SINISTRE[s.statut] ?? s.statut}</Badge>
                    {s.referenceCompagnie && <span className="note"><br />Réf. compagnie {s.referenceCompagnie}</span>}
                  </td>
                  <td>{s.pieces === 0 ? <span className="note">Aucun</span> : s.pieces}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface Choix {
  contrats: { id: string; numeroPolice: string | null; branche: string; statut: string }[];
  vehicules: { id: string; immatriculation: string; contratId: string | null }[];
}

export function DeclarerSinistre() {
  const prerempli = new URLSearchParams(window.location.search).get("vehicule");
  const [choix, setChoix] = useState<Choix | null>(null);
  const [contratId, setContratId] = useState("");
  const [vehiculeId, setVehiculeId] = useState("");
  const [survenuLe, setSurvenuLe] = useState(aujourdHui());
  const [nature, setNature] = useState("materiel");
  const [blesses, setBlesses] = useState(false);
  const [lieu, setLieu] = useState("");
  const [circonstances, setCirconstances] = useState("");
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [progression, setProgression] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    api<Choix>("/portail/flotte")
      .then((r) => {
        const contrats = r.contrats.filter((k) => k.statut !== "resilie");
        setChoix({ contrats, vehicules: r.vehicules });
        const vehicule = r.vehicules.find((v) => v.id === prerempli && v.contratId);
        if (vehicule?.contratId) {
          setContratId(vehicule.contratId);
          setVehiculeId(vehicule.id);
        } else if (contrats.length === 1) setContratId(contrats[0]!.id);
      })
      .catch((e: unknown) => setErreur(messageErreur(e)));
  }, [prerempli]);

  const vehiculesDuContrat = choix?.vehicules.filter((v) => v.contratId === contratId) ?? [];
  useEffect(() => {
    // Un seul véhicule sur le contrat : c'est lui
    if (vehiculesDuContrat.length === 1 && !vehiculeId) setVehiculeId(vehiculesDuContrat[0]!.id);
  }, [vehiculesDuContrat, vehiculeId]);

  async function declarer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const { sinistre } = await api<{ sinistre: { id: string } }>("/portail/sinistres", {
        corps: {
          contratId, ...(vehiculeId ? { vehiculeId } : {}), survenuLe, nature, dommagesCorporels: blesses || nature === "corporel",
          ...(lieu.trim() ? { lieu: lieu.trim() } : {}), circonstances: circonstances.trim(),
        },
      });
      const erreurs = await envoyerPieces(sinistre.id, fichiers, setProgression);
      const message = erreurs.length > 0
        ? `Sinistre déclaré, mais ${erreurs.length} document(s) n'ont pas été envoyés : ${erreurs.join(" ; ")}`
        : "Sinistre déclaré : l'agence l'a reçu et vous recontacte pour la suite.";
      naviguer(`/sinistres/${sinistre.id}?message=${encodeURIComponent(message)}`);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  }

  if (!choix) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  if (choix.contrats.length === 0) {
    return <><h1>Déclarer un sinistre</h1><Alerte type="info">Aucun contrat en cours : appelez l'agence au {TELEPHONE_AGENCE}.</Alerte></>;
  }

  return (
    <>
      <p className="fil"><Lien href="/sinistres">Vos sinistres</Lien></p>
      <h1>Déclarer un sinistre</h1>
      <p>
        Décrivez ce qui s'est passé : l'agence vérifie votre déclaration et la transmet à la compagnie. Gardez l'original du constat amiable,
        il peut vous être demandé.
      </p>
      <form className="formulaire section" aria-label="Déclaration de sinistre" onSubmit={(e) => void declarer(e)}>
        <Champ libelle="Contrat concerné">
          <select value={contratId} required onChange={(e) => { setContratId(e.target.value); setVehiculeId(""); }}>
            <option value="">Choisissez…</option>
            {choix.contrats.map((k) => (
              <option key={k.id} value={k.id}>{k.numeroPolice ?? "N° à venir"} · {BRANCHES[k.branche] ?? k.branche}</option>
            ))}
          </select>
        </Champ>
        {vehiculesDuContrat.length > 0 && (
          <Champ libelle="Véhicule">
            <select value={vehiculeId} onChange={(e) => setVehiculeId(e.target.value)}>
              <option value="">Aucun en particulier</option>
              {vehiculesDuContrat.map((v) => <option key={v.id} value={v.id}>{v.immatriculation}</option>)}
            </select>
          </Champ>
        )}
        <Champ libelle="Date du sinistre">
          <input type="date" value={survenuLe} required max={aujourdHui()} onChange={(e) => setSurvenuLe(e.target.value)} />
        </Champ>
        <Champ libelle="Nature">
          <select value={nature} onChange={(e) => setNature(e.target.value)}>
            {Object.entries(NATURES_SINISTRE).map(([code, libelle]) => <option key={code} value={code}>{libelle}</option>)}
          </select>
        </Champ>
        <label className="case">
          <input type="checkbox" checked={blesses || nature === "corporel"} disabled={nature === "corporel"} onChange={(e) => setBlesses(e.target.checked)} />
          <span>Il y a des blessés</span>
        </label>
        <Champ libelle="Lieu (facultatif)">
          <input value={lieu} maxLength={200} placeholder="Ville, quartier, carrefour…" onChange={(e) => setLieu(e.target.value)} />
        </Champ>
        <Champ libelle="Ce qui s'est passé" aide="Les véhicules et personnes en cause, les dégâts constatés, la présence de la police ou d'un constat amiable.">
          <textarea value={circonstances} required minLength={10} maxLength={4000} rows={6} onChange={(e) => setCirconstances(e.target.value)} />
        </Champ>
        <ChoixFichiers fichiers={fichiers} setFichiers={setFichiers} restant={PIECES_MAX} />
        <Alerte type="info">{progression}</Alerte>
        <Alerte>{erreur}</Alerte>
        <button type="submit" className="bouton bouton--principal" disabled={envoi || !contratId || circonstances.trim().length < 10}>
          {envoi ? "Envoi…" : "Envoyer la déclaration"}
        </button>
      </form>
    </>
  );
}

export function DetailSinistre({ id }: { id: string }) {
  const [detail, setDetail] = useState<{ sinistre: Sinistre; pieces: Piece[] } | null>(null);
  const [message, setMessage] = useState(() => new URLSearchParams(window.location.search).get("message") ?? "");
  const [erreur, setErreur] = useState("");
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [progression, setProgression] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [cle, setCle] = useState(0);

  const charger = useCallback(async () => {
    try {
      setDetail(await api<{ sinistre: Sinistre; pieces: Piece[] }>(`/portail/sinistres/${id}`));
    } catch (e) {
      setErreur(e instanceof ErreurApi && e.statut === 404 ? "Ce sinistre est introuvable." : messageErreur(e));
    }
  }, [id]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function ajouter(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setMessage("");
    setEnvoi(true);
    const erreurs = await envoyerPieces(id, fichiers, setProgression);
    setEnvoi(false);
    setFichiers([]);
    setCle((c) => c + 1);
    if (erreurs.length > 0) setErreur(erreurs.join(" ; "));
    else setMessage("Documents envoyés à l'agence.");
    await charger();
  }

  if (!detail) return erreur ? <><Alerte>{erreur}</Alerte><p><Lien href="/sinistres">Vos sinistres</Lien></p></> : <Chargement />;
  const { sinistre: s, pieces } = detail;
  const restant = PIECES_MAX - pieces.length;

  return (
    <>
      <p className="fil"><Lien href="/sinistres">Vos sinistres</Lien></p>
      <h1>Sinistre du {dateCourte(s.survenuLe)}</h1>
      <Alerte type="succes">{message}</Alerte>
      <dl className="fiche">
        <Ligne titre="Suivi"><Badge ton={tonSinistre(s.statut)}>{STATUTS_SINISTRE[s.statut] ?? s.statut}</Badge></Ligne>
        {s.referenceCompagnie && <Ligne titre="Référence de la compagnie">{s.referenceCompagnie}</Ligne>}
        <Ligne titre="Nature">{NATURES_SINISTRE[s.nature] ?? s.nature}{s.dommagesCorporels && " · avec blessés"}</Ligne>
        <Ligne titre="Contrat">{s.numeroPolice ?? "—"}{s.immatriculation && ` · ${s.immatriculation}`}</Ligne>
        <Ligne titre="Déclaré le">{dateCourte(s.declareLe)}{s.declareEnLigne ? " (en ligne)" : " (à l'agence)"}</Ligne>
        {s.lieu && <Ligne titre="Lieu">{s.lieu}</Ligne>}
      </dl>
      {s.circonstances && <section className="section"><h2>Ce qui s'est passé</h2><p className="texte-libre">{s.circonstances}</p></section>}

      <section className="section" aria-labelledby="titre-pieces">
        <h2 id="titre-pieces">Photos et documents</h2>
        {pieces.length === 0 ? <p className="note">Aucun document envoyé.</p> : (
          <ul className="liste-fichiers">
            {pieces.map((p) => <li key={p.id}>{p.nom} · {taille(p.taille)} · envoyé le {dateHeure(p.deposeLe)}</li>)}
          </ul>
        )}
        {s.piecesAcceptees && restant > 0 && !CLOS.includes(s.statut) ? (
          <form className="formulaire" aria-label="Ajouter des documents" onSubmit={(e) => void ajouter(e)}>
            <ChoixFichiers key={cle} fichiers={fichiers} setFichiers={setFichiers} restant={restant} />
            <Alerte type="info">{progression}</Alerte>
            <Alerte>{erreur}</Alerte>
            <button type="submit" className="bouton bouton--principal" disabled={envoi || fichiers.length === 0}>{envoi ? "Envoi…" : "Envoyer"}</button>
          </form>
        ) : (
          <p className="note">D'autres documents à transmettre ? Envoyez-les à l'agence sur WhatsApp ou déposez-les au bureau.</p>
        )}
      </section>
    </>
  );
}

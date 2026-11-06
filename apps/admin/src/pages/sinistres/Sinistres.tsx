// Sinistres de l'agence : ceux à traiter en premier (déclarés en ligne par les clients, ou au guichet), leur
// fiche avec le récit du client et ses photos et documents, puis le suivi avec la compagnie. Chaque étape est
// visible par le client dans son espace.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Chargement, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import { dateCourte, dateHeure, lienWhatsApp, NATURES_SINISTRE, STATUTS_SINISTRE, telephone } from "../../services/format";
import { useSession } from "../../session";

interface SinistreListe {
  id: string;
  survenuLe: string;
  declareLe: string;
  nature: string;
  statut: string;
  dommagesCorporels: boolean;
  referenceCompagnie: string | null;
  declareEnLigne: boolean;
  numeroPolice: string | null;
  clientId: string;
  client: string;
  immatriculation: string | null;
  pieces: number;
}

interface SinistreFiche extends SinistreListe {
  contratId: string;
  description: string | null;
  lieu: string | null;
  circonstances: string | null;
  declarePar: string | null;
  telephoneDeclarant: string | null;
}

interface Piece {
  id: string;
  nom: string;
  type: string;
  taille: number;
  etatAnalyse: string;
  deposeLe: string;
  deposePar: string | null;
}

const CLOS = ["regle", "refuse", "classe_sans_suite"];

function tonSinistre(statut: string): "vert" | "orange" | "rouge" | "gris" | "bleu" {
  if (statut === "regle") return "vert";
  if (statut === "refuse") return "rouge";
  if (statut === "classe_sans_suite") return "gris";
  return statut === "declare" ? "orange" : "bleu";
}

function taille(octets: number): string {
  return octets < 1024 * 1024 ? `${Math.max(1, Math.round(octets / 1024))} Ko` : `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export function Sinistres() {
  const [tous, setTous] = useState(false);
  const [sinistres, setSinistres] = useState<SinistreListe[] | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setSinistres(null);
    api<{ sinistres: SinistreListe[] }>(`/sinistres${tous ? "?tous=oui" : ""}`)
      .then((r) => setSinistres(r.sinistres))
      .catch((e: unknown) => setErreur(messageErreur(e)));
  }, [tous]);

  const aTraiter = sinistres?.filter((s) => s.statut === "declare").length ?? 0;

  return (
    <>
      <h1>Sinistres</h1>
      <p>
        Les déclarations reçues (en ligne par les clients, ou au guichet) attendent d'être transmises à la compagnie : vérifiez le récit et les
        documents, transmettez, puis notez la référence de la compagnie. Le client suit chaque étape dans son espace.
      </p>
      <div className="onglets" role="group" aria-label="Sinistres affichés">
        <button type="button" className={`bouton bouton--petit${tous ? "" : " bouton--principal"}`} aria-pressed={!tous} onClick={() => setTous(false)}>
          En cours{sinistres && !tous ? ` (${sinistres.length})` : ""}
        </button>
        <button type="button" className={`bouton bouton--petit${tous ? " bouton--principal" : ""}`} aria-pressed={tous} onClick={() => setTous(true)}>
          Tous
        </button>
      </div>
      <Alerte>{erreur}</Alerte>
      {aTraiter > 0 && <Alerte type="info">{aTraiter} déclaration(s) à transmettre à la compagnie.</Alerte>}
      {!sinistres ? (!erreur && <Chargement />) : sinistres.length === 0 ? <Vide>Aucun sinistre {tous ? "" : "en cours"}.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr><th>Déclaré le</th><th>Client</th><th>Sinistre</th><th>Contrat</th><th>Statut</th><th>Documents</th></tr>
            </thead>
            <tbody>
              {sinistres.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Lien href={`/sinistres/${s.id}`}>{dateCourte(s.declareLe)}</Lien>
                    {s.declareEnLigne && <><br /><Badge ton="bleu">En ligne</Badge></>}
                  </td>
                  <td><Lien href={`/clients/${s.clientId}`}>{s.client}</Lien></td>
                  <td>
                    {NATURES_SINISTRE[s.nature] ?? s.nature} le {dateCourte(s.survenuLe)}
                    {s.dommagesCorporels && <><br /><Badge ton="rouge">Blessés</Badge></>}
                  </td>
                  <td>{s.numeroPolice ?? "—"}{s.immatriculation && <span className="note"><br />{s.immatriculation}</span>}</td>
                  <td>
                    <Badge ton={tonSinistre(s.statut)}>{STATUTS_SINISTRE[s.statut] ?? s.statut}</Badge>
                    {s.referenceCompagnie && <span className="note"><br />{s.referenceCompagnie}</span>}
                  </td>
                  <td className="nombre">{s.pieces || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function FicheSinistre({ id }: { id: string }) {
  const { peut } = useSession();
  const gestion = peut("gerant", "charge_clientele");
  const telechargement = peut("gerant", "charge_clientele", "commercial");
  const [detail, setDetail] = useState<{ sinistre: SinistreFiche; pieces: Piece[] } | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [statut, setStatut] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const charger = useCallback(async () => {
    try {
      const r = await api<{ sinistre: SinistreFiche; pieces: Piece[] }>(`/sinistres/${id}`);
      setDetail(r);
      setStatut(r.sinistre.statut);
      setReference(r.sinistre.referenceCompagnie ?? "");
      setNote(r.sinistre.description ?? "");
    } catch (e) {
      setErreur(e instanceof ErreurApi && e.statut === 404 ? "Ce sinistre est introuvable." : messageErreur(e));
    }
  }, [id]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function enregistrer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setMessage("");
    try {
      await api(`/sinistres/${id}`, { methode: "PATCH", corps: { statut, referenceCompagnie: reference, description: note } });
      setMessage("Suivi enregistré : le client voit le nouveau statut dans son espace.");
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  if (!detail) return erreur ? <><Alerte>{erreur}</Alerte><p><Lien href="/sinistres">Retour aux sinistres</Lien></p></> : <Chargement />;
  const { sinistre: s, pieces } = detail;

  return (
    <>
      <p className="fil"><Lien href="/sinistres">Sinistres</Lien></p>
      <h1>{NATURES_SINISTRE[s.nature] ?? s.nature} du {dateCourte(s.survenuLe)} — {s.client}</h1>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>

      <Section titre="Déclaration">
        <dl className="details">
          <div><dt>Statut</dt><dd><Badge ton={tonSinistre(s.statut)}>{STATUTS_SINISTRE[s.statut] ?? s.statut}</Badge></dd></div>
          <div><dt>Client</dt><dd><Lien href={`/clients/${s.clientId}`}>{s.client}</Lien></dd></div>
          <div><dt>Contrat</dt><dd><Lien href={`/contrats/${s.contratId}`}>{s.numeroPolice ?? "N° à venir"}</Lien>{s.immatriculation && ` · ${s.immatriculation}`}</dd></div>
          <div><dt>Survenu le</dt><dd>{dateCourte(s.survenuLe)}{s.dommagesCorporels && <> · <Badge ton="rouge">Blessés</Badge></>}</dd></div>
          <div>
            <dt>Déclaré le</dt>
            <dd>
              {dateCourte(s.declareLe)} {s.declareEnLigne ? `en ligne par ${s.declarePar ?? "le client"}` : "à l'agence"}
              {s.telephoneDeclarant && (
                <>
                  {" · "}<a href={`tel:${s.telephoneDeclarant}`}>{telephone(s.telephoneDeclarant)}</a>{" · "}
                  <a href={lienWhatsApp(s.telephoneDeclarant, `Bonjour, ici DBS-ASSURANCES : nous avons bien reçu votre déclaration de sinistre du ${dateCourte(s.survenuLe)}.`)}
                    target="_blank" rel="noopener noreferrer">Écrire sur WhatsApp</a>
                </>
              )}
            </dd>
          </div>
          {s.lieu && <div><dt>Lieu</dt><dd>{s.lieu}</dd></div>}
          {s.circonstances && <div><dt>Récit du client</dt><dd className="texte-libre">{s.circonstances}</dd></div>}
        </dl>
      </Section>

      <Section titre={`Photos et documents (${pieces.length})`}>
        {pieces.length === 0 ? <Vide>Aucun document joint.</Vide> : (
          <ul className="liste-simple">
            {pieces.map((p) => (
              <li key={p.id}>
                {telechargement && p.etatAnalyse === "saine" ? (
                  <a href={`/api/sinistres/${s.id}/pieces/${p.id}`} download>{p.nom}</a>
                ) : p.nom}
                <span className="note"> · {taille(p.taille)} · {dateHeure(p.deposeLe)}{p.deposePar && ` par ${p.deposePar}`}
                  {p.etatAnalyse !== "saine" && " · en attente d'analyse antivirus"}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="note">Chaque document a été analysé par l'antivirus à son arrivée ; chaque téléchargement est consigné.</p>
      </Section>

      {gestion && (
        <Section titre="Suivi avec la compagnie">
          <form className="formulaire" aria-label="Suivi du sinistre" onSubmit={(e) => void enregistrer(e)}>
            <label className="champ">
              <span className="champ__libelle">Statut</span>
              <select value={statut} onChange={(e) => setStatut(e.target.value)}>
                {Object.entries(STATUTS_SINISTRE).map(([code, libelle]) => <option key={code} value={code}>{libelle}</option>)}
              </select>
            </label>
            <label className="champ">
              <span className="champ__libelle">Référence de la compagnie</span>
              <input value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
            </label>
            <label className="champ">
              <span className="champ__libelle">Note interne (jamais montrée au client)</span>
              <textarea value={note} maxLength={4000} rows={4} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button type="submit" className="bouton bouton--principal">Enregistrer le suivi</button>
            {CLOS.includes(s.statut) && <p className="note">Dossier clos. Il peut être rouvert en changeant le statut.</p>}
          </form>
        </Section>
      )}
    </>
  );
}

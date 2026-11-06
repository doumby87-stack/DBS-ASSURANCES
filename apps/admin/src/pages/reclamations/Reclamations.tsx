// Registre des réclamations (tâche 12) : liste (ouvertes d'abord, retards signalés), enregistrement d'une
// réclamation reçue, fiche avec le traitement étape par étape (accusé de réception, réponse et issue,
// recours, clôture), export du registre pour la compagnie et la Direction des Assurances.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Chargement, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import { dateCourte, dateHeure, lienWhatsApp, telephone } from "../../services/format";
import { useSession } from "../../session";

export const OBJETS_RECLAMATION: Record<string, string> = {
  contrat: "Contrat", prime_paiement: "Prime ou paiement", sinistre: "Sinistre", attestation: "Attestation",
  accueil_service: "Accueil et service", donnees_personnelles: "Données personnelles", autre: "Autre",
};
const CANAUX: Record<string, string> = {
  guichet: "Au guichet", telephone: "Par téléphone", whatsapp: "Par WhatsApp", email: "Par e-mail", courrier: "Par courrier",
  espace_client: "Espace client",
};
const STATUTS: Record<string, { libelle: string; ton: "vert" | "orange" | "bleu" | "gris" }> = {
  recue: { libelle: "Reçue", ton: "orange" }, en_cours: { libelle: "En cours", ton: "bleu" },
  repondue: { libelle: "Répondue", ton: "vert" }, close: { libelle: "Close", ton: "gris" },
};
const ISSUES: Record<string, string> = { fondee: "Fondée", partiellement_fondee: "Partiellement fondée", non_fondee: "Non fondée" };
const RECOURS: Record<string, string> = { compagnie: "la compagnie", direction_assurances: "la Direction des Assurances" };

export interface Reclamation {
  id: string;
  reference: string;
  clientId: string | null;
  nom: string;
  telephone: string | null;
  canal: string;
  objet: string;
  description: string;
  contratId: string | null;
  numeroPolice: string | null;
  statut: string;
  recueLe: string;
  echeanceAccuse: string;
  echeanceReponse: string;
  accuseLe: string | null;
  reponse: string | null;
  issue: string | null;
  repondueLe: string | null;
  escalade: string | null;
  escaladeLe: string | null;
  closeLe: string | null;
  enregistrePar: string | null;
  accuseEnRetard: boolean;
  reponseEnRetard: boolean;
}

function Etat({ r }: { r: Reclamation }) {
  const s = STATUTS[r.statut] ?? STATUTS.recue!;
  return (
    <>
      <Badge ton={s.ton}>{s.libelle}</Badge>
      {r.accuseEnRetard && <> <Badge ton="rouge">Accusé de réception en retard</Badge></>}
      {r.reponseEnRetard && <> <Badge ton="rouge">Réponse en retard</Badge></>}
    </>
  );
}

function TableauReclamations({ reclamations }: { reclamations: Reclamation[] }) {
  return (
    <div className="tableau-defilant">
      <table className="tableau">
        <thead><tr><th>Référence</th><th>Réclamant</th><th>Objet</th><th>Reçue le</th><th>Réponse attendue le</th><th>État</th></tr></thead>
        <tbody>
          {reclamations.map((r) => (
            <tr key={r.id}>
              <td><Lien href={`/reclamations/${r.id}`}>{r.reference}</Lien><br /><small>{CANAUX[r.canal] ?? r.canal}</small></td>
              <td>{r.clientId ? <Lien href={`/clients/${r.clientId}`}>{r.nom}</Lien> : r.nom}</td>
              <td>{OBJETS_RECLAMATION[r.objet] ?? r.objet}{r.numeroPolice && <><br /><small>{r.numeroPolice}</small></>}</td>
              <td>{dateHeure(r.recueLe)}</td>
              <td>{dateCourte(r.echeanceReponse)}</td>
              <td><Etat r={r} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Formulaire d'enregistrement : pour un client (depuis sa fiche) ou pour une personne qui n'est pas cliente. */
export function NouvelleReclamation({ clientId, contrats = [], apres }: {
  clientId?: string; contrats?: { id: string; numeroPolice: string | null; branche: string }[]; apres: (reference: string) => Promise<void> | void;
}) {
  const [s, setS] = useState({ nom: "", telephone: "", canal: "guichet", objet: "contrat", description: "", contratId: "" });
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const { reclamation } = await api<{ reclamation: { reference: string } }>("/reclamations", {
        corps: {
          canal: s.canal, objet: s.objet, description: s.description.trim(),
          ...(clientId ? { clientId } : { nom: s.nom.trim(), ...(s.telephone.trim() ? { telephone: s.telephone.trim() } : {}) }),
          ...(s.contratId ? { contratId: s.contratId } : {}),
        },
      });
      setS({ ...s, description: "", contratId: "" });
      await apres(reclamation.reference);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="formulaire formulaire--grille" aria-label="Nouvelle réclamation" onSubmit={(e) => void soumettre(e)}>
      {!clientId && (
        <>
          <Champ libelle="Nom du réclamant"><input required minLength={2} maxLength={160} value={s.nom} onChange={(e) => setS({ ...s, nom: e.target.value })} /></Champ>
          <Champ libelle="Téléphone (facultatif)"><input type="tel" maxLength={30} value={s.telephone} onChange={(e) => setS({ ...s, telephone: e.target.value })} /></Champ>
        </>
      )}
      <Champ libelle="Reçue">
        <select value={s.canal} onChange={(e) => setS({ ...s, canal: e.target.value })}>
          {Object.entries(CANAUX).filter(([v]) => v !== "espace_client").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Champ>
      <Champ libelle="Objet">
        <select value={s.objet} onChange={(e) => setS({ ...s, objet: e.target.value })}>
          {Object.entries(OBJETS_RECLAMATION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Champ>
      {contrats.length > 0 && (
        <Champ libelle="Contrat concerné (facultatif)">
          <select value={s.contratId} onChange={(e) => setS({ ...s, contratId: e.target.value })}>
            <option value="">—</option>
            {contrats.map((k) => <option key={k.id} value={k.id}>{k.numeroPolice ?? "N° à venir"}</option>)}
          </select>
        </Champ>
      )}
      <Champ libelle="Ce que dit le client" aide="Ses mots, sans les interpréter : 10 caractères au moins.">
        <textarea required minLength={10} maxLength={4000} rows={3} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} />
      </Champ>
      <button className="bouton bouton--principal" disabled={envoi}>Enregistrer la réclamation</button>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

export function Reclamations() {
  const { peut } = useSession();
  const [toutes, setToutes] = useState(false);
  const [reclamations, setReclamations] = useState<Reclamation[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  const charger = useCallback(async () => {
    try {
      setReclamations((await api<{ reclamations: Reclamation[] }>(`/reclamations${toutes ? "?toutes=oui" : ""}`)).reclamations);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [toutes]);
  useEffect(() => {
    void charger();
  }, [charger]);

  const enRetard = reclamations?.filter((r) => r.accuseEnRetard || r.reponseEnRetard).length ?? 0;

  return (
    <>
      <h1>Réclamations</h1>
      <p>
        Engagements de l'agence : accusé de réception sous 2 jours ouvrés, réponse sous 10 jours ouvrés. À défaut d'accord, le client peut saisir
        SanlamAllianz, puis la Direction des Assurances.
      </p>
      <div className="onglets" role="group" aria-label="Réclamations affichées">
        <button type="button" className={`bouton bouton--petit${toutes ? "" : " bouton--principal"}`} aria-pressed={!toutes} onClick={() => setToutes(false)}>Ouvertes</button>
        <button type="button" className={`bouton bouton--petit${toutes ? " bouton--principal" : ""}`} aria-pressed={toutes} onClick={() => setToutes(true)}>Toutes</button>
        {peut("gerant", "auditeur") && <a className="bouton bouton--petit" href="/api/reclamations.csv" download>Exporter le registre (Excel)</a>}
      </div>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
      {enRetard > 0 && <Alerte type="info">{enRetard} réclamation(s) en retard sur les engagements.</Alerte>}
      {!reclamations ? (!erreur && <Chargement />) : reclamations.length === 0 ? <Vide>Aucune réclamation {toutes ? "" : "ouverte"}.</Vide> : <TableauReclamations reclamations={reclamations} />}
      {peut("gerant", "charge_clientele", "caissier", "commercial") && (
        <Section titre="Enregistrer une réclamation">
          <p className="note">Pour un client, enregistrez-la plutôt depuis sa fiche : elle y sera rattachée et il la suivra dans son espace.</p>
          <NouvelleReclamation apres={async (reference) => { setMessage(`Réclamation ${reference} enregistrée.`); await charger(); }} />
        </Section>
      )}
    </>
  );
}

/** Réclamations d'un client, sur sa fiche */
export function ReclamationsClient({ clientId, contrats }: { clientId: string; contrats: { id: string; numeroPolice: string | null; branche: string }[] }) {
  const { peut } = useSession();
  const [reclamations, setReclamations] = useState<Reclamation[] | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [message, setMessage] = useState("");

  const charger = useCallback(async () => {
    setReclamations((await api<{ reclamations: Reclamation[] }>(`/reclamations?clientId=${clientId}`)).reclamations);
  }, [clientId]);
  useEffect(() => {
    void charger().catch(() => setReclamations([]));
  }, [charger]);

  return (
    <Section
      titre="Réclamations"
      actions={peut("gerant", "charge_clientele", "caissier", "commercial") && (
        <button type="button" className="bouton bouton--petit" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>{ouvert ? "Fermer" : "Nouvelle réclamation"}</button>
      )}
    >
      <Alerte type="succes">{message}</Alerte>
      {ouvert && (
        <NouvelleReclamation clientId={clientId} contrats={contrats}
          apres={async (reference) => { setOuvert(false); setMessage(`Réclamation ${reference} enregistrée.`); await charger(); }} />
      )}
      {!reclamations ? <Chargement /> : reclamations.length === 0 ? <Vide>Aucune réclamation.</Vide> : <TableauReclamations reclamations={reclamations} />}
    </Section>
  );
}

export function FicheReclamation({ id }: { id: string }) {
  const { peut } = useSession();
  const traitement = peut("gerant", "charge_clientele");
  const [r, setR] = useState<Reclamation | null>(null);
  const [erreur, setErreur] = useState("");
  const [reponse, setReponse] = useState("");
  const [issue, setIssue] = useState("fondee");

  const charger = useCallback(async () => {
    try {
      setR((await api<{ reclamation: Reclamation }>(`/reclamations/${id}`)).reclamation);
    } catch (e) {
      setErreur(e instanceof ErreurApi && e.statut === 404 ? "Réclamation introuvable." : messageErreur(e));
    }
  }, [id]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function traiter(corps: Record<string, string>) {
    setErreur("");
    try {
      setR((await api<{ reclamation: Reclamation }>(`/reclamations/${id}/traitement`, { corps })).reclamation);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  if (!r) return erreur ? <><Alerte>{erreur}</Alerte><p><Lien href="/reclamations">Retour aux réclamations</Lien></p></> : <Chargement />;

  return (
    <>
      <p className="fil"><Lien href="/reclamations">Réclamations</Lien></p>
      <h1>Réclamation {r.reference}</h1>
      <p><Etat r={r} /></p>
      <Alerte>{erreur}</Alerte>
      <Section titre="La réclamation">
        <dl className="details">
          <div><dt>Réclamant</dt><dd>{r.clientId ? <Lien href={`/clients/${r.clientId}`}>{r.nom}</Lien> : r.nom}
            {r.telephone && <> · <a href={`tel:${r.telephone}`}>{telephone(r.telephone)}</a> · <a href={lienWhatsApp(r.telephone,
              `Bonjour ${r.nom}, ici DBS-ASSURANCES : nous avons bien reçu votre réclamation ${r.reference}. Nous vous répondons au plus tard le ${dateCourte(r.echeanceReponse)}.`)}
              target="_blank" rel="noopener noreferrer">Écrire sur WhatsApp</a></>}</dd></div>
          <div><dt>Reçue</dt><dd>{dateHeure(r.recueLe)} · {CANAUX[r.canal] ?? r.canal}{r.enregistrePar && ` · enregistrée par ${r.enregistrePar}`}</dd></div>
          <div><dt>Objet</dt><dd>{OBJETS_RECLAMATION[r.objet] ?? r.objet}{r.numeroPolice && ` · contrat ${r.numeroPolice}`}</dd></div>
          <div><dt>Ce que dit le client</dt><dd className="texte-libre">{r.description}</dd></div>
          <div><dt>Accusé de réception</dt><dd>{r.accuseLe ? dateHeure(r.accuseLe) : `attendu au plus tard le ${dateCourte(r.echeanceAccuse)}`}</dd></div>
          <div><dt>Réponse</dt><dd>{r.reponse ? <><span className="texte-libre">{r.reponse}</span><br /><small>le {dateHeure(r.repondueLe!)} · {ISSUES[r.issue!]}</small></>
            : `attendue au plus tard le ${dateCourte(r.echeanceReponse)}`}</dd></div>
          {r.escalade && <div><dt>Recours</dt><dd>auprès de {RECOURS[r.escalade]} le {dateHeure(r.escaladeLe!)}</dd></div>}
          {r.closeLe && <div><dt>Close</dt><dd>{dateHeure(r.closeLe)}</dd></div>}
        </dl>
      </Section>
      {traitement && r.statut !== "close" && (
        <Section titre="Traitement">
          <div className="actions">
            {!r.accuseLe && <button type="button" className="bouton" onClick={() => void traiter({ action: "accuser" })}>Accusé de réception envoyé</button>}
            {r.reponse && <button type="button" className="bouton" onClick={() => void traiter({ action: "clore" })}>Clore la réclamation</button>}
            {r.escalade !== "compagnie" && r.escalade !== "direction_assurances" && (
              <button type="button" className="bouton" onClick={() => void traiter({ action: "escalader", escalade: "compagnie" })}>Recours auprès de la compagnie</button>
            )}
            {r.escalade !== "direction_assurances" && (
              <button type="button" className="bouton" onClick={() => void traiter({ action: "escalader", escalade: "direction_assurances" })}>Recours auprès de la Direction des Assurances</button>
            )}
          </div>
          {!r.reponse && (
            <form className="formulaire" aria-label="Répondre au client" onSubmit={(e) => { e.preventDefault(); void traiter({ action: "repondre", reponse, issue }); }}>
              <Champ libelle="Réponse donnée au client" aide="Ce qui a été dit ou écrit au client ; il la lit dans son espace client.">
                <textarea required minLength={10} maxLength={4000} rows={4} value={reponse} onChange={(e) => setReponse(e.target.value)} />
              </Champ>
              <Champ libelle="Issue">
                <select value={issue} onChange={(e) => setIssue(e.target.value)}>{Object.entries(ISSUES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </Champ>
              <button className="bouton bouton--principal">Enregistrer la réponse</button>
            </form>
          )}
        </Section>
      )}
    </>
  );
}

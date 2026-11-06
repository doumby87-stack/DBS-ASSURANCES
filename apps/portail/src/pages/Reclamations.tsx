// Réclamations depuis l'espace client (tâche 12) : déposer une réclamation, suivre sa réponse. Engagements de
// l'agence : accusé de réception sous 2 jours ouvrés, réponse sous 10. À défaut d'accord, le client peut
// saisir SanlamAllianz, puis la Direction des Assurances.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, messageErreur } from "../api";
import { Alerte, Badge, Champ, Chargement } from "../composants";
import { dateCourte, dateHeure, TELEPHONE_AGENCE } from "../format";

const OBJETS: Record<string, string> = {
  contrat: "Mon contrat", prime_paiement: "Ma prime ou un paiement", sinistre: "Un sinistre", attestation: "Une attestation",
  accueil_service: "L'accueil ou le service", donnees_personnelles: "Mes données personnelles", autre: "Autre chose",
};
const STATUTS: Record<string, { libelle: string; ton: "vert" | "orange" | "bleu" | "gris" }> = {
  recue: { libelle: "Reçue", ton: "orange" }, en_cours: { libelle: "En cours de traitement", ton: "bleu" },
  repondue: { libelle: "Répondue", ton: "vert" }, close: { libelle: "Close", ton: "gris" },
};

interface Reclamation {
  id: string;
  reference: string;
  objet: string;
  description: string;
  statut: string;
  recueLe: string;
  echeanceReponse: string;
  reponse: string | null;
  repondueLe: string | null;
  numeroPolice: string | null;
}

export function Reclamations() {
  const [reclamations, setReclamations] = useState<Reclamation[] | null>(null);
  const [contrats, setContrats] = useState<{ id: string; numeroPolice: string | null }[]>([]);
  const [objet, setObjet] = useState("contrat");
  const [contratId, setContratId] = useState("");
  const [description, setDescription] = useState("");
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(async () => {
    try {
      setReclamations((await api<{ reclamations: Reclamation[] }>("/portail/reclamations")).reclamations);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
    api<{ contrats: { id: string; numeroPolice: string | null }[] }>("/portail/flotte").then((r) => setContrats(r.contrats)).catch(() => undefined);
  }, [charger]);

  async function deposer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setMessage("");
    setEnvoi(true);
    try {
      const { reclamation } = await api<{ reclamation: { reference: string } }>("/portail/reclamations", {
        corps: { objet, description: description.trim(), ...(contratId ? { contratId } : {}) },
      });
      setMessage(`Réclamation ${reclamation.reference} reçue : l'agence vous répond sous 10 jours ouvrés au plus.`);
      setDescription("");
      setContratId("");
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <>
      <h1>Réclamations</h1>
      <p>
        Un problème avec votre contrat, un paiement, un sinistre ou l'accueil ? Dites-le-nous : l'agence accuse réception sous 2 jours ouvrés et
        vous répond sous 10. Si la réponse ne vous satisfait pas, vous pouvez saisir SanlamAllianz, puis la Direction des Assurances.
      </p>
      <Alerte type="succes">{message}</Alerte>

      <form className="formulaire section" aria-label="Nouvelle réclamation" onSubmit={(e) => void deposer(e)}>
        <h2>Faire une réclamation</h2>
        <Champ libelle="Elle concerne">
          <select value={objet} onChange={(e) => setObjet(e.target.value)}>
            {Object.entries(OBJETS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Champ>
        {contrats.length > 0 && (
          <Champ libelle="Contrat (facultatif)">
            <select value={contratId} onChange={(e) => setContratId(e.target.value)}>
              <option value="">—</option>
              {contrats.map((k) => <option key={k.id} value={k.id}>{k.numeroPolice ?? "N° à venir"}</option>)}
            </select>
          </Champ>
        )}
        <Champ libelle="Votre réclamation" aide={`Ce qui s'est passé et ce que vous attendez de l'agence. Une urgence ? Appelez le ${TELEPHONE_AGENCE}.`}>
          <textarea required minLength={10} maxLength={4000} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Champ>
        <Alerte>{erreur}</Alerte>
        <button type="submit" className="bouton bouton--principal" disabled={envoi || description.trim().length < 10}>{envoi ? "Envoi…" : "Envoyer la réclamation"}</button>
      </form>

      <section className="section" aria-labelledby="titre-suivi">
        <h2 id="titre-suivi">Vos réclamations</h2>
        {!reclamations ? <Chargement /> : reclamations.length === 0 ? <p className="note">Aucune réclamation.</p> : (
          <ul className="historique">
            {reclamations.map((r) => {
              const s = STATUTS[r.statut] ?? STATUTS.recue!;
              return (
                <li key={r.id}>
                  <p><strong>{r.reference}</strong> · {OBJETS[r.objet] ?? r.objet}{r.numeroPolice && ` · contrat ${r.numeroPolice}`} <Badge ton={s.ton}>{s.libelle}</Badge></p>
                  <p className="note">Reçue le {dateHeure(r.recueLe)}{!r.reponse && ` · réponse au plus tard le ${dateCourte(r.echeanceReponse)}`}</p>
                  <p className="texte-libre">{r.description}</p>
                  {r.reponse && <p className="texte-libre"><strong>Réponse de l'agence{r.repondueLe && ` (${dateCourte(r.repondueLe)})`} :</strong> {r.reponse}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

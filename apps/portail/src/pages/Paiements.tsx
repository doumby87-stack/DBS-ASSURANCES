// Paiement d'une prime en ligne : le montant (le reste à payer, ou une partie), puis la page du prestataire de
// paiement (Wave, Orange Money, MTN MoMo, Moov Money), puis le retour ici, où le résultat s'affiche dès que le
// prestataire l'a confirmé à l'agence. Le code secret Mobile Money se saisit chez le prestataire, jamais ici.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ErreurApi, messageErreur } from "../api";
import { Alerte, Badge, Champ, Chargement, Ligne } from "../composants";
import { arrondiPaiement, dateHeure, montant, MOYENS_PAIEMENT, STATUTS_PAIEMENT, TELEPHONE_AGENCE } from "../format";
import { Lien } from "../routeur";

interface ContratPayable {
  id: string;
  numeroPolice: string | null;
  statut: string;
  resteAPayer: number;
  paiementEnCours: string | null;
}

interface Paiement {
  id: string;
  reference: string;
  montant: number;
  statut: string;
  moyen: string | null;
  creeLe: string;
  numeroPolice: string | null;
  resteAPayer?: number;
  statutContrat?: string;
}

const EN_ATTENTE = ["initie", "en_attente"];

function tonStatut(statut: string): "vert" | "orange" | "rouge" | "gris" {
  if (statut === "accepte") return "vert";
  if (EN_ATTENTE.includes(statut) || statut === "a_regulariser") return "orange";
  return statut === "refuse" ? "rouge" : "gris";
}

/** Choix du montant, puis départ vers la page du prestataire. */
export function Payer({ contratId }: { contratId: string }) {
  const [contrat, setContrat] = useState<ContratPayable | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [saisie, setSaisie] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    api<{ paiementEnLigne: boolean; contrats: ContratPayable[] }>("/portail/flotte")
      .then((r) => {
        setDisponible(r.paiementEnLigne);
        const trouve = r.contrats.find((k) => k.id === contratId);
        if (!trouve) setErreur("Ce contrat ne fait pas partie de vos contrats en cours.");
        else {
          setContrat(trouve);
          setSaisie(String(arrondiPaiement(Math.max(trouve.resteAPayer, 0))));
        }
      })
      .catch((e: unknown) => setErreur(messageErreur(e)));
  }, [contratId]);

  async function payer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const { paiement } = await api<{ paiement: { urlPaiement: string } }>("/portail/paiements", {
        corps: { contratId, montant: Number(saisie) },
      });
      // Page du prestataire (ou, en démonstration, la page de retour du portail)
      window.location.assign(paiement.urlPaiement);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  }

  if (!contrat) return erreur ? <><Alerte>{erreur}</Alerte><p><Lien href="/">Retour à l'accueil</Lien></p></> : <Chargement />;
  const total = arrondiPaiement(contrat.resteAPayer);
  const valeur = Number(saisie);
  const valide = Number.isInteger(valeur) && valeur % 5 === 0 && valeur >= Math.min(100, total) && valeur <= total;

  return (
    <>
      <p className="fil"><Lien href="/">Accueil</Lien></p>
      <h1>Payer la prime du contrat {contrat.numeroPolice ?? ""}</h1>
      {!disponible ? (
        <Alerte type="info">Le paiement en ligne n'est pas encore ouvert : réglez votre prime à l'agence, ou appelez-la au {TELEPHONE_AGENCE}.</Alerte>
      ) : contrat.resteAPayer <= 0 ? (
        <Alerte type="succes">Ce contrat est entièrement payé.</Alerte>
      ) : contrat.paiementEnCours ? (
        <Alerte type="info">
          Un paiement est déjà en cours pour ce contrat. <Lien href={`/paiements/${contrat.paiementEnCours}`}>Voir où il en est</Lien>.
        </Alerte>
      ) : (
        <form className="formulaire section" aria-label="Paiement en ligne" onSubmit={(e) => void payer(e)}>
          <p>Reste à payer : <strong>{montant(contrat.resteAPayer)}</strong>{total !== contrat.resteAPayer && ` (soit ${montant(total)}, arrondi au multiple de 5)`}.</p>
          <Champ libelle="Montant à payer (F CFA)" aide="Tout le reste, ou une partie (en multiple de 5). Le contrat est mis en vigueur une fois la prime entièrement payée.">
            <input inputMode="numeric" value={saisie} required onChange={(e) => setSaisie(e.target.value.replace(/\D/g, ""))} />
          </Champ>
          <p className="note">
            Vous allez être dirigé vers la page sécurisée de notre partenaire de paiement : choisissez Wave, Orange Money, MTN MoMo ou
            Moov Money et validez sur votre téléphone. Votre code secret ne se saisit jamais sur le site de l'agence.
          </p>
          <Alerte>{erreur}</Alerte>
          <button type="submit" className="bouton bouton--principal" disabled={envoi || !valide}>
            {envoi ? "Ouverture du paiement…" : `Payer ${valide ? montant(valeur) : ""}`}
          </button>
        </form>
      )}
    </>
  );
}

/** Retour du prestataire : le résultat, confirmé par l'agence auprès du prestataire. */
export function PagePaiement({ id }: { id: string }) {
  const [paiement, setPaiement] = useState<Paiement | null>(null);
  const [simulation, setSimulation] = useState(false);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const essais = useRef(0);

  const charger = useCallback(async () => {
    try {
      const r = await api<{ paiement: Paiement; simulation: boolean }>(`/portail/paiements/${id}`);
      setPaiement(r.paiement);
      setSimulation(r.simulation);
    } catch (e) {
      setErreur(e instanceof ErreurApi && e.statut === 404 ? "Ce paiement est introuvable." : messageErreur(e));
    }
  }, [id]);

  useEffect(() => {
    void charger();
  }, [charger]);

  // Tant que le prestataire n'a pas confirmé : nouvelle vérification toutes les 4 secondes, pendant 3 minutes
  useEffect(() => {
    if (!paiement || !EN_ATTENTE.includes(paiement.statut) || simulation || essais.current >= 45) return;
    const minuterie = window.setTimeout(() => {
      essais.current += 1;
      void charger();
    }, 4000);
    return () => window.clearTimeout(minuterie);
  }, [paiement, simulation, charger]);

  async function simuler(accepte: boolean, moyen?: string) {
    setEnvoi(true);
    setErreur("");
    try {
      const r = await api<{ paiement: Paiement }>(`/portail/paiements/${id}/simulation`, { corps: moyen ? { accepte, moyen } : { accepte } });
      setPaiement(r.paiement);
      setSimulation(false);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  if (!paiement) return erreur ? <><Alerte>{erreur}</Alerte><p><Lien href="/paiements">Vos paiements</Lien></p></> : <Chargement />;
  const enAttente = EN_ATTENTE.includes(paiement.statut);

  return (
    <>
      <p className="fil"><Lien href="/paiements">Vos paiements</Lien></p>
      <h1>Paiement de {montant(paiement.montant)}</h1>
      <dl className="fiche">
        <Ligne titre="Contrat">{paiement.numeroPolice ?? "—"}</Ligne>
        <Ligne titre="Référence">{paiement.reference}</Ligne>
        <Ligne titre="Commencé le">{dateHeure(paiement.creeLe)}</Ligne>
        <Ligne titre="Statut"><Badge ton={tonStatut(paiement.statut)}>{STATUTS_PAIEMENT[paiement.statut] ?? paiement.statut}</Badge></Ligne>
        {paiement.moyen && <Ligne titre="Moyen">{MOYENS_PAIEMENT[paiement.moyen] ?? paiement.moyen}</Ligne>}
      </dl>

      {paiement.statut === "accepte" && (
        <Alerte type="succes">
          Merci, votre paiement est enregistré.{" "}
          {paiement.statutContrat === "en_vigueur" && (paiement.resteAPayer ?? 0) <= 0
            ? "Votre contrat est payé et en vigueur : l'agence dépose votre attestation dans votre espace dès qu'elle est émise."
            : `Il reste ${montant(Math.max(paiement.resteAPayer ?? 0, 0))} à payer sur ce contrat.`}
        </Alerte>
      )}
      {enAttente && !simulation && (
        <Alerte type="info">
          {essais.current >= 45
            ? `Pas encore de confirmation du paiement. Si votre compte a été débité, ne payez pas une seconde fois : l'agence le vérifie (${TELEPHONE_AGENCE}).`
            : "Nous attendons la confirmation de votre paiement : validez-le sur votre téléphone si ce n'est pas encore fait. Cette page se met à jour toute seule."}
        </Alerte>
      )}
      {paiement.statut === "a_regulariser" && (
        <Alerte type="info">Votre paiement est bien reçu ; l'agence le vérifie et vous rappelle. Ne payez pas une seconde fois.</Alerte>
      )}
      {(paiement.statut === "refuse" || paiement.statut === "abandonne") && (
        <Alerte type="erreur">Le paiement n'a pas abouti et rien n'a été encaissé. Vous pouvez réessayer, ou payer à l'agence.</Alerte>
      )}

      {simulation && enAttente && (
        <section className="section simulation" aria-labelledby="titre-simulation">
          <h2 id="titre-simulation">Démonstration du paiement</h2>
          <p className="note">Mode démonstration : aucun argent n'est débité. En production, cette étape se passe chez le prestataire de paiement.</p>
          <div className="actions">
            {Object.entries(MOYENS_PAIEMENT).map(([code, libelle]) => (
              <button key={code} type="button" className="bouton bouton--principal" disabled={envoi} onClick={() => void simuler(true, code)}>
                Payer avec {libelle}
              </button>
            ))}
            <button type="button" className="bouton" disabled={envoi} onClick={() => void simuler(false)}>Refuser le paiement</button>
          </div>
        </section>
      )}
      <Alerte>{erreur}</Alerte>
      <p className="actions">
        <Lien href="/" className="bouton">Retour à l'accueil</Lien>
        {(paiement.statut === "refuse" || paiement.statut === "abandonne") && paiement.numeroPolice && (
          <Lien href="/" className="bouton bouton--principal">Réessayer depuis vos contrats</Lien>
        )}
      </p>
    </>
  );
}

/** Historique des paiements en ligne du client. */
export function HistoriquePaiements() {
  const [paiements, setPaiements] = useState<Paiement[] | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api<{ paiements: Paiement[] }>("/portail/paiements").then((r) => setPaiements(r.paiements)).catch((e: unknown) => setErreur(messageErreur(e)));
  }, []);

  return (
    <>
      <h1>Vos paiements en ligne</h1>
      <p>Pour payer une prime, choisissez « Payer en ligne » sur le contrat, depuis l'accueil. Les paiements faits à l'agence figurent sur vos reçus.</p>
      <Alerte>{erreur}</Alerte>
      {!paiements ? (!erreur && <Chargement />) : paiements.length === 0 ? <p className="note">Aucun paiement en ligne pour l'instant.</p> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Date</th><th>Contrat</th><th>Montant</th><th>Moyen</th><th>Statut</th></tr></thead>
            <tbody>
              {paiements.map((p) => (
                <tr key={p.id}>
                  <td><Lien href={`/paiements/${p.id}`}>{dateHeure(p.creeLe)}</Lien><span className="note"><br />{p.reference}</span></td>
                  <td>{p.numeroPolice ?? "—"}</td>
                  <td>{montant(p.montant)}</td>
                  <td>{p.moyen ? MOYENS_PAIEMENT[p.moyen] ?? p.moyen : "—"}</td>
                  <td><Badge ton={tonStatut(p.statut)}>{STATUTS_PAIEMENT[p.statut] ?? p.statut}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

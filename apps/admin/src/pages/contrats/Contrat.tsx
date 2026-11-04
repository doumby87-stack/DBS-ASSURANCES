// Contrat et paiements : ce qui reste à payer, encaissement au guichet (le reçu s'ouvre aussitôt),
// historique des reçus, contre-passation par le gérant, prime nette pour le calcul des commissions.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Chargement, Section, Vide } from "../../composants/communs";
import { Lien, naviguer } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import {
  AIDE_REFERENCE, BRANCHES, dateCourte, dateHeure, montant, MODES_PAIEMENT, STATUTS_CONTRAT,
} from "../../services/format";
import { useSession } from "../../session";

export interface SoldeContrat {
  id: string;
  clientId: string;
  clientNom: string;
  numeroPolice: string | null;
  branche: string;
  statut: string;
  dateEffet: string;
  dateEcheance: string;
  primeTtc: number;
  primeNette: number | null;
  /** Avenants de flotte : primes ajoutées, ristournes retranchées */
  primesAvenants: number;
  primeDue: number;
  aRembourser: number;
  encaisse: number;
  especes: number;
  plafondEspeces: number;
  resteAPayer: number;
  especesPossibles: number;
}

export interface Encaissement {
  id: string;
  numeroRecu: number;
  montant: number;
  mode: string;
  reference: string | null;
  motif: string | null;
  encaisseLe: string;
  encaissePar: string;
  annuleEncaissementId: string | null;
  contrePasse: boolean;
}

export function Contrat({ id }: { id: string }) {
  const { peut } = useSession();
  const [donnees, setDonnees] = useState<{ contrat: SoldeContrat; encaissements: Encaissement[] } | null>(null);
  const [erreur, setErreur] = useState("");
  const [introuvable, setIntrouvable] = useState(false);

  const charger = useCallback(async () => {
    try {
      setDonnees(await api(`/contrats/${id}/paiements`));
    } catch (e) {
      if (e instanceof ErreurApi && (e.statut === 404 || e.statut === 400)) setIntrouvable(true);
      else setErreur(messageErreur(e));
    }
  }, [id]);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (introuvable) return <><h1>Contrat introuvable</h1><p><Lien href="/clients">Retour aux clients</Lien></p></>;
  if (!donnees) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const { contrat, encaissements } = donnees;

  return (
    <>
      <p className="fil">
        <Lien href="/clients">Clients</Lien> › <Lien href={`/clients/${contrat.clientId}`}>{contrat.clientNom}</Lien> › Contrat
      </p>
      <h1>{BRANCHES[contrat.branche]} · {contrat.numeroPolice ?? "n° de police à saisir"}</h1>
      <dl className="identite">
        <div><dt>Statut</dt><dd><Badge ton={contrat.statut === "en_vigueur" ? "vert" : "orange"}>{STATUTS_CONTRAT[contrat.statut]}</Badge></dd></div>
        <div><dt>Période</dt><dd>{dateCourte(contrat.dateEffet)} → {dateCourte(contrat.dateEcheance)}</dd></div>
        <div><dt>Prime TTC</dt><dd>{montant(contrat.primeTtc)}</dd></div>
        {contrat.primesAvenants !== 0 && (
          <div><dt>Avenants de flotte</dt><dd>{contrat.primesAvenants > 0 ? "+ " : "− "}{montant(Math.abs(contrat.primesAvenants))}</dd></div>
        )}
        <div><dt>Encaissé</dt><dd>{montant(contrat.encaisse)}</dd></div>
        <div><dt>Reste à payer</dt><dd>{montant(contrat.resteAPayer)}</dd></div>
        <div><dt>Encore possible en espèces</dt><dd>{montant(contrat.especesPossibles)}</dd></div>
      </dl>
      <Alerte>{erreur}</Alerte>

      {peut("gerant", "caissier") && contrat.resteAPayer > 0 && <Encaisser contrat={contrat} />}
      {contrat.resteAPayer === 0 && contrat.aRembourser === 0 && (
        <Alerte type="succes">
          {contrat.primesAvenants === 0 ? "Prime entièrement payée : le contrat est en vigueur." : "Prime et avenants entièrement payés."}
        </Alerte>
      )}
      {contrat.aRembourser > 0 && (
        <Alerte type="info">Ristourne d'avenant : {montant(contrat.aRembourser)} payés en trop, à rembourser au client ou à déduire de sa prochaine prime.</Alerte>
      )}
      {contrat.resteAPayer > 0 && contrat.statut === "en_vigueur" && contrat.primesAvenants > 0 && (
        <Alerte type="info">Prime de départ payée ; {montant(contrat.resteAPayer)} d'avenant restent à encaisser.</Alerte>
      )}

      <Section titre="Reçus">
        {encaissements.length === 0 ? <Vide>Aucun paiement enregistré.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Reçu</th><th>Date</th><th>Mode</th><th>Montant</th><th>Encaissé par</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {encaissements.map((e) => (
                  <LigneEncaissement key={e.id} encaissement={e} peutAnnuler={peut("gerant")} apres={charger} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {peut("gerant", "charge_clientele") && <PrimeNette contrat={contrat} apres={charger} />}
    </>
  );
}

function Encaisser({ contrat }: { contrat: SoldeContrat }) {
  const [saisie, setSaisie] = useState({ montant: String(contrat.resteAPayer), mode: contrat.especesPossibles > 0 ? "especes" : "mobile_money", reference: "" });
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const { encaissement } = await api<{ encaissement: Encaissement }>("/encaissements", {
        corps: {
          contratId: contrat.id, montant: Number(saisie.montant), mode: saisie.mode,
          ...(saisie.reference.trim() ? { reference: saisie.reference.trim() } : {}),
        },
      });
      naviguer(`/recus/${encaissement.id}`);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  }

  return (
    <Section titre="Encaisser">
      <form className="formulaire formulaire--grille" onSubmit={soumettre}>
        <Champ libelle="Montant (F CFA)" aide={`Reste à payer : ${montant(contrat.resteAPayer)}`}>
          <input type="number" required min={1} max={contrat.resteAPayer} step={1} inputMode="numeric"
                 value={saisie.montant} onChange={(e) => setSaisie({ ...saisie, montant: e.target.value })} />
        </Champ>
        <Champ libelle="Mode de paiement" aide={saisie.mode === "especes" ? `Plafond : ${montant(contrat.plafondEspeces)} par police` : undefined}>
          <select value={saisie.mode} onChange={(e) => setSaisie({ ...saisie, mode: e.target.value })}>
            {Object.entries(MODES_PAIEMENT).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
          </select>
        </Champ>
        <Champ libelle="Référence" aide={AIDE_REFERENCE[saisie.mode]}>
          <input maxLength={60} required={saisie.mode !== "especes"} value={saisie.reference}
                 onChange={(e) => setSaisie({ ...saisie, reference: e.target.value })} />
        </Champ>
        <div className="formulaire__actions"><button className="bouton bouton--principal" disabled={envoi}>Encaisser et imprimer le reçu</button></div>
        <Alerte>{erreur}</Alerte>
      </form>
    </Section>
  );
}

function LigneEncaissement({ encaissement: e, peutAnnuler, apres }: { encaissement: Encaissement; peutAnnuler: boolean; apres: () => Promise<void> }) {
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState("");

  async function contrePasser(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    try {
      await api(`/encaissements/${e.id}/contre-passation`, { corps: { motif } });
      setOuvert(false);
      await apres();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  }

  return (
    <tr>
      <td><Lien href={`/recus/${e.id}`}>N° {e.numeroRecu}</Lien></td>
      <td>{dateHeure(e.encaisseLe)}</td>
      <td>{MODES_PAIEMENT[e.mode]}{e.reference && <><br /><small>{e.reference}</small></>}</td>
      <td className="nombre">{montant(e.montant)}</td>
      <td>
        {e.encaissePar}
        {e.annuleEncaissementId && <><br /><Badge ton="gris">Contre-passation</Badge> <small>{e.motif}</small></>}
        {e.contrePasse && <><br /><Badge ton="rouge">Annulé</Badge></>}
      </td>
      <td>
        {peutAnnuler && e.montant > 0 && !e.contrePasse && (
          ouvert ? (
            <form className="formulaire" onSubmit={contrePasser}>
              <Champ libelle="Motif de l'annulation">
                <input required minLength={5} maxLength={300} value={motif} onChange={(ev) => setMotif(ev.target.value)} />
              </Champ>
              <div className="formulaire__actions">
                <button className="bouton bouton--petit bouton--danger">Contre-passer</button>
                <button type="button" className="bouton bouton--petit" onClick={() => setOuvert(false)}>Fermer</button>
              </div>
              <Alerte>{erreur}</Alerte>
            </form>
          ) : (
            <button type="button" className="bouton bouton--petit" onClick={() => setOuvert(true)}>Annuler ce reçu</button>
          )
        )}
      </td>
    </tr>
  );
}

function PrimeNette({ contrat, apres }: { contrat: SoldeContrat; apres: () => Promise<void> }) {
  const [valeur, setValeur] = useState(contrat.primeNette ? String(contrat.primeNette) : "");
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setMessage("");
    try {
      await api(`/contrats/${contrat.id}`, { methode: "PATCH", corps: { primeNette: Number(valeur) } });
      setMessage("Prime nette enregistrée.");
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <Section titre="Prime nette">
      <form className="formulaire formulaire--ligne" onSubmit={soumettre}>
        <Champ libelle="Prime nette, hors taxes et accessoires (F CFA)" aide="Sert à calculer la commission attendue">
          <input type="number" required min={1} max={contrat.primeTtc} step={1} inputMode="numeric" value={valeur} onChange={(e) => setValeur(e.target.value)} />
        </Champ>
        <button className="bouton">Enregistrer</button>
      </form>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
    </Section>
  );
}

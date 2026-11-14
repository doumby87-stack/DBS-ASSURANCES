// Paiement en plusieurs fois d'un contrat flotte : l'échéancier et son état, et sa définition par l'agence.
// Les règles (total égal à la prime, dates, renégociation par le gérant seul) sont vérifiées par la base.

import { useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Section, Vide } from "../../composants/communs";
import { api, messageErreur } from "../../services/api";
import { dateCourte, montant } from "../../services/format";

export interface EcheancePaiement {
  id: string;
  rang: number;
  exigibleLe: string;
  montant: number;
  paye: number;
  reste: number;
  etat: "payee" | "en_retard" | "bientot" | "a_venir";
  jours: number;
}

export interface Echeancier {
  echeances: EcheancePaiement[];
  aPayerMaintenant: number | null;
  prochaine: EcheancePaiement | null;
}

const ETATS: Record<EcheancePaiement["etat"], { libelle: string; ton: "vert" | "rouge" | "orange" | "gris" }> = {
  payee: { libelle: "Payée", ton: "vert" },
  en_retard: { libelle: "En retard", ton: "rouge" },
  bientot: { libelle: "À payer bientôt", ton: "orange" },
  a_venir: { libelle: "À venir", ton: "gris" },
};

/** « 2026-11-14 » + 3 mois → « 2027-02-14 » (fin de mois ramenée au dernier jour : 31/01 + 1 mois → 28/02). */
export function ajouterMois(iso: string, mois: number): string {
  const [annee, m, jour] = iso.split("-").map(Number) as [number, number, number];
  const cible = new Date(Date.UTC(annee, m - 1 + mois, 1));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jour, dernierJour));
  return cible.toISOString().slice(0, 10);
}

/** Parts égales, en multiples de 5 F CFA ; le reste de la division s'ajoute à la première échéance. */
export function proposerEcheances(prime: number, dateEffet: string, nombre: number): { exigibleLe: string; montant: string }[] {
  const part = Math.floor(prime / nombre / 5) * 5;
  const pas = Math.floor(12 / nombre);
  return Array.from({ length: nombre }, (_v, i) => ({
    exigibleLe: ajouterMois(dateEffet, i * pas),
    montant: String(i === 0 ? prime - part * (nombre - 1) : part),
  }));
}

interface Props {
  contrat: { id: string; branche: string; statut: string; primeTtc: number; dateEffet: string; dateEcheance: string; encaisse: number };
  echeancier: Echeancier;
  /** Le gérant, ou le chargé de clientèle tant que rien n'est encaissé */
  modifiable: boolean;
  apres: () => Promise<void>;
}

export function SectionEcheancier({ contrat, echeancier, modifiable, apres }: Props) {
  const [edition, setEdition] = useState(false);
  const fractionne = echeancier.echeances.length > 0;
  if (contrat.branche !== "flotte" || (!fractionne && !modifiable)) return null;

  return (
    <Section
      titre="Paiement en plusieurs fois"
      actions={modifiable && !edition && (
        <button type="button" className="bouton bouton--petit" onClick={() => setEdition(true)}>
          {fractionne ? "Modifier l'échéancier" : "Découper la prime"}
        </button>
      )}
    >
      {fractionne ? (
        <>
          <p>
            {echeancier.aPayerMaintenant ? <>À payer maintenant : <strong>{montant(echeancier.aPayerMaintenant)}</strong>. </> : null}
            {echeancier.prochaine && echeancier.prochaine.jours > 0 && (
              <>Prochaine échéance : {montant(echeancier.prochaine.reste)} le {dateCourte(echeancier.prochaine.exigibleLe)}.</>
            )}
          </p>
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Échéance</th><th>Date</th><th>Montant</th><th>Payé</th><th>État</th></tr></thead>
              <tbody>
                {echeancier.echeances.map((e) => (
                  <tr key={e.id}>
                    <td>{e.rang} / {echeancier.echeances.length}</td>
                    <td>{dateCourte(e.exigibleLe)}</td>
                    <td className="nombre">{montant(e.montant)}</td>
                    <td className="nombre">{montant(e.paye)}</td>
                    <td>
                      <Badge ton={ETATS[e.etat].ton}>{ETATS[e.etat].libelle}</Badge>
                      {e.etat === "en_retard" && <> <small>depuis {-e.jours} j</small></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Le contrat est entré en vigueur au paiement de la première échéance (Code CIMA, art. 13). Une échéance en retard ne suspend
            pas le contrat d'elle-même : la suspension suit une mise en demeure. Le client est relancé 7 jours avant chaque échéance,
            puis une fois en cas de retard.
          </p>
        </>
      ) : (
        !edition && <Vide>Prime payable en une fois. Pour une entreprise qui paie sa flotte en plusieurs fois, découpez la prime.</Vide>
      )}
      {edition && <FormulaireEcheancier contrat={contrat} echeancier={echeancier} fermer={() => setEdition(false)} apres={apres} />}
    </Section>
  );
}

function FormulaireEcheancier({ contrat, echeancier, fermer, apres }: Omit<Props, "modifiable"> & { fermer: () => void }) {
  const [lignes, setLignes] = useState(
    echeancier.echeances.length > 0
      ? echeancier.echeances.map((e) => ({ exigibleLe: e.exigibleLe, montant: String(e.montant) }))
      : proposerEcheances(contrat.primeTtc, contrat.dateEffet, 4),
  );
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const total = lignes.reduce((somme, l) => somme + (Number(l.montant) || 0), 0);
  const ecart = total - contrat.primeTtc;

  async function enregistrer(echeances: { exigibleLe: string; montant: number }[]) {
    setErreur("");
    setEnvoi(true);
    try {
      await api(`/contrats/${contrat.id}/echeancier`, { corps: { echeances } });
      fermer();
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    void enregistrer(lignes.map((l) => ({ exigibleLe: l.exigibleLe, montant: Number(l.montant) })));
  }

  const modifier = (index: number, champ: "exigibleLe" | "montant", valeur: string) =>
    setLignes(lignes.map((l, i) => (i === index ? { ...l, [champ]: valeur } : l)));

  return (
    <form className="formulaire" onSubmit={soumettre} aria-label="Échéancier de paiement">
      <div className="formulaire--ligne">
        <span>Découper en</span>
        {[2, 3, 4, 6, 12].map((nombre) => (
          <button key={nombre} type="button" className="bouton bouton--petit"
                  onClick={() => setLignes(proposerEcheances(contrat.primeTtc, contrat.dateEffet, nombre))}>
            {nombre} fois
          </button>
        ))}
      </div>
      <div className="tableau-defilant">
        <table className="tableau">
          <thead><tr><th>Échéance</th><th>Date</th><th>Montant (F CFA)</th></tr></thead>
          <tbody>
            {lignes.map((ligne, index) => (
              <tr key={index}>
                <td>{index + 1} / {lignes.length}</td>
                <td>
                  <input type="date" required aria-label={`Date de l'échéance ${index + 1}`} value={ligne.exigibleLe}
                         max={index === 0 ? contrat.dateEffet : undefined} onChange={(e) => modifier(index, "exigibleLe", e.target.value)} />
                </td>
                <td>
                  <input type="number" required min={1} step={1} inputMode="numeric" aria-label={`Montant de l'échéance ${index + 1}`}
                         value={ligne.montant} onChange={(e) => modifier(index, "montant", e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Total : <strong>{montant(total)}</strong> pour une prime de {montant(contrat.primeTtc)}
        {ecart !== 0 && <> · <Badge ton="rouge">{ecart > 0 ? "+ " : "− "}{montant(Math.abs(ecart))}</Badge></>}
      </p>
      <p className="note">
        La première échéance se paie au plus tard à la date d'effet ({dateCourte(contrat.dateEffet)}) : la garantie ne court qu'après son
        paiement. Toutes les échéances tombent avant la fin du contrat ({dateCourte(contrat.dateEcheance)}).
      </p>
      <div className="formulaire__actions">
        <button className="bouton bouton--principal" disabled={envoi || ecart !== 0}>Enregistrer l'échéancier</button>
        <button type="button" className="bouton" onClick={fermer}>Annuler</button>
        {echeancier.echeances.length > 0 && contrat.encaisse === 0 && (
          <button type="button" className="bouton" disabled={envoi} onClick={() => void enregistrer([])}>Revenir au paiement en une fois</button>
        )}
      </div>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

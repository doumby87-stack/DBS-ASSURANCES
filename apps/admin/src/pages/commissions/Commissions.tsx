// Commissions : rapprochement mensuel entre la commission attendue (calculée sur les primes encaissées)
// et le relevé envoyé par SanlamAllianz ; taux par branche ; contrats dont la prime nette manque.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Chargement, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, messageErreur } from "../../services/api";
import { aujourdHui, BRANCHES, dateCourte, montant, moisEnLettres } from "../../services/format";
import { useSession } from "../../session";

interface Taux {
  id: string;
  branche: string;
  taux: number;
  applicableDu: string;
  creePar: string;
  enVigueur: boolean;
}

interface Mois {
  mois: string;
  primesEncaissees: number;
  commissionAttendue: number;
  encaissementsIncomplets: number;
  montantDeclare: number | null;
  reference: string | null;
  ecart: number | null;
}

interface ContratIncomplet {
  id: string;
  numeroPolice: string | null;
  branche: string;
  primeTtc: number;
  clientId: string;
  clientNom: string;
}

interface Donnees {
  taux: Taux[];
  rapprochement: Mois[];
  contratsSansPrimeNette: ContratIncomplet[];
}

const pourcent = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Commissions() {
  const { peut } = useSession();
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(async () => {
    try {
      setDonnees(await api<Donnees>("/commissions"));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (!donnees) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const gerant = peut("gerant");

  return (
    <>
      <h1>Commissions</h1>
      <p className="note">
        Commission attendue = prime encaissée × (prime nette ÷ prime TTC) × taux de la branche à la date de l'encaissement.
        Comparez-la au relevé de SanlamAllianz chaque mois (Code CIMA, art. 559 : compte courant mensuel).
      </p>

      <Section titre="Rapprochement mensuel" actions={gerant && <SaisieReleve apres={charger} />}>
        {donnees.rapprochement.length === 0 ? <Vide>Aucun encaissement ni relevé pour l'instant.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Mois</th><th>Primes encaissées</th><th>Commission attendue</th><th>Relevé de la compagnie</th><th>Écart</th></tr></thead>
              <tbody>
                {donnees.rapprochement.map((m) => (
                  <tr key={m.mois}>
                    <td>{moisEnLettres(m.mois)}</td>
                    <td className="nombre">{montant(m.primesEncaissees)}</td>
                    <td className="nombre">
                      {montant(m.commissionAttendue)}
                      {m.encaissementsIncomplets > 0 && <><br /><Badge ton="orange">{m.encaissementsIncomplets} sans prime nette ou sans taux</Badge></>}
                    </td>
                    <td className="nombre">{m.montantDeclare === null ? "—" : montant(m.montantDeclare)}{m.reference && <><br /><small>{m.reference}</small></>}</td>
                    <td className="nombre">
                      {m.ecart === null ? <Badge ton="gris">Relevé à saisir</Badge>
                        : m.ecart === 0 ? <Badge ton="vert">Aucun</Badge>
                          : <Badge ton={m.ecart < 0 ? "rouge" : "bleu"}>{montant(m.ecart)}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Un écart négatif : la compagnie a versé moins que prévu. À réclamer avec le détail des polices.</p>
      </Section>

      <Section titre="Taux de commission" actions={gerant && <SaisieTaux apres={charger} />}>
        {donnees.taux.length === 0 ? <Vide>Aucun taux saisi : indiquez ceux de votre traité avec SanlamAllianz.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Branche</th><th>Taux</th><th>Applicable depuis le</th><th>Saisi par</th></tr></thead>
              <tbody>
                {donnees.taux.map((t) => (
                  <tr key={t.id}>
                    <td>{BRANCHES[t.branche]}</td>
                    <td className="nombre">{pourcent.format(t.taux)} %</td>
                    <td>{dateCourte(t.applicableDu)} {t.enVigueur && <Badge ton="vert">En vigueur</Badge>}</td>
                    <td>{t.creePar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section titre="Contrats payés sans prime nette">
        {donnees.contratsSansPrimeNette.length === 0 ? <Vide>Tous les contrats payés ont leur prime nette.</Vide> : (
          <>
            <p className="note">Sans prime nette, la commission de ces contrats n'est pas calculée. Elle figure sur la quittance de la compagnie.</p>
            <ul className="liste-simple">
              {donnees.contratsSansPrimeNette.map((c) => (
                <li key={c.id}>
                  <Lien href={`/contrats/${c.id}`}>{c.clientNom} · {BRANCHES[c.branche]} · {c.numeroPolice ?? "police à saisir"}</Lien> ({montant(c.primeTtc)})
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </>
  );
}

function SaisieReleve({ apres }: { apres: () => Promise<void> }) {
  const [r, setR] = useState({ mois: aujourdHui().slice(0, 7), montantDeclare: "", reference: "" });
  const [erreur, setErreur] = useState("");
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    try {
      await api("/commissions/releves", {
        corps: { mois: r.mois, montantDeclare: Number(r.montantDeclare), ...(r.reference.trim() ? { reference: r.reference.trim() } : {}) },
      });
      setR({ ...r, montantDeclare: "", reference: "" });
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }
  return (
    <form className="formulaire formulaire--ligne" onSubmit={soumettre}>
      <Champ libelle="Mois du relevé"><input type="month" required max={aujourdHui().slice(0, 7)} value={r.mois} onChange={(e) => setR({ ...r, mois: e.target.value })} /></Champ>
      <Champ libelle="Commission déclarée (F CFA)"><input type="number" required min={0} step={1} inputMode="numeric" value={r.montantDeclare} onChange={(e) => setR({ ...r, montantDeclare: e.target.value })} /></Champ>
      <Champ libelle="Référence du relevé"><input maxLength={80} value={r.reference} onChange={(e) => setR({ ...r, reference: e.target.value })} /></Champ>
      <button className="bouton">Enregistrer le relevé</button>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

function SaisieTaux({ apres }: { apres: () => Promise<void> }) {
  const [t, setT] = useState({ branche: "automobile", taux: "", applicableDu: aujourdHui() });
  const [erreur, setErreur] = useState("");
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    try {
      await api("/commissions/taux", { corps: { branche: t.branche, taux: Number(t.taux.replace(",", ".")), applicableDu: t.applicableDu } });
      setT({ ...t, taux: "" });
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }
  return (
    <form className="formulaire formulaire--ligne" onSubmit={soumettre}>
      <Champ libelle="Branche">
        <select value={t.branche} onChange={(e) => setT({ ...t, branche: e.target.value })}>
          {Object.entries(BRANCHES).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
        </select>
      </Champ>
      <Champ libelle="Taux (%)"><input required inputMode="decimal" pattern="[0-9]{1,2}([.,][0-9]{1,2})?" value={t.taux} onChange={(e) => setT({ ...t, taux: e.target.value })} /></Champ>
      <Champ libelle="Applicable à partir du"><input type="date" required value={t.applicableDu} onChange={(e) => setT({ ...t, applicableDu: e.target.value })} /></Champ>
      <button className="bouton">Ajouter le taux</button>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

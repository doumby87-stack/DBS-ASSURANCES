// Commissions : rapprochement mensuel entre la commission attendue (calculée sur les primes encaissées)
// et le relevé envoyé par SanlamAllianz ; facture FNE de l'agence pour chaque mois ; taux par branche ;
// contrats dont la prime nette manque.

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
  numeroFne: string | null;
  montantFne: number | null;
}

interface FactureFne {
  id: string;
  numeroFne: string;
  emiseLe: string;
  objet: "commissions" | "frais" | "autre";
  mois: string | null;
  destinataire: string;
  montantTtc: number;
  commentaire: string | null;
  saisiePar: string;
  annuleeLe: string | null;
  motifAnnulation: string | null;
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
              <thead><tr><th>Mois</th><th>Primes encaissées</th><th>Commission attendue</th><th>Relevé de la compagnie</th><th>Écart</th><th>Facture FNE</th></tr></thead>
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
                    <td>
                      {m.numeroFne ? <>{m.numeroFne}<br /><small>{montant(m.montantFne)}</small></>
                        : m.montantDeclare !== null ? <Badge ton="orange">À émettre</Badge> : <span className="note">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Un écart négatif : la compagnie a versé moins que prévu. À réclamer avec le détail des polices.</p>
      </Section>

      <FacturesFne gerant={gerant} apres={charger} />

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

/** Factures FNE de l'agence : émises sur la plateforme de la DGI, leur numéro est saisi ici (docs/conformite/facturation-fne.md). */
function FacturesFne({ gerant, apres }: { gerant: boolean; apres: () => Promise<void> }) {
  const [factures, setFactures] = useState<FactureFne[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [saisie, setSaisie] = useState({
    numeroFne: "", emiseLe: aujourdHui(), objet: "commissions" as FactureFne["objet"], mois: aujourdHui().slice(0, 7),
    destinataire: "SanlamAllianz Côte d'Ivoire", montantTtc: "", commentaire: "",
  });
  const [annulation, setAnnulation] = useState<{ id: string; motif: string } | null>(null);

  const charger = useCallback(async () => {
    try {
      setFactures((await api<{ factures: FactureFne[] }>("/factures-fne")).factures);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function enregistrer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setMessage("");
    try {
      await api("/factures-fne", {
        corps: {
          numeroFne: saisie.numeroFne.trim(), emiseLe: saisie.emiseLe, objet: saisie.objet, destinataire: saisie.destinataire,
          montantTtc: Number(saisie.montantTtc), ...(saisie.objet === "commissions" ? { mois: saisie.mois } : {}),
          ...(saisie.commentaire.trim() ? { commentaire: saisie.commentaire.trim() } : {}),
        },
      });
      setMessage(`Facture ${saisie.numeroFne.trim()} enregistrée.`);
      setSaisie({ ...saisie, numeroFne: "", montantTtc: "", commentaire: "" });
      await Promise.all([charger(), apres()]);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  async function annuler(evenement: FormEvent) {
    evenement.preventDefault();
    if (!annulation) return;
    setErreur("");
    try {
      await api(`/factures-fne/${annulation.id}/annulation`, { corps: { motif: annulation.motif } });
      setAnnulation(null);
      setMessage("Facture annulée. Saisissez la facture corrigée si besoin.");
      await Promise.all([charger(), apres()]);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <Section titre="Factures FNE de l'agence">
      <p className="note">
        Émettez la facture sur la plateforme FNE de la DGI, puis notez ici son numéro : une facture par mois de commissions. Une facture
        erronée s'annule (avoir FNE), avec son motif ; elle ne se modifie pas.
      </p>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
      {!factures ? <Chargement /> : factures.length === 0 ? <Vide>Aucune facture FNE saisie.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>N° FNE</th><th>Émise le</th><th>Objet</th><th>Destinataire</th><th className="nombre">Montant TTC</th><th>État</th></tr></thead>
            <tbody>
              {factures.map((f) => (
                <tr key={f.id}>
                  <td>{f.numeroFne}<br /><small>saisie par {f.saisiePar}</small></td>
                  <td>{dateCourte(f.emiseLe)}</td>
                  <td>{f.objet === "commissions" && f.mois ? `Commissions de ${moisEnLettres(f.mois)}` : f.objet === "frais" ? "Frais" : "Autre"}{f.commentaire && <><br /><small>{f.commentaire}</small></>}</td>
                  <td>{f.destinataire}</td>
                  <td className="nombre">{montant(f.montantTtc)}</td>
                  <td>
                    {f.annuleeLe ? <><Badge ton="gris">Annulée</Badge><br /><small>{f.motifAnnulation}</small></> : <Badge ton="vert">Valide</Badge>}
                    {gerant && !f.annuleeLe && (annulation?.id === f.id ? (
                      <form className="formulaire" aria-label={`Annuler la facture ${f.numeroFne}`} onSubmit={(e) => void annuler(e)}>
                        <Champ libelle="Motif de l'annulation">
                          <input required minLength={5} maxLength={300} value={annulation.motif} onChange={(e) => setAnnulation({ id: f.id, motif: e.target.value })} />
                        </Champ>
                        <div className="formulaire__actions">
                          <button className="bouton bouton--petit bouton--danger">Annuler la facture</button>
                          <button type="button" className="bouton bouton--petit" onClick={() => setAnnulation(null)}>Fermer</button>
                        </div>
                      </form>
                    ) : (
                      <><br /><button type="button" className="bouton bouton--petit" onClick={() => setAnnulation({ id: f.id, motif: "" })}>Annuler…</button></>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gerant && (
        <form className="formulaire formulaire--grille" aria-label="Nouvelle facture FNE" onSubmit={(e) => void enregistrer(e)}>
          <Champ libelle="N° de la facture FNE">
            <input required pattern="[A-Za-z0-9][A-Za-z0-9/._-]{2,59}" value={saisie.numeroFne} onChange={(e) => setSaisie({ ...saisie, numeroFne: e.target.value })} />
          </Champ>
          <Champ libelle="Émise le">
            <input type="date" required max={aujourdHui()} value={saisie.emiseLe} onChange={(e) => setSaisie({ ...saisie, emiseLe: e.target.value })} />
          </Champ>
          <Champ libelle="Objet">
            <select value={saisie.objet} onChange={(e) => setSaisie({ ...saisie, objet: e.target.value as FactureFne["objet"] })}>
              <option value="commissions">Commissions du mois</option>
              <option value="frais">Frais</option>
              <option value="autre">Autre</option>
            </select>
          </Champ>
          {saisie.objet === "commissions" && (
            <Champ libelle="Mois des commissions">
              <input type="month" required max={aujourdHui().slice(0, 7)} value={saisie.mois} onChange={(e) => setSaisie({ ...saisie, mois: e.target.value })} />
            </Champ>
          )}
          <Champ libelle="Destinataire">
            <input required minLength={2} maxLength={160} value={saisie.destinataire} onChange={(e) => setSaisie({ ...saisie, destinataire: e.target.value })} />
          </Champ>
          <Champ libelle="Montant TTC (F CFA)">
            <input type="number" required min={1} step={1} inputMode="numeric" value={saisie.montantTtc} onChange={(e) => setSaisie({ ...saisie, montantTtc: e.target.value })} />
          </Champ>
          <Champ libelle="Commentaire (facultatif)">
            <input maxLength={500} value={saisie.commentaire} onChange={(e) => setSaisie({ ...saisie, commentaire: e.target.value })} />
          </Champ>
          <button className="bouton bouton--principal">Enregistrer la facture</button>
        </form>
      )}
    </Section>
  );
}

// Bordereau de reversement : détail imprimable, validation par une autre personne que celle qui l'a préparé,
// versement (date et référence du virement), annulation avant validation, export pour Excel.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Chargement, Section } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import { aujourdHui, BRANCHES, dateCourte, dateHeure, montant, MODES_PAIEMENT, STATUTS_BORDEREAU } from "../../services/format";
import { useSession } from "../../session";
import { tonBordereau, type Bordereau } from "./Reversements";

interface Ligne {
  id: string;
  numeroRecu: number;
  encaisseLe: string;
  clientNom: string;
  numeroPolice: string | null;
  branche: string;
  mode: string;
  reference: string | null;
  montant: number;
}

interface Detail {
  bordereau: Bordereau;
  lignes: Ligne[];
  totaux: { especes: number; cheque: number; mobile_money: number; virement: number; total: number; nombre: number };
}

export function PageBordereau({ id }: { id: string }) {
  const { peut, session } = useSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [erreur, setErreur] = useState("");
  const [introuvable, setIntrouvable] = useState(false);

  const charger = useCallback(async () => {
    try {
      setDetail(await api<Detail>(`/reversements/${id}`));
    } catch (e) {
      if (e instanceof ErreurApi && (e.statut === 404 || e.statut === 400)) setIntrouvable(true);
      else setErreur(messageErreur(e));
    }
  }, [id]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function action(chemin: string, corps: object = {}) {
    setErreur("");
    try {
      setDetail(await api<Detail>(`/reversements/${id}/${chemin}`, { corps }));
      return true;
    } catch (e) {
      setErreur(messageErreur(e));
      return false;
    }
  }

  if (introuvable) return <><h1>Bordereau introuvable</h1><p><Lien href="/reversements">Retour aux reversements</Lien></p></>;
  if (!detail) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const { bordereau: b, lignes, totaux } = detail;
  const moi = session?.utilisateur.id;

  return (
    <>
      <p className="fil non-imprimable"><Lien href="/reversements">Reversements</Lien> › {b.numero}</p>
      <div className="barre-outils non-imprimable">
        <button type="button" className="bouton bouton--petit" onClick={() => window.print()}>Imprimer</button>
        {peut("gerant") && <a className="bouton bouton--petit" href={`/api/reversements/${b.id}/export.csv`} download>Télécharger pour Excel</a>}
        {peut("gerant") && b.statut === "prepare" && b.prepareParId !== moi && (
          <button type="button" className="bouton bouton--principal bouton--petit" onClick={() => void action("validation")}>Valider le bordereau</button>
        )}
      </div>
      <Alerte>{erreur}</Alerte>
      {b.statut === "prepare" && b.prepareParId === moi && (
        <Alerte type="info">Vous avez préparé ce bordereau : une autre personne doit le valider (principe des quatre yeux).</Alerte>
      )}

      <article className="document" aria-labelledby="titre-bordereau">
        <header className="document__entete">
          <div>
            <p className="recu__agence">DBS-ASSURANCES</p>
            <p>Agent Général SanlamAllianz Côte d'Ivoire · Code agence 2623</p>
          </div>
          <div>
            <h1 id="titre-bordereau">Bordereau {b.numero}</h1>
            <p>Encaissements du {dateCourte(b.periodeDebut)} au {dateCourte(b.periodeFin)}</p>
            <p><Badge ton={tonBordereau(b.statut)}>{STATUTS_BORDEREAU[b.statut]}</Badge></p>
          </div>
        </header>

        {b.statut === "annule" && <Alerte type="info">{`Annulé par ${b.annulePar} le ${dateHeure(b.annuleLe!)} : ${b.motifAnnulation}. Ses encaissements sont de nouveau à reverser.`}</Alerte>}

        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Reçu</th><th>Date</th><th>Client</th><th>Police</th><th>Branche</th><th>Mode</th><th>Montant</th></tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td>{l.numeroRecu}</td>
                  <td>{dateCourte(l.encaisseLe)}</td>
                  <td>{l.clientNom}</td>
                  <td>{l.numeroPolice ?? "—"}</td>
                  <td>{BRANCHES[l.branche]}</td>
                  <td>{MODES_PAIEMENT[l.mode]}{l.reference && <><br /><small>{l.reference}</small></>}</td>
                  <td className="nombre">{montant(l.montant)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th colSpan={6}>Total · {totaux.nombre} encaissement(s)</th><td className="nombre"><strong>{montant(totaux.total)}</strong></td></tr>
            </tfoot>
          </table>
        </div>
        <p>Dont espèces {montant(totaux.especes)} · Mobile Money {montant(totaux.mobile_money)} · chèques {montant(totaux.cheque)} · virements {montant(totaux.virement)}.</p>

        <div className="recu__signatures">
          <p>Préparé par {b.preparePar}<br /><small>le {dateHeure(b.prepareLe)}</small></p>
          <p>{b.validePar ? <>Validé par {b.validePar}<br /><small>le {dateHeure(b.valideLe!)}</small></> : "Validation : en attente"}</p>
          <p>{b.verseLe ? <>Versé le {dateCourte(b.verseLe)}<br /><small>virement {b.referenceVirement}</small></> : "Versement : en attente"}</p>
        </div>
      </article>

      {peut("gerant") && b.statut === "valide" && <Versement enregistrer={(corps) => action("versement", corps)} />}
      {b.statut === "prepare" && (peut("gerant") || (peut("caissier") && b.prepareParId === moi)) && (
        <Annulation annuler={(motif) => action("annulation", { motif })} />
      )}
    </>
  );
}

function Versement({ enregistrer }: { enregistrer: (corps: object) => Promise<boolean> }) {
  const [verseLe, setVerseLe] = useState(aujourdHui());
  const [reference, setReference] = useState("");
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    await enregistrer({ verseLe, referenceVirement: reference });
  }
  return (
    <Section titre="Enregistrer le versement à la compagnie">
      <form className="formulaire formulaire--grille non-imprimable" onSubmit={soumettre}>
        <Champ libelle="Date du versement"><input type="date" required max={aujourdHui()} value={verseLe} onChange={(e) => setVerseLe(e.target.value)} /></Champ>
        <Champ libelle="Référence du virement"><input required minLength={3} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} /></Champ>
        <div className="formulaire__actions"><button className="bouton bouton--principal">Enregistrer le versement</button></div>
      </form>
      <p className="note">Une fois versé, le bordereau ne se modifie plus.</p>
    </Section>
  );
}

function Annulation({ annuler }: { annuler: (motif: string) => Promise<boolean> }) {
  const [ouvert, setOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    if (await annuler(motif)) setOuvert(false);
  }
  return (
    <div className="non-imprimable">
      {ouvert ? (
        <Section titre="Annuler ce bordereau">
          <form className="formulaire formulaire--ligne" onSubmit={soumettre}>
            <Champ libelle="Motif"><input required minLength={5} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} /></Champ>
            <button className="bouton bouton--danger">Annuler le bordereau</button>
            <button type="button" className="bouton" onClick={() => setOuvert(false)}>Fermer</button>
          </form>
          <p className="note">Ses encaissements redeviendront à reverser et pourront entrer dans un nouveau bordereau.</p>
        </Section>
      ) : (
        <button type="button" className="bouton bouton--petit" onClick={() => setOuvert(true)}>Annuler ce bordereau…</button>
      )}
    </div>
  );
}

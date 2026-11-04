// Reversements à SanlamAllianz : primes à reverser avec le compte à rebours des 30 jours (Code CIMA, art. 542),
// préparation des bordereaux, liste des bordereaux.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Chargement, Section, Vide } from "../../composants/communs";
import { Lien, naviguer } from "../../routeur";
import { api, messageErreur } from "../../services/api";
import { aujourdHui, dateCourte, dateHeure, joursRestants, montant, MODES_PAIEMENT, STATUTS_BORDEREAU } from "../../services/format";
import { useSession } from "../../session";

export interface ResumeAReverser {
  total: number;
  nombre: number;
  totalNonRattache: number;
  nombreNonRattache: number;
  prochaineDateLimite: string | null;
  joursRestants: number | null;
  enRetard: number;
  alerte: boolean;
}

interface LigneAReverser {
  id: string;
  numeroRecu: number;
  montant: number;
  mode: string;
  encaisseLe: string;
  dateLimite: string;
  joursRestants: number;
  enRetard: boolean;
  numeroBordereau: string | null;
  clientNom: string;
  numeroPolice: string | null;
}

export interface Bordereau {
  id: string;
  numero: string;
  periodeDebut: string;
  periodeFin: string;
  prepareLe: string;
  prepareParId: string;
  preparePar: string;
  valideLe: string | null;
  validePar: string | null;
  verseLe: string | null;
  referenceVirement: string | null;
  annuleLe: string | null;
  annulePar: string | null;
  motifAnnulation: string | null;
  statut: "prepare" | "valide" | "verse" | "annule";
  nombre: number;
  total: number;
}

export function tonBordereau(statut: Bordereau["statut"]) {
  return statut === "verse" ? "vert" : statut === "valide" ? "bleu" : statut === "prepare" ? "orange" : "gris";
}

export function tonDelai(jours: number) {
  return jours < 0 ? "rouge" : jours <= 5 ? "orange" : "gris";
}

/** Bandeau du tableau de bord et de cette page : le délai de reversement le plus proche. */
export function AlerteReversement({ resume }: { resume: ResumeAReverser }) {
  if (resume.nombre === 0 || resume.joursRestants === null) return null;
  const texte = `${montant(resume.total)} de primes à reverser à SanlamAllianz. Prochaine date limite : ` +
    `${dateCourte(resume.prochaineDateLimite)} (${joursRestants(resume.joursRestants)}).`;
  if (resume.enRetard > 0) {
    return <Alerte>{`${resume.enRetard} encaissement(s) en retard de reversement (30 jours, Code CIMA, art. 542). ${texte}`}</Alerte>;
  }
  return <Alerte type={resume.alerte ? "erreur" : "info"}>{texte}</Alerte>;
}

export function Reversements() {
  const { peut } = useSession();
  const [aReverser, setAReverser] = useState<{ resume: ResumeAReverser; encaissements: LigneAReverser[] } | null>(null);
  const [bordereaux, setBordereaux] = useState<Bordereau[] | null>(null);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(async () => {
    try {
      setAReverser(await api("/reversements/a-reverser"));
      setBordereaux((await api<{ bordereaux: Bordereau[] }>("/reversements")).bordereaux);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (!aReverser || !bordereaux) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const nonRattaches = aReverser.encaissements.filter((e) => !e.numeroBordereau);

  return (
    <>
      <h1>Reversements à SanlamAllianz</h1>
      <AlerteReversement resume={aReverser.resume} />
      <div className="cartes">
        <div className="carte carte--bleu"><span className="carte__nombre">{montant(aReverser.resume.total)}</span><span className="carte__titre">Primes pas encore versées</span></div>
        <div className="carte carte--orange"><span className="carte__nombre">{montant(aReverser.resume.totalNonRattache)}</span><span className="carte__titre">Hors bordereau</span></div>
        <div className="carte carte--rouge"><span className="carte__nombre">{aReverser.resume.enRetard}</span><span className="carte__titre">En retard (plus de 30 jours)</span></div>
      </div>

      {peut("gerant", "caissier") && nonRattaches.length > 0 && <Preparer />}

      <Section titre="Bordereaux">
        {bordereaux.length === 0 ? <Vide>Aucun bordereau pour l'instant.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Bordereau</th><th>Période</th><th>Encaissements</th><th>Montant</th><th>Statut</th></tr></thead>
              <tbody>
                {bordereaux.map((b) => (
                  <tr key={b.id}>
                    <td><Lien href={`/reversements/${b.id}`}>{b.numero}</Lien><br /><small>préparé par {b.preparePar}</small></td>
                    <td>{dateCourte(b.periodeDebut)} → {dateCourte(b.periodeFin)}</td>
                    <td className="nombre">{b.nombre}</td>
                    <td className="nombre">{montant(b.total)}</td>
                    <td><Badge ton={tonBordereau(b.statut)}>{STATUTS_BORDEREAU[b.statut]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section titre="Encaissements pas encore versés">
        {aReverser.encaissements.length === 0 ? <Vide>Toutes les primes encaissées ont été versées à la compagnie.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Reçu</th><th>Encaissé le</th><th>Client</th><th>Mode</th><th>Montant</th><th>À verser avant le</th><th>Bordereau</th></tr></thead>
              <tbody>
                {aReverser.encaissements.map((e) => (
                  <tr key={e.id}>
                    <td><Lien href={`/recus/${e.id}`}>N° {e.numeroRecu}</Lien></td>
                    <td>{dateHeure(e.encaisseLe)}</td>
                    <td>{e.clientNom}<br /><small>{e.numeroPolice ?? "police à saisir"}</small></td>
                    <td>{MODES_PAIEMENT[e.mode]}</td>
                    <td className="nombre">{montant(e.montant)}</td>
                    <td>{dateCourte(e.dateLimite)}<br /><Badge ton={tonDelai(e.joursRestants)}>{joursRestants(e.joursRestants)}</Badge></td>
                    <td>{e.numeroBordereau ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function Preparer() {
  const [jusquAu, setJusquAu] = useState(aujourdHui());
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const { bordereau } = await api<{ bordereau: Bordereau }>("/reversements", { corps: { jusquAu } });
      naviguer(`/reversements/${bordereau.id}`);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  }

  return (
    <Section titre="Préparer un bordereau">
      <form className="formulaire formulaire--ligne" onSubmit={soumettre}>
        <Champ libelle="Encaissements jusqu'au" aide="Tous les encaissements hors bordereau jusqu'à cette date y seront rattachés">
          <input type="date" required max={aujourdHui()} value={jusquAu} onChange={(e) => setJusquAu(e.target.value)} />
        </Champ>
        <button className="bouton bouton--principal" disabled={envoi}>Préparer le bordereau</button>
      </form>
      <p className="note">Une autre personne le validera ensuite (principe des quatre yeux).</p>
      <Alerte>{erreur}</Alerte>
    </Section>
  );
}

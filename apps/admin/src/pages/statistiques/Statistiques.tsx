// Statistiques du gérant (tâche 12) : l'année en chiffres. Production et encaissements par mois (graphique en
// SVG, sans bibliothèque ni style en ligne : la politique de sécurité du contenu reste stricte), portefeuille,
// renouvellements, sinistres, réclamations, demandes du site, paiements, production par personne.

import { useEffect, useState } from "react";
import { Alerte, Chargement, Section, Vide } from "../../composants/communs";
import { api, messageErreur } from "../../services/api";
import { BRANCHES, MODES_PAIEMENT, montant, moisEnLettres, ROLES } from "../../services/format";

interface Mois { mois: string; contratsSouscrits: number; primesEmises: number; encaisse: number; sinistres: number }
interface Statistiques {
  annee: number;
  mois: Mois[];
  branches: { branche: string; souscrits: number; primes: number; enVigueur: number }[];
  modes: { mode: string; nombre: number; montant: number; enLigne: number }[];
  portefeuille: { clients: number; clientsAssures: number; contratsEnVigueur: number; resteARecouvrer: number };
  renouvellement: { echus: number; renouveles: number };
  sinistres: { declares: number; enLigne: number; enCours: number; delaiDeclaration: number | null };
  reclamations: { recues: number; ouvertes: number; repondues: number; dansLesDelais: number; fondees: number; delaiReponse: number | null };
  demandesSite: { recues: number; converties: number };
  production: { id: string; nom: string; role: keyof typeof ROLES; contrats: number; primes: number }[];
  apporteurs: { id: string; nom: string; contrats: number; primes: number }[];
}

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const pourcentage = (partie: number, total: number) => (total === 0 ? "—" : `${Math.round((partie / total) * 100)} %`);
const nombre = (valeur: number) => new Intl.NumberFormat("fr-FR").format(valeur);
const millions = (valeur: number) => (valeur >= 1_000_000 ? `${(valeur / 1_000_000).toFixed(1).replace(".", ",")} M` : nombre(Math.round(valeur / 1000)) + " k");

/** Primes émises et encaissements, mois par mois */
function Graphique({ mois }: { mois: Mois[] }) {
  const max = Math.max(1, ...mois.flatMap((m) => [m.primesEmises, m.encaisse]));
  const hauteur = 160;
  const largeurMois = 52;
  return (
    <figure className="graphique">
      <svg viewBox={`0 0 ${mois.length * largeurMois + 10} ${hauteur + 40}`} role="img"
        aria-label="Primes émises et encaissements, par mois (le tableau ci-dessous donne les montants)">
        {mois.map((m, i) => {
          const x = 10 + i * largeurMois;
          const hPrimes = Math.round((m.primesEmises / max) * hauteur);
          const hEncaisse = Math.round((m.encaisse / max) * hauteur);
          return (
            <g key={m.mois}>
              <rect className="graphique__primes" x={x} y={hauteur - hPrimes + 5} width={18} height={hPrimes} />
              <rect className="graphique__encaisse" x={x + 20} y={hauteur - hEncaisse + 5} width={18} height={hEncaisse} />
              <text className="graphique__libelle" x={x + 19} y={hauteur + 25} textAnchor="middle">{MOIS_COURTS[Number(m.mois.slice(5, 7)) - 1]}</text>
            </g>
          );
        })}
        <line className="graphique__axe" x1={5} x2={mois.length * largeurMois + 5} y1={hauteur + 5} y2={hauteur + 5} />
      </svg>
      <figcaption>
        <span className="legende legende--primes">Primes émises</span> <span className="legende legende--encaisse">Encaissements</span>
        {" "}· échelle : {montant(max)} au plus haut
      </figcaption>
    </figure>
  );
}

export function Statistiques() {
  const anneeCourante = new Date().getFullYear();
  const [annee, setAnnee] = useState(anneeCourante);
  const [stats, setStats] = useState<Statistiques | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setStats(null);
    api<Statistiques>(`/statistiques?annee=${annee}`).then(setStats).catch((e: unknown) => setErreur(messageErreur(e)));
  }, [annee]);

  const annees = Array.from({ length: Math.max(1, anneeCourante - 2025) }, (_, i) => anneeCourante - i);
  return (
    <>
      <h1>Statistiques {annee}</h1>
      <div className="onglets" role="group" aria-label="Année">
        {annees.map((a) => (
          <button key={a} type="button" className={`bouton bouton--petit${a === annee ? " bouton--principal" : ""}`} aria-pressed={a === annee} onClick={() => setAnnee(a)}>{a}</button>
        ))}
      </div>
      <Alerte>{erreur}</Alerte>
      {!stats ? (!erreur && <Chargement />) : <Tableau stats={stats} />}
    </>
  );
}

function Tableau({ stats }: { stats: Statistiques }) {
  const totalPrimes = stats.mois.reduce((t, m) => t + m.primesEmises, 0);
  const totalEncaisse = stats.mois.reduce((t, m) => t + m.encaisse, 0);
  const totalContrats = stats.mois.reduce((t, m) => t + m.contratsSouscrits, 0);
  const { portefeuille: p, renouvellement: r, sinistres: s, reclamations: rec, demandesSite: d } = stats;
  const enLigne = stats.modes.reduce((t, m) => t + m.enLigne, 0);
  return (
    <>
      <div className="cartes">
        <div className="carte carte--bleu"><span className="carte__nombre">{millions(totalPrimes)}</span><span className="carte__titre">Primes émises ({nombre(totalContrats)} contrats)</span></div>
        <div className="carte carte--vert"><span className="carte__nombre">{millions(totalEncaisse)}</span><span className="carte__titre">Encaissé</span></div>
        <div className="carte carte--orange"><span className="carte__nombre">{millions(p.resteARecouvrer)}</span><span className="carte__titre">Reste à recouvrer (aujourd'hui)</span></div>
        <div className="carte carte--bleu"><span className="carte__nombre">{pourcentage(r.renouveles, r.echus)}</span><span className="carte__titre">Contrats renouvelés ({r.renouveles} sur {r.echus} échus)</span></div>
        <div className="carte carte--gris"><span className="carte__nombre">{nombre(p.contratsEnVigueur)}</span><span className="carte__titre">Contrats en vigueur ({nombre(p.clientsAssures)} clients sur {nombre(p.clients)})</span></div>
      </div>

      <Section titre="Mois par mois">
        <Graphique mois={stats.mois} />
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Mois</th><th className="nombre">Contrats souscrits</th><th className="nombre">Primes émises</th><th className="nombre">Encaissé</th><th className="nombre">Sinistres déclarés</th></tr></thead>
            <tbody>
              {stats.mois.map((m) => (
                <tr key={m.mois}>
                  <td>{moisEnLettres(m.mois)}</td><td className="nombre">{m.contratsSouscrits}</td><td className="nombre">{montant(m.primesEmises)}</td>
                  <td className="nombre">{montant(m.encaisse)}</td><td className="nombre">{m.sinistres}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section titre="Par branche">
        {stats.branches.length === 0 ? <Vide>Aucun contrat.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Branche</th><th className="nombre">Souscrits dans l'année</th><th className="nombre">Primes</th><th className="nombre">En vigueur</th></tr></thead>
              <tbody>{stats.branches.map((b) => (
                <tr key={b.branche}><td>{BRANCHES[b.branche] ?? b.branche}</td><td className="nombre">{b.souscrits}</td><td className="nombre">{montant(b.primes)}</td><td className="nombre">{b.enVigueur}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Section>

      <Section titre="Encaissements par mode">
        {stats.modes.length === 0 ? <Vide>Aucun encaissement.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Mode</th><th className="nombre">Paiements</th><th className="nombre">Montant</th><th className="nombre">Part</th></tr></thead>
              <tbody>{stats.modes.map((m) => (
                <tr key={m.mode}><td>{MODES_PAIEMENT[m.mode] ?? m.mode}{m.enLigne > 0 && <><br /><small>dont {montant(m.enLigne)} payés en ligne</small></>}</td>
                  <td className="nombre">{m.nombre}</td><td className="nombre">{montant(m.montant)}</td><td className="nombre">{pourcentage(m.montant, totalEncaisse)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {enLigne > 0 && <p className="note">Paiements en ligne : {montant(enLigne)}, soit {pourcentage(enLigne, totalEncaisse)} des encaissements.</p>}
      </Section>

      <Section titre="Service aux clients">
        <dl className="details">
          <div><dt>Sinistres déclarés</dt><dd>{s.declares} dont {s.enLigne} en ligne · {s.enCours} en cours
            {s.delaiDeclaration !== null && ` · déclarés ${String(s.delaiDeclaration).replace(".", ",")} jour(s) après les faits en moyenne`}</dd></div>
          <div><dt>Réclamations</dt><dd>{rec.recues} reçues · {rec.ouvertes} ouvertes · {pourcentage(rec.dansLesDelais, rec.repondues)} des réponses dans les délais
            {rec.delaiReponse !== null && ` · ${String(rec.delaiReponse).replace(".", ",")} jour(s) pour répondre en moyenne`} · {rec.fondees} fondées</dd></div>
          <div><dt>Demandes du site</dt><dd>{d.recues} reçues · {d.converties} devenues un devis ({pourcentage(d.converties, d.recues)})</dd></div>
        </dl>
      </Section>

      <Section titre="Production par personne">
        {stats.production.length === 0 ? <Vide>Aucun contrat dans l'année.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Saisi par</th><th className="nombre">Contrats</th><th className="nombre">Primes</th></tr></thead>
              <tbody>{stats.production.map((x) => <tr key={x.id}><td>{x.nom}<br /><small>{ROLES[x.role]}</small></td><td className="nombre">{x.contrats}</td><td className="nombre">{montant(x.primes)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {stats.apporteurs.length > 0 && (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Apporteur</th><th className="nombre">Contrats de ses clients</th><th className="nombre">Primes</th></tr></thead>
              <tbody>{stats.apporteurs.map((x) => <tr key={x.id}><td>{x.nom}</td><td className="nombre">{x.contrats}</td><td className="nombre">{montant(x.primes)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

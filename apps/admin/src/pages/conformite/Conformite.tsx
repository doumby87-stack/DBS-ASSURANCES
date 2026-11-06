// Conformité (tâche 12) : fiches d'identification à compléter (clients en relation), alertes de lutte contre
// le blanchiment et décision du gérant (seul à les voir), formations du personnel.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Chargement, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, messageErreur } from "../../services/api";
import { aujourdHui, dateCourte, dateHeure, ROLES, TYPES_CLIENT } from "../../services/format";
import { useSession } from "../../session";

const TYPES_ALERTE: Record<string, string> = {
  especes_plafond: "Espèces proches du plafond", paiement_tiers: "Paiement par un tiers",
  fractionnement: "Paiements en espèces fractionnés", resiliation_rapide: "Résiliation rapide",
};
export const THEMES_FORMATION: Record<string, string> = {
  lbc_ft: "Lutte contre le blanchiment", hameconnage: "Hameçonnage", mots_de_passe: "Mots de passe",
  procedure_incident: "Procédure d'incident", donnees_personnelles: "Données personnelles",
};
const STATUTS_FICHE: Record<string, string> = { absente: "Absente", incomplete: "À compléter", a_revoir: "À revoir" };

interface FicheACompleter { clientId: string; nom: string; type: string; statut: string; niveauRisque: string; manques: string[]; contratsEnCours: number }
interface AlerteLbc {
  cle: string; type: string; contratId: string; numeroPolice: string | null; clientId: string; client: string; detecteeLe: string;
  detail: string; decision: string | null; motif: string | null; traiteLe: string | null; traitePar: string | null;
}
interface EtatFormation { utilisateurId: string; nom: string; role: keyof typeof ROLES; theme: string; derniere: string | null; aRefaire: boolean }
interface Utilisateur { id: string; nom: string; role: keyof typeof ROLES; actif: boolean }

export function Conformite() {
  const { peut } = useSession();
  return (
    <>
      <h1>Conformité</h1>
      <p>
        Lutte contre le blanchiment (règlement CIMA n° 0031 du 10 juillet 2025) : connaître chaque client, repérer les situations inhabituelles,
        former le personnel. Les seuils des alertes sont proposés, à confirmer avec la procédure de SanlamAllianz.
      </p>
      {peut("gerant", "charge_clientele", "auditeur") && <FichesACompleter />}
      {peut("gerant") && <Alertes />}
      <Formations />
    </>
  );
}

function FichesACompleter() {
  const [fiches, setFiches] = useState<FicheACompleter[] | null>(null);
  const [erreur, setErreur] = useState("");
  useEffect(() => {
    api<{ clients: FicheACompleter[] }>("/identifications/a-completer").then((r) => setFiches(r.clients)).catch((e: unknown) => setErreur(messageErreur(e)));
  }, []);
  return (
    <Section titre="Fiches d'identification à compléter">
      <p className="note">Clients avec un contrat en cours dont la fiche est absente, incomplète ou à revoir. Les clients à risque élevé passent en premier.</p>
      <Alerte>{erreur}</Alerte>
      {!fiches ? (!erreur && <Chargement />) : fiches.length === 0 ? <Vide>Toutes les fiches sont complètes.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Client</th><th>Fiche</th><th>Ce qui manque</th><th className="nombre">Contrats en cours</th></tr></thead>
            <tbody>
              {fiches.map((f) => (
                <tr key={f.clientId}>
                  <td><Lien href={`/clients/${f.clientId}`}>{f.nom}</Lien><br /><small>{TYPES_CLIENT[f.type]}</small></td>
                  <td>
                    <Badge ton={f.statut === "a_revoir" ? "rouge" : f.statut === "absente" ? "gris" : "orange"}>{STATUTS_FICHE[f.statut] ?? f.statut}</Badge>
                    {f.niveauRisque === "eleve" && <> <Badge ton="rouge">Risque élevé</Badge></>}
                  </td>
                  <td>{f.manques.join(", ")}</td>
                  <td className="nombre">{f.contratsEnCours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Alertes() {
  const [toutes, setToutes] = useState(false);
  const [alertes, setAlertes] = useState<AlerteLbc[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState<{ cle: string; decision: string; motif: string } | null>(null);

  const charger = useCallback(async () => {
    try {
      setAlertes((await api<{ alertes: AlerteLbc[] }>(`/alertes${toutes ? "?toutes=oui" : ""}`)).alertes);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [toutes]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function decider(evenement: FormEvent) {
    evenement.preventDefault();
    if (!enCours) return;
    setErreur("");
    try {
      await api("/alertes/traitements", { corps: enCours });
      setEnCours(null);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <Section titre="Alertes (gérant seulement)">
      <p className="note">
        Examinez chaque situation, puis classez-la ou transmettez-la au correspondant LBC/FT de SanlamAllianz. N'en parlez jamais au client :
        l'avertir d'un soupçon est interdit.
      </p>
      <div className="onglets" role="group" aria-label="Alertes affichées">
        <button type="button" className={`bouton bouton--petit${toutes ? "" : " bouton--principal"}`} aria-pressed={!toutes} onClick={() => setToutes(false)}>À traiter</button>
        <button type="button" className={`bouton bouton--petit${toutes ? " bouton--principal" : ""}`} aria-pressed={toutes} onClick={() => setToutes(true)}>Toutes</button>
      </div>
      <Alerte>{erreur}</Alerte>
      {!alertes ? (!erreur && <Chargement />) : alertes.length === 0 ? <Vide>Aucune alerte {toutes ? "" : "à traiter"}.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Situation</th><th>Client et contrat</th><th>Détectée</th><th>Décision</th></tr></thead>
            <tbody>
              {alertes.map((a) => (
                <tr key={a.cle}>
                  <td><strong>{TYPES_ALERTE[a.type] ?? a.type}</strong><br /><small>{a.detail}</small></td>
                  <td><Lien href={`/clients/${a.clientId}`}>{a.client}</Lien><br /><Lien href={`/contrats/${a.contratId}`}><small>{a.numeroPolice ?? "Contrat"}</small></Lien></td>
                  <td>{dateHeure(a.detecteeLe)}</td>
                  <td>
                    {a.decision ? (
                      <><Badge ton={a.decision === "sans_suite" ? "gris" : "rouge"}>{a.decision === "sans_suite" ? "Classée" : "Transmise au correspondant"}</Badge>
                        <br /><small>{a.motif} · {a.traitePar}, {a.traiteLe && dateHeure(a.traiteLe)}</small></>
                    ) : enCours?.cle === a.cle ? (
                      <form className="formulaire" aria-label={`Décision sur l'alerte ${TYPES_ALERTE[a.type]} de ${a.client}`} onSubmit={(e) => void decider(e)}>
                        <Champ libelle="Décision">
                          <select value={enCours.decision} onChange={(e) => setEnCours({ ...enCours, decision: e.target.value })}>
                            <option value="sans_suite">Classer après examen</option>
                            <option value="transmise_correspondant">Transmettre au correspondant LBC/FT</option>
                          </select>
                        </Champ>
                        <Champ libelle="Motif"><input required minLength={5} maxLength={1000} value={enCours.motif} onChange={(e) => setEnCours({ ...enCours, motif: e.target.value })} /></Champ>
                        <div className="formulaire__actions">
                          <button className="bouton bouton--petit bouton--principal">Enregistrer</button>
                          <button type="button" className="bouton bouton--petit" onClick={() => setEnCours(null)}>Fermer</button>
                        </div>
                      </form>
                    ) : (
                      <button type="button" className="bouton bouton--petit" onClick={() => setEnCours({ cle: a.cle, decision: "sans_suite", motif: "" })}>Décider…</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Formations() {
  const { peut } = useSession();
  const gerant = peut("gerant");
  const [etat, setEtat] = useState<EtatFormation[] | null>(null);
  const [personnel, setPersonnel] = useState<Utilisateur[]>([]);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [saisie, setSaisie] = useState({ theme: "lbc_ft", suivieLe: aujourdHui(), commentaire: "", ids: [] as string[] });

  const charger = useCallback(async () => {
    try {
      setEtat((await api<{ etat: EtatFormation[] }>("/formations")).etat);
      if (gerant) setPersonnel((await api<{ utilisateurs: Utilisateur[] }>("/utilisateurs")).utilisateurs.filter((u) => u.actif));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [gerant]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function enregistrer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setMessage("");
    try {
      await api("/formations", { corps: { utilisateurIds: saisie.ids, theme: saisie.theme, suivieLe: saisie.suivieLe, ...(saisie.commentaire.trim() ? { commentaire: saisie.commentaire.trim() } : {}) } });
      setMessage(`Formation enregistrée pour ${saisie.ids.length} personne(s).`);
      setSaisie({ ...saisie, ids: [], commentaire: "" });
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  const personnes = [...new Map((etat ?? []).map((e) => [e.utilisateurId, e])).values()];
  return (
    <Section titre="Formations du personnel">
      <p className="note">Chaque thème se refait au moins une fois par an. En rouge : jamais suivie, ou il y a plus d'un an.</p>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
      {!etat ? (!erreur && <Chargement />) : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Personne</th>{Object.values(THEMES_FORMATION).map((t) => <th key={t}>{t}</th>)}</tr></thead>
            <tbody>
              {personnes.map((p) => (
                <tr key={p.utilisateurId}>
                  <td>{p.nom}<br /><small>{ROLES[p.role]}</small></td>
                  {Object.keys(THEMES_FORMATION).map((theme) => {
                    const ligne = etat.find((e) => e.utilisateurId === p.utilisateurId && e.theme === theme);
                    return <td key={theme}>{ligne?.derniere ? <Badge ton={ligne.aRefaire ? "rouge" : "vert"}>{dateCourte(ligne.derniere)}</Badge> : <Badge ton="rouge">Jamais</Badge>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gerant && (
        <form className="formulaire" aria-label="Enregistrer une formation" onSubmit={(e) => void enregistrer(e)}>
          <div className="formulaire formulaire--grille">
            <Champ libelle="Thème">
              <select value={saisie.theme} onChange={(e) => setSaisie({ ...saisie, theme: e.target.value })}>
                {Object.entries(THEMES_FORMATION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Champ>
            <Champ libelle="Suivie le"><input type="date" required max={aujourdHui()} value={saisie.suivieLe} onChange={(e) => setSaisie({ ...saisie, suivieLe: e.target.value })} /></Champ>
            <Champ libelle="Commentaire (facultatif)"><input maxLength={300} value={saisie.commentaire} onChange={(e) => setSaisie({ ...saisie, commentaire: e.target.value })} /></Champ>
          </div>
          <fieldset className="choix-personnes">
            <legend>Personnes présentes</legend>
            {personnel.map((u) => (
              <label key={u.id} className="case-a-cocher">
                <input type="checkbox" checked={saisie.ids.includes(u.id)}
                  onChange={(e) => setSaisie({ ...saisie, ids: e.target.checked ? [...saisie.ids, u.id] : saisie.ids.filter((x) => x !== u.id) })} />
                <span>{u.nom} <small>({ROLES[u.role]})</small></span>
              </label>
            ))}
          </fieldset>
          <button className="bouton bouton--principal" disabled={saisie.ids.length === 0}>Enregistrer la formation</button>
        </form>
      )}
    </Section>
  );
}

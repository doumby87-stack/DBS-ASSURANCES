// Fiche client : tout ce qui concerne un client sur une seule page (contrats, véhicules, devis,
// accord pour les rappels automatiques, échanges).

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Alerte, Badge, Champ, Chargement, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import {
  aujourdHui, BRANCHES, CANAUX, CANAUX_RELANCE, dateCourte, dateHeure, montant, STATUTS_CONTRAT, STATUTS_DEVIS, STATUTS_RELANCE,
  telephone, TYPES_CLIENT, TYPES_RELANCE,
} from "../../services/format";
import { useSession } from "../../session";

interface Contrat {
  id: string;
  numeroPolice: string | null;
  branche: string;
  dateEffet: string;
  dateEcheance: string;
  primeTtc: number;
  statut: string;
  renouvele: boolean;
  /** Seulement pour qui voit la caisse */
  resteAPayer: number | null;
}
interface Vehicule {
  id: string;
  immatriculation: string;
  marque: string | null;
  modele: string | null;
  genre: string | null;
  echeanceVisiteTechnique: string | null;
  echeanceVignette: string | null;
  echeanceCarteTransport: string | null;
}
interface Devis {
  id: string;
  branche: string;
  description: string | null;
  primeProposee: number | null;
  statut: string;
  motifRefus: string | null;
  creeLe: string;
}
interface Echange {
  id: string;
  canal: string;
  resume: string;
  survenuLe: string;
  auteur: string;
}
interface Consentement {
  canal: string;
  accorde: boolean;
  source: "agence" | "reponse_client";
  preuve: string;
  enregistreLe: string;
  enregistrePar: string | null;
}
interface RelanceClient {
  id: string;
  type: string;
  canal: string;
  statut: string;
  planifieeLe: string;
  envoyeeLe: string | null;
  texte: string | null;
}
interface Fiche {
  client: { id: string; type: string; nom: string; telephone: string; email: string | null; commune: string | null; rccm: string | null };
  contrats: Contrat[];
  vehicules: Vehicule[];
  devis: Devis[];
  echanges: Echange[];
  consentements: Consentement[];
  relances: RelanceClient[];
}

const optionsBranches = Object.entries(BRANCHES).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>);

function tonStatut(statut: string) {
  return statut === "en_vigueur" ? "vert" : statut === "en_attente_paiement" ? "orange" : statut === "accepte" ? "vert" : statut === "refuse" ? "rouge" : "gris";
}

export function FicheClient({ id }: { id: string }) {
  const { peut } = useSession();
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [erreur, setErreur] = useState("");
  const [introuvable, setIntrouvable] = useState(false);

  const charger = useCallback(async () => {
    try {
      setFiche(await api<Fiche>(`/clients/${id}`));
    } catch (e) {
      if (e instanceof ErreurApi && (e.statut === 404 || e.statut === 400)) setIntrouvable(true);
      else setErreur(messageErreur(e));
    }
  }, [id]);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (introuvable) return <><h1>Client introuvable</h1><p><Lien href="/clients">Retour à la liste des clients</Lien></p></>;
  if (!fiche) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const { client } = fiche;
  const voitLaCaisse = peut("gerant", "caissier", "charge_clientele", "auditeur");

  return (
    <>
      <p className="fil"><Lien href="/clients">Clients</Lien> › {client.nom}</p>
      <h1>{client.nom}</h1>
      <dl className="identite">
        <div><dt>Type</dt><dd>{TYPES_CLIENT[client.type]}</dd></div>
        <div><dt>Téléphone</dt><dd><a href={`tel:${client.telephone}`}>{telephone(client.telephone)}</a></dd></div>
        <div><dt>E-mail</dt><dd>{client.email ?? "—"}</dd></div>
        <div><dt>Commune</dt><dd>{client.commune ?? "—"}</dd></div>
        {client.rccm && <div><dt>RCCM</dt><dd>{client.rccm}</dd></div>}
      </dl>
      <Alerte>{erreur}</Alerte>

      <Section titre="Contrats" actions={peut("gerant", "charge_clientele") && <Repliable libelle="Nouveau contrat"><NouveauContrat clientId={client.id} apres={charger} /></Repliable>}>
        {fiche.contrats.length === 0 ? <Vide>Aucun contrat.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Branche</th><th>N° de police</th><th>Période</th><th>Prime TTC</th>
                  {voitLaCaisse && <th>Reste à payer</th>}<th>Statut</th>{voitLaCaisse && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {fiche.contrats.map((c) => (
                  <tr key={c.id}>
                    <td>{BRANCHES[c.branche]}</td>
                    <td>{c.numeroPolice ?? "—"}</td>
                    <td>{dateCourte(c.dateEffet)} → {dateCourte(c.dateEcheance)}</td>
                    <td className="nombre">{montant(c.primeTtc)}</td>
                    {voitLaCaisse && <td className="nombre">{montant(c.resteAPayer)}</td>}
                    <td>
                      <Badge ton={tonStatut(c.statut)}>{STATUTS_CONTRAT[c.statut]}</Badge>
                      {c.renouvele && <> <Badge ton="bleu">Renouvelé</Badge></>}
                    </td>
                    {voitLaCaisse && (
                      <td>
                        <Lien href={`/contrats/${c.id}`} className="bouton bouton--petit">
                          {peut("gerant", "caissier") && (c.resteAPayer ?? 0) > 0 ? "Encaisser" : "Paiements"}
                        </Lien>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section titre="Véhicules" actions={peut("gerant", "charge_clientele", "commercial") && <Repliable libelle="Ajouter un véhicule"><NouveauVehicule clientId={client.id} apres={charger} /></Repliable>}>
        {fiche.vehicules.length === 0 ? <Vide>Aucun véhicule.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Immatriculation</th><th>Véhicule</th><th>Visite technique</th><th>Vignette</th><th>Carte de transport</th></tr></thead>
              <tbody>
                {fiche.vehicules.map((v) => (
                  <tr key={v.id}>
                    <td>{v.immatriculation}</td>
                    <td>{[v.marque, v.modele, v.genre].filter(Boolean).join(" · ") || "—"}</td>
                    <td>{dateCourte(v.echeanceVisiteTechnique)}</td>
                    <td>{dateCourte(v.echeanceVignette)}</td>
                    <td>{dateCourte(v.echeanceCarteTransport)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {peut("gerant", "charge_clientele", "commercial", "apporteur", "auditeur") && (
        <Section titre="Devis" actions={peut("gerant", "charge_clientele", "commercial", "apporteur") && <Repliable libelle="Nouveau devis"><NouveauDevis clientId={client.id} apres={charger} /></Repliable>}>
          {fiche.devis.length === 0 ? <Vide>Aucun devis.</Vide> : (
            <ul className="liste-devis">
              {fiche.devis.map((d) => <LigneDevis key={d.id} devis={d} modifiable={peut("gerant", "charge_clientele", "commercial")} apres={charger} />)}
            </ul>
          )}
        </Section>
      )}

      <Section titre="Rappels automatiques">
        <ul className="consentements">
          {Object.entries(CANAUX_RELANCE).map(([canal, libelle]) => {
            const choix = fiche.consentements.find((c) => c.canal === canal);
            return (
              <li key={canal}>
                <strong>{libelle}</strong>
                {!choix ? <Badge ton="gris">Pas encore demandé</Badge> : <Badge ton={choix.accorde ? "vert" : "rouge"}>{choix.accorde ? "Accepté" : "Refusé"}</Badge>}
                {choix && (
                  <small>
                    le {dateHeure(choix.enregistreLe)} · {choix.source === "reponse_client" ? "réponse du client" : `noté par ${choix.enregistrePar ?? "l'agence"}`} · {choix.preuve}
                  </small>
                )}
              </li>
            );
          })}
        </ul>
        {peut("gerant", "charge_clientele", "commercial") && <NouveauConsentement clientId={client.id} apres={charger} />}
        {fiche.relances.length > 0 && (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Date</th><th>Relance</th><th>Canal</th><th>Statut</th></tr></thead>
              <tbody>
                {fiche.relances.map((r) => (
                  <tr key={r.id}>
                    <td>{dateHeure(r.envoyeeLe ?? r.planifieeLe)}</td>
                    <td>{TYPES_RELANCE[r.type] ?? r.type}{r.texte && <p className="message-relance">{r.texte}</p>}</td>
                    <td>{CANAUX_RELANCE[r.canal] ?? r.canal}</td>
                    <td><Badge ton={r.statut === "echec" ? "rouge" : r.statut === "lue" || r.statut === "remise" ? "vert" : "gris"}>{STATUTS_RELANCE[r.statut] ?? r.statut}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section titre="Échanges">
        {peut("gerant", "charge_clientele", "caissier", "commercial", "apporteur") && <NouvelEchange clientId={client.id} apres={charger} />}
        {fiche.echanges.length === 0 ? <Vide>Aucun échange enregistré.</Vide> : (
          <ol className="historique">
            {fiche.echanges.map((e) => (
              <li key={e.id}>
                <p className="historique__entete"><Badge ton="gris">{CANAUX[e.canal]}</Badge> {dateHeure(e.survenuLe)} · {e.auteur}</p>
                <p>{e.resume}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}

function Repliable({ libelle, children }: { libelle: string; children: ReactNode }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <button type="button" className="bouton bouton--petit" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>{ouvert ? "Fermer" : libelle}</button>
      {ouvert && <div className="repliable">{children}</div>}
    </>
  );
}

/** Formulaire générique : envoie, affiche l'erreur de l'API, recharge la fiche. */
function useEnvoi(apres: () => Promise<void>) {
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  async function envoyer(action: () => Promise<unknown>): Promise<boolean> {
    setErreur("");
    setEnvoi(true);
    try {
      await action();
      await apres();
      return true;
    } catch (e) {
      setErreur(messageErreur(e));
      return false;
    } finally {
      setEnvoi(false);
    }
  }
  return { erreur, envoi, envoyer };
}

function NouveauContrat({ clientId, apres }: { clientId: string; apres: () => Promise<void> }) {
  const [c, setC] = useState({ branche: "automobile", numeroPolice: "", dateEffet: aujourdHui(), dateEcheance: aujourdHui(365), primeTtc: "", primeNette: "" });
  const { erreur, envoi, envoyer } = useEnvoi(apres);
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    await envoyer(() => api("/contrats", {
      corps: { clientId, branche: c.branche, dateEffet: c.dateEffet, dateEcheance: c.dateEcheance, primeTtc: Number(c.primeTtc),
               ...(c.numeroPolice.trim() ? { numeroPolice: c.numeroPolice } : {}),
               ...(c.primeNette.trim() ? { primeNette: Number(c.primeNette) } : {}) },
    }));
  }
  return (
    <form className="formulaire formulaire--grille" onSubmit={soumettre}>
      <Champ libelle="Branche"><select value={c.branche} onChange={(e) => setC({ ...c, branche: e.target.value })}>{optionsBranches}</select></Champ>
      <Champ libelle="N° de police (facultatif)" aide="Attribué par SanlamAllianz"><input maxLength={40} value={c.numeroPolice} onChange={(e) => setC({ ...c, numeroPolice: e.target.value })} /></Champ>
      <Champ libelle="Date d'effet"><input type="date" required value={c.dateEffet} onChange={(e) => setC({ ...c, dateEffet: e.target.value })} /></Champ>
      <Champ libelle="Échéance"><input type="date" required value={c.dateEcheance} onChange={(e) => setC({ ...c, dateEcheance: e.target.value })} /></Champ>
      <Champ libelle="Prime TTC (F CFA)"><input type="number" required min={1} step={1} inputMode="numeric" value={c.primeTtc} onChange={(e) => setC({ ...c, primeTtc: e.target.value })} /></Champ>
      <Champ libelle="Prime nette (facultatif)" aide="Hors taxes et accessoires : sert au calcul des commissions"><input type="number" min={1} step={1} inputMode="numeric" value={c.primeNette} onChange={(e) => setC({ ...c, primeNette: e.target.value })} /></Champ>
      <div className="formulaire__actions"><button className="bouton bouton--principal" disabled={envoi}>Créer le contrat</button></div>
      <Alerte>{erreur}</Alerte>
      <p className="note">Le contrat reste « en attente de paiement » jusqu'au règlement complet de la prime, puis entre en vigueur de lui-même (Code CIMA, art. 13).</p>
    </form>
  );
}

function NouveauVehicule({ clientId, apres }: { clientId: string; apres: () => Promise<void> }) {
  const vide = { immatriculation: "", marque: "", modele: "", genre: "", echeanceVisiteTechnique: "", echeanceVignette: "", echeanceCarteTransport: "" };
  const [v, setV] = useState(vide);
  const { erreur, envoi, envoyer } = useEnvoi(apres);
  const modifier = (nom: keyof typeof vide) => (e: { target: { value: string } }) => setV({ ...v, [nom]: e.target.value });
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    const corps = Object.fromEntries(Object.entries(v).filter(([, valeur]) => valeur.trim() !== ""));
    if (await envoyer(() => api(`/clients/${clientId}/vehicules`, { corps }))) setV(vide);
  }
  return (
    <form className="formulaire formulaire--grille" onSubmit={soumettre}>
      <Champ libelle="Immatriculation"><input required minLength={3} maxLength={20} value={v.immatriculation} onChange={modifier("immatriculation")} /></Champ>
      <Champ libelle="Marque"><input maxLength={40} value={v.marque} onChange={modifier("marque")} /></Champ>
      <Champ libelle="Modèle"><input maxLength={40} value={v.modele} onChange={modifier("modele")} /></Champ>
      <Champ libelle="Genre" aide="Voiture, tracteur, semi-remorque, moto…"><input maxLength={60} value={v.genre} onChange={modifier("genre")} /></Champ>
      <Champ libelle="Visite technique jusqu'au"><input type="date" value={v.echeanceVisiteTechnique} onChange={modifier("echeanceVisiteTechnique")} /></Champ>
      <Champ libelle="Vignette jusqu'au"><input type="date" value={v.echeanceVignette} onChange={modifier("echeanceVignette")} /></Champ>
      <Champ libelle="Carte de transport jusqu'au"><input type="date" value={v.echeanceCarteTransport} onChange={modifier("echeanceCarteTransport")} /></Champ>
      <div className="formulaire__actions"><button className="bouton bouton--principal" disabled={envoi}>Ajouter le véhicule</button></div>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

function NouveauDevis({ clientId, apres }: { clientId: string; apres: () => Promise<void> }) {
  const [d, setD] = useState({ branche: "automobile", description: "", primeProposee: "" });
  const { erreur, envoi, envoyer } = useEnvoi(apres);
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    const ok = await envoyer(() => api(`/clients/${clientId}/devis`, {
      corps: { branche: d.branche, ...(d.description.trim() ? { description: d.description } : {}),
               ...(d.primeProposee ? { primeProposee: Number(d.primeProposee) } : {}) },
    }));
    if (ok) setD({ branche: "automobile", description: "", primeProposee: "" });
  }
  return (
    <form className="formulaire formulaire--grille" onSubmit={soumettre}>
      <Champ libelle="Branche"><select value={d.branche} onChange={(e) => setD({ ...d, branche: e.target.value })}>{optionsBranches}</select></Champ>
      <Champ libelle="Prime proposée (F CFA, facultatif)"><input type="number" min={1} step={1} value={d.primeProposee} onChange={(e) => setD({ ...d, primeProposee: e.target.value })} /></Champ>
      <Champ libelle="Besoin du client"><textarea maxLength={2000} rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Champ>
      <div className="formulaire__actions"><button className="bouton bouton--principal" disabled={envoi}>Enregistrer le devis</button></div>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

function LigneDevis({ devis, modifiable, apres }: { devis: Devis; modifiable: boolean; apres: () => Promise<void> }) {
  const [statut, setStatut] = useState(devis.statut);
  const [motif, setMotif] = useState("");
  const { erreur, envoi, envoyer } = useEnvoi(apres);
  async function enregistrer(evenement: FormEvent) {
    evenement.preventDefault();
    await envoyer(() => api(`/devis/${devis.id}`, { methode: "PATCH", corps: { statut, ...(statut === "refuse" ? { motifRefus: motif } : {}) } }));
  }
  return (
    <li className="devis">
      <p>
        <strong>{BRANCHES[devis.branche]}</strong> · {montant(devis.primeProposee)} · <Badge ton={tonStatut(devis.statut)}>{STATUTS_DEVIS[devis.statut]}</Badge>
        <small> créé le {dateHeure(devis.creeLe)}</small>
      </p>
      {devis.description && <p>{devis.description}</p>}
      {devis.motifRefus && <p className="note">Motif du refus : {devis.motifRefus}</p>}
      {modifiable && !["accepte", "refuse", "sans_suite"].includes(devis.statut) && (
        <form className="formulaire formulaire--ligne" onSubmit={enregistrer}>
          <select aria-label="Nouveau statut" value={statut} onChange={(e) => setStatut(e.target.value)}>
            {Object.entries(STATUTS_DEVIS).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
          </select>
          {statut === "refuse" && <input aria-label="Motif du refus" placeholder="Motif du refus" required minLength={3} maxLength={500} value={motif} onChange={(e) => setMotif(e.target.value)} />}
          <button className="bouton bouton--petit" disabled={envoi || statut === devis.statut}>Mettre à jour</button>
          <Alerte>{erreur}</Alerte>
        </form>
      )}
    </li>
  );
}

/** Accord ou refus du client pour un canal, avec la façon dont il l'a exprimé (c'est la preuve). */
function NouveauConsentement({ clientId, apres }: { clientId: string; apres: () => Promise<void> }) {
  const [canal, setCanal] = useState("whatsapp");
  const [accorde, setAccorde] = useState("oui");
  const [preuve, setPreuve] = useState("");
  const { erreur, envoi, envoyer } = useEnvoi(apres);
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    if (await envoyer(() => api(`/clients/${clientId}/consentements`, { corps: { canal, accorde: accorde === "oui", preuve } }))) setPreuve("");
  }
  return (
    <form className="formulaire formulaire--ligne" onSubmit={soumettre}>
      <select aria-label="Canal" value={canal} onChange={(e) => setCanal(e.target.value)}>
        {Object.entries(CANAUX_RELANCE).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
      </select>
      <select aria-label="Choix du client" value={accorde} onChange={(e) => setAccorde(e.target.value)}>
        <option value="oui">accepte les rappels</option>
        <option value="non">refuse les rappels</option>
      </select>
      <input aria-label="Comment le client l'a exprimé" placeholder="Comment : accord oral au guichet, formulaire signé…" required minLength={3} maxLength={300} value={preuve} onChange={(e) => setPreuve(e.target.value)} />
      <button className="bouton bouton--petit" disabled={envoi}>Enregistrer son choix</button>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

function NouvelEchange({ clientId, apres }: { clientId: string; apres: () => Promise<void> }) {
  const [canal, setCanal] = useState("appel");
  const [resume, setResume] = useState("");
  const { erreur, envoi, envoyer } = useEnvoi(apres);
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    if (await envoyer(() => api(`/clients/${clientId}/echanges`, { corps: { canal, resume } }))) setResume("");
  }
  return (
    <form className="formulaire formulaire--ligne" onSubmit={soumettre}>
      <select aria-label="Canal" value={canal} onChange={(e) => setCanal(e.target.value)}>
        {Object.entries(CANAUX).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
      </select>
      <input aria-label="Résumé de l'échange" placeholder="Résumé de l'échange" required minLength={2} maxLength={2000} value={resume} onChange={(e) => setResume(e.target.value)} />
      <button className="bouton bouton--petit" disabled={envoi}>Noter</button>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

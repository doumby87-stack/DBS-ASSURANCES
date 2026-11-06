// Demandes reçues par le site (tâches 7 et 13) : devis, rappels d'échéance, appels d'offres. Les appels d'offres
// passent devant (date limite la plus proche), puis le reste dans l'ordre d'arrivée ; un rappel n'apparaît
// qu'un mois avant l'échéance (onglet « Rappels à venir » d'ici là). Chacune devient un client et un devis
// (ou rejoint la fiche du client qui a déjà ce numéro), ou est classée sans suite.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Chargement, Champ, Section, Vide } from "../../composants/communs";
import { Lien, naviguer } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import {
  BRANCHES, dateCourte, dateHeure, ecartEnJours, GARANTIES_APPEL_OFFRES, joursRestants, lienWhatsApp, montant, NATURES_DEMANDE_SITE,
  telephone, TYPES_CLIENT, TYPES_MARCHE,
} from "../../services/format";
import { useSession } from "../../session";

type Statut = "nouvelle" | "convertie" | "sans_suite";
type Onglet = Statut | "a_venir";

interface Marche {
  typeMarche: string;
  maitreOuvrage: string;
  objet: string;
  lieu?: string;
  montant?: number;
  dureeMois?: number;
  garanties: string[];
}

interface Demande {
  id: string;
  numero: number;
  nature: "devis" | "rappel_echeance" | "appel_offres";
  echeanceActuelle: string | null;
  dateLimiteOffre: string | null;
  appelOffres: Marche | null;
  aTraiterLe: string;
  branche: string;
  profil: string;
  nom: string;
  telephone: string;
  email: string | null;
  commune: string | null;
  besoin: string | null;
  accordTraitement: string;
  accordWhatsApp: string | null;
  recueLe: string;
  statut: Statut;
  motif: string | null;
  clientId: string | null;
  devisId: string | null;
  traiteeLe: string | null;
  traiteePar: string | null;
  aUnePiece?: boolean;
}

interface Detail {
  demande: Demande;
  piece: {
    type: string;
    taille: number;
    etatAnalyse: "a_analyser" | "saine" | "infectee";
    analyseeLe: string | null;
    signatureDetectee: string | null;
  } | null;
  clientsMemeNumero: { id: string; nom: string; type: string }[];
}

const ONGLETS: { statut: Onglet; titre: string }[] = [
  { statut: "nouvelle", titre: "À traiter" },
  { statut: "a_venir", titre: "Rappels à venir" },
  { statut: "convertie", titre: "Converties" },
  { statut: "sans_suite", titre: "Sans suite" },
];

const STATUTS: Record<Statut, { libelle: string; ton: "bleu" | "vert" | "gris" }> = {
  nouvelle: { libelle: "À traiter", ton: "bleu" },
  convertie: { libelle: "Convertie en devis", ton: "vert" },
  sans_suite: { libelle: "Sans suite", ton: "gris" },
};

const FORMATS_PIECE: Record<string, string> = { "image/jpeg": "photo JPEG", "image/png": "image PNG", "application/pdf": "PDF" };

function taille(octets: number): string {
  return octets >= 1024 * 1024 ? `${(octets / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(octets / 1024))} Ko`;
}

/** Ce que l'outil du site a recueilli, en une ligne pour la liste */
function Resume({ d }: { d: Demande }) {
  if (d.nature === "rappel_echeance" && d.echeanceActuelle) {
    return <>Contrat actuel à échéance le {dateCourte(d.echeanceActuelle)}{d.statut === "nouvelle" && ` · à rappeler dès le ${dateCourte(d.aTraiterLe)}`}</>;
  }
  if (d.nature === "appel_offres" && d.appelOffres && d.dateLimiteOffre) {
    return <>{d.appelOffres.maitreOuvrage} : {d.appelOffres.objet}<br /><DateLimite jour={d.dateLimiteOffre} /></>;
  }
  return <span className="message-relance">{d.besoin ?? "—"}</span>;
}

/** Date limite de dépôt d'une offre, en rouge à moins de 10 jours */
function DateLimite({ jour }: { jour: string }) {
  const reste = ecartEnJours(jour);
  return <Badge ton={reste < 10 ? "rouge" : "orange"}>Dépôt le {dateCourte(jour)} ({joursRestants(reste).replace("expiré depuis", "passé depuis")})</Badge>;
}

export function DemandesSite() {
  const [statut, setStatut] = useState<Onglet>("nouvelle");
  const [donnees, setDonnees] = useState<{ demandes: Demande[]; nouvelles: number; aVenir: number } | null>(null);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(async () => {
    setErreur("");
    try {
      setDonnees(await api(`/demandes-site?statut=${statut}`));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [statut]);
  useEffect(() => {
    void charger();
  }, [charger]);

  return (
    <>
      <h1>Demandes du site</h1>
      <p>
        Demandes envoyées par le site : devis, appels d'offres (en premier, date limite la plus proche d'abord) et rappels
        d'échéance, qui arrivent ici un mois avant l'échéance du visiteur. Rappelez-le, puis créez son devis ou classez la
        demande sans suite.
      </p>
      <div className="onglets" role="group" aria-label="Demandes affichées">
        {ONGLETS.map((onglet) => (
          <button
            key={onglet.statut}
            type="button"
            className={`bouton bouton--petit${statut === onglet.statut ? " bouton--principal" : ""}`}
            aria-pressed={statut === onglet.statut}
            onClick={() => setStatut(onglet.statut)}
          >
            {onglet.titre}{onglet.statut === "nouvelle" && donnees ? ` (${donnees.nouvelles})` : ""}
            {onglet.statut === "a_venir" && donnees ? ` (${donnees.aVenir})` : ""}
          </button>
        ))}
      </div>
      <Alerte>{erreur}</Alerte>
      {!donnees ? (
        !erreur && <Chargement />
      ) : donnees.demandes.length === 0 ? (
        <Vide>{statut === "nouvelle" ? "Aucune demande à traiter." : statut === "a_venir" ? "Aucun rappel en attente." : "Aucune demande."}</Vide>
      ) : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr><th>N°</th><th>Reçue le</th><th>Demandeur</th><th>Assurance</th><th>{statut === "nouvelle" || statut === "a_venir" ? "Besoin" : "Traitement"}</th></tr>
            </thead>
            <tbody>
              {donnees.demandes.map((d) => (
                <tr key={d.id}>
                  <td><Lien href={`/demandes-site/${d.id}`}>n° {d.numero}</Lien></td>
                  <td>{dateHeure(d.recueLe)}</td>
                  <td>
                    {d.nom}<br />
                    <span className="note">{TYPES_CLIENT[d.profil] ?? d.profil} · {telephone(d.telephone)}</span>
                  </td>
                  <td>
                    {BRANCHES[d.branche] ?? d.branche}
                    {d.nature !== "devis" && <><br /><Badge ton="bleu">{NATURES_DEMANDE_SITE[d.nature]}</Badge></>}
                    {d.aUnePiece && <><br /><Badge ton="bleu">Carte grise jointe</Badge></>}
                  </td>
                  <td>
                    {statut === "nouvelle" || statut === "a_venir" ? (
                      <Resume d={d} />
                    ) : (
                      <>
                        {d.traiteePar} · {d.traiteeLe && dateHeure(d.traiteeLe)}
                        {d.motif && <p className="message-relance">{d.motif}</p>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function DemandeSite({ id }: { id: string }) {
  const { peut } = useSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [branche, setBranche] = useState("");
  const [accord, setAccord] = useState(true);
  const [doublons, setDoublons] = useState<{ id: string; nom: string }[] | null>(null);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [telechargement, setTelechargement] = useState(false);

  const charger = useCallback(async () => {
    try {
      const resultat = await api<Detail>(`/demandes-site/${id}`);
      setDetail(resultat);
      setBranche(resultat.demande.branche);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [id]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function convertir(options: { clientId?: string; confirmerNouveauClient?: boolean } = {}) {
    if (!detail) return;
    setErreur("");
    setEnvoi(true);
    try {
      const resultat = await api<{ clientId: string; accordWhatsApp: boolean }>(`/demandes-site/${id}/conversion`, {
        corps: {
          ...options,
          branche,
          ...(detail.demande.accordWhatsApp ? { enregistrerAccordWhatsApp: accord } : {}),
        },
      });
      naviguer(`/clients/${resultat.clientId}`);
    } catch (e) {
      if (e instanceof ErreurApi && e.code === "doublon_possible") {
        setDoublons((e.donnees.doublons as { id: string; nom: string }[]) ?? []);
      } else {
        setErreur(messageErreur(e));
      }
    } finally {
      setEnvoi(false);
    }
  }

  // L'API analyse la pièce de nouveau avant de la remettre : un refus (menace trouvée, antivirus indisponible)
  // doit s'afficher comme un message, pas se télécharger comme un fichier
  async function telecharger() {
    setErreur("");
    setTelechargement(true);
    try {
      const reponse = await fetch(`/api/demandes-site/${id}/piece`, { credentials: "same-origin" });
      if (!reponse.ok) {
        const donnees = (await reponse.json().catch(() => ({}))) as { message?: string };
        setErreur(donnees.message ?? "Téléchargement impossible. Réessayez.");
        await charger();
        return;
      }
      const nom = /filename="([^"]+)"/.exec(reponse.headers.get("content-disposition") ?? "")?.[1] ?? "carte-grise";
      const adresse = URL.createObjectURL(await reponse.blob());
      const lien = document.createElement("a");
      lien.href = adresse;
      lien.download = nom;
      lien.click();
      setTimeout(() => URL.revokeObjectURL(adresse), 60_000);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setTelechargement(false);
    }
  }

  async function classer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    try {
      await api(`/demandes-site/${id}/sans-suite`, { corps: { motif } });
      setMessage("Demande classée sans suite.");
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  if (!detail) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const { demande: d, piece } = detail;
  const peutTraiter = d.statut === "nouvelle" && peut("gerant", "charge_clientele", "commercial");
  const memeNumero = doublons ?? detail.clientsMemeNumero;
  const optionsBranches = Object.entries(BRANCHES).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>);

  return (
    <>
      <p className="fil"><Lien href="/demandes-site">Demandes du site</Lien></p>
      <h1>{d.nature === "devis" ? "Demande" : NATURES_DEMANDE_SITE[d.nature]} n° {d.numero}</h1>
      <p>
        <Badge ton={STATUTS[d.statut].ton}>{STATUTS[d.statut].libelle}</Badge>{" "}
        Reçue le {dateHeure(d.recueLe)}
        {d.traiteeLe && <> · traitée le {dateHeure(d.traiteeLe)} par {d.traiteePar}</>}
      </p>
      {d.statut === "nouvelle" && ecartEnJours(d.aTraiterLe) > 0 && (
        <Alerte type="info">Rappel prévu à partir du {dateCourte(d.aTraiterLe)}, un mois avant l'échéance du visiteur.</Alerte>
      )}
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
      {d.statut === "sans_suite" && <Alerte type="info">Classée sans suite : {d.motif}</Alerte>}
      {d.statut === "convertie" && d.clientId && (
        <Alerte type="succes">Convertie en devis : <Lien href={`/clients/${d.clientId}`}>voir la fiche du client</Lien>.</Alerte>
      )}

      <Section titre="Le demandeur et son besoin">
        <dl className="details">
          <div><dt>Assurance</dt><dd>{BRANCHES[d.branche] ?? d.branche}</dd></div>
          <div><dt>Profil</dt><dd>{TYPES_CLIENT[d.profil] ?? d.profil}</dd></div>
          <div><dt>Nom</dt><dd>{d.nom}</dd></div>
          <div>
            <dt>Téléphone</dt>
            <dd>
              <a href={`tel:${d.telephone}`}>{telephone(d.telephone)}</a>{" · "}
              <a href={lienWhatsApp(d.telephone, messageWhatsApp(d))} target="_blank" rel="noopener noreferrer">
                Écrire sur WhatsApp
              </a>
            </dd>
          </div>
          {d.email && <div><dt>E-mail</dt><dd><a href={`mailto:${d.email}`}>{d.email}</a></dd></div>}
          {d.commune && <div><dt>Commune</dt><dd>{d.commune}</dd></div>}
          {d.echeanceActuelle && (
            <div><dt>Échéance de son contrat actuel</dt><dd>{dateCourte(d.echeanceActuelle)} ({joursRestants(ecartEnJours(d.echeanceActuelle)).replace("expiré depuis", "passée depuis")})</dd></div>
          )}
          {d.appelOffres && d.dateLimiteOffre && <DetailsMarche m={d.appelOffres} dateLimite={d.dateLimiteOffre} />}
          <div><dt>Besoin</dt><dd className="texte-libre">{d.besoin ?? "Non précisé"}</dd></div>
          <div>
            <dt>Carte grise</dt>
            <dd>
              {!piece ? (
                peut("auditeur") ? "Non consultable avec votre rôle" : "Aucune"
              ) : piece.etatAnalyse === "infectee" ? (
                <span className="texte-libre">
                  <Badge ton="rouge">Supprimée</Badge> L'antivirus y a trouvé une menace ({piece.signatureDetectee}) le {piece.analyseeLe && dateHeure(piece.analyseeLe)}.
                  Demandez une autre photo au client.
                </span>
              ) : (
                <>
                  <button type="button" className="bouton bouton--petit" disabled={telechargement} onClick={() => void telecharger()}>
                    {telechargement ? "Analyse et téléchargement…" : `Télécharger (${FORMATS_PIECE[piece.type] ?? piece.type}, ${taille(piece.taille)})`}
                  </button>
                  <br />
                  <span className="note">
                    {piece.etatAnalyse === "saine" && piece.analyseeLe
                      ? `Aucune menace trouvée par l'antivirus (dernière analyse le ${dateHeure(piece.analyseeLe)}) ; analysée de nouveau à chaque téléchargement.`
                      : "En attente d'analyse antivirus : elle ne peut pas être ouverte avant."}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
        <h3>Accords donnés sur le site</h3>
        <ul className="liste-simple">
          <li>{d.accordTraitement}</li>
          {d.accordWhatsApp ? <li>{d.accordWhatsApp}</li> : <li>Rappels sur WhatsApp : case non cochée.</li>}
        </ul>
      </Section>

      {peutTraiter && (
        <>
          <Section titre="Créer le devis">
            {memeNumero.length > 0 && (
              <Alerte type="info">
                Ce numéro est déjà enregistré : rattachez plutôt la demande à la fiche existante, pour ne pas créer de doublon.
              </Alerte>
            )}
            <div className="formulaire formulaire--grille">
              <Champ libelle="Branche du devis" aide="Celle choisie par le visiteur, à corriger si besoin.">
                <select value={branche} onChange={(e) => setBranche(e.target.value)}>{optionsBranches}</select>
              </Champ>
              {d.accordWhatsApp && (
                <label className="case-a-cocher">
                  <input type="checkbox" checked={accord} onChange={(e) => setAccord(e.target.checked)} />
                  Noter son accord pour les rappels WhatsApp (case cochée sur le site)
                </label>
              )}
            </div>
            <div className="formulaire__actions formulaire__actions--liste">
              {memeNumero.map((c) => (
                <button key={c.id} type="button" className="bouton bouton--principal" disabled={envoi} onClick={() => void convertir({ clientId: c.id })}>
                  Rattacher à la fiche de {c.nom}
                </button>
              ))}
              <button
                type="button"
                className={`bouton${memeNumero.length === 0 ? " bouton--principal" : ""}`}
                disabled={envoi}
                onClick={() => void convertir(memeNumero.length > 0 ? { confirmerNouveauClient: true } : {})}
              >
                {memeNumero.length > 0 ? "C'est une autre personne : créer une nouvelle fiche" : "Créer le client et le devis"}
              </button>
            </div>
          </Section>

          <Section titre="Classer sans suite">
            <form className="formulaire formulaire--ligne" onSubmit={(e) => void classer(e)}>
              <Champ libelle="Motif" aide="Par exemple : numéro injoignable après trois appels, demande en double, message publicitaire.">
                <input value={motif} onChange={(e) => setMotif(e.target.value)} minLength={3} maxLength={300} required />
              </Champ>
              <button type="submit" className="bouton">Classer sans suite</button>
            </form>
          </Section>
        </>
      )}
    </>
  );
}

function DetailsMarche({ m, dateLimite }: { m: Marche; dateLimite: string }) {
  return (
    <>
      <div><dt>Date limite de dépôt</dt><dd><DateLimite jour={dateLimite} /></dd></div>
      <div><dt>Marché</dt><dd>{TYPES_MARCHE[m.typeMarche] ?? m.typeMarche} · {m.objet}</dd></div>
      <div><dt>Maître d'ouvrage</dt><dd>{m.maitreOuvrage}</dd></div>
      {m.lieu && <div><dt>Lieu</dt><dd>{m.lieu}</dd></div>}
      {m.montant !== undefined && <div><dt>Montant estimé</dt><dd>{montant(m.montant)}</dd></div>}
      {m.dureeMois !== undefined && <div><dt>Durée</dt><dd>{m.dureeMois} mois</dd></div>}
      <div>
        <dt>Garanties demandées</dt>
        <dd><ul className="liste-simple">{m.garanties.map((g) => <li key={g}>{GARANTIES_APPEL_OFFRES[g] ?? g}</li>)}</ul></dd>
      </div>
    </>
  );
}

/** Premier message WhatsApp, selon ce que le visiteur a demandé */
function messageWhatsApp(d: Demande): string {
  const bonjour = `Bonjour ${d.nom}, ici DBS-ASSURANCES.`;
  if (d.nature === "rappel_echeance" && d.echeanceActuelle) {
    return `${bonjour} Vous nous avez demandé de vous rappeler avant l'échéance de votre assurance, le ${dateCourte(d.echeanceActuelle)} : pouvons-nous préparer votre devis ?`;
  }
  if (d.nature === "appel_offres" && d.appelOffres) {
    return `${bonjour} Nous avons bien reçu votre demande pour l'appel d'offres « ${d.appelOffres.objet} » (demande n° ${d.numero}). Pouvez-vous nous envoyer le cahier des charges ?`;
  }
  return `${bonjour} Nous avons bien reçu votre demande de devis n° ${d.numero}.`;
}

// Demandes de devis reçues par le site (tâche 7) : à traiter dans l'ordre d'arrivée. Chacune devient un
// client et un devis (ou rejoint la fiche du client qui a déjà ce numéro), ou est classée sans suite.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Chargement, Champ, Section, Vide } from "../../composants/communs";
import { Lien, naviguer } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import { BRANCHES, dateHeure, lienWhatsApp, telephone, TYPES_CLIENT } from "../../services/format";
import { useSession } from "../../session";

type Statut = "nouvelle" | "convertie" | "sans_suite";

interface Demande {
  id: string;
  numero: number;
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
  piece: { type: string; taille: number } | null;
  clientsMemeNumero: { id: string; nom: string; type: string }[];
}

const ONGLETS: { statut: Statut; titre: string }[] = [
  { statut: "nouvelle", titre: "À traiter" },
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

export function DemandesSite() {
  const [statut, setStatut] = useState<Statut>("nouvelle");
  const [donnees, setDonnees] = useState<{ demandes: Demande[]; nouvelles: number } | null>(null);
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
        Demandes de devis envoyées par le formulaire du site, à traiter dans l'ordre d'arrivée : rappelez le visiteur,
        puis créez son devis ou classez la demande sans suite.
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
          </button>
        ))}
      </div>
      <Alerte>{erreur}</Alerte>
      {!donnees ? (
        !erreur && <Chargement />
      ) : donnees.demandes.length === 0 ? (
        <Vide>{statut === "nouvelle" ? "Aucune demande à traiter." : "Aucune demande."}</Vide>
      ) : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr><th>N°</th><th>Reçue le</th><th>Demandeur</th><th>Assurance</th><th>{statut === "nouvelle" ? "Besoin" : "Traitement"}</th></tr>
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
                    {d.aUnePiece && <><br /><Badge ton="bleu">Carte grise jointe</Badge></>}
                  </td>
                  <td>
                    {statut === "nouvelle" ? (
                      <span className="message-relance">{d.besoin ?? "—"}</span>
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
      <h1>Demande n° {d.numero}</h1>
      <p>
        <Badge ton={STATUTS[d.statut].ton}>{STATUTS[d.statut].libelle}</Badge>{" "}
        Reçue le {dateHeure(d.recueLe)}
        {d.traiteeLe && <> · traitée le {dateHeure(d.traiteeLe)} par {d.traiteePar}</>}
      </p>
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
              <a href={lienWhatsApp(d.telephone, `Bonjour ${d.nom}, ici DBS-ASSURANCES : nous avons bien reçu votre demande de devis n° ${d.numero}.`)} target="_blank" rel="noopener noreferrer">
                Écrire sur WhatsApp
              </a>
            </dd>
          </div>
          {d.email && <div><dt>E-mail</dt><dd><a href={`mailto:${d.email}`}>{d.email}</a></dd></div>}
          {d.commune && <div><dt>Commune</dt><dd>{d.commune}</dd></div>}
          <div><dt>Besoin</dt><dd className="texte-libre">{d.besoin ?? "Non précisé"}</dd></div>
          <div>
            <dt>Carte grise</dt>
            <dd>
              {piece ? (
                <a className="bouton bouton--petit" href={`/api/demandes-site/${d.id}/piece`} download>
                  Télécharger ({FORMATS_PIECE[piece.type] ?? piece.type}, {taille(piece.taille)})
                </a>
              ) : peut("auditeur") ? "Non consultable avec votre rôle" : "Aucune"}
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

// Relances : ce que le planificateur a envoyé ou va envoyer (WhatsApp, SMS), et ce qui reste à faire
// à la main parce que le client n'a pas accepté de canal. Le message est montré tel que le client le lit.

import { useCallback, useEffect, useState } from "react";
import { Alerte, Badge, Chargement, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, messageErreur } from "../../services/api";
import { CANAUX_RELANCE, dateHeure, lienWhatsApp, STATUTS_RELANCE, telephone, TYPES_RELANCE } from "../../services/format";
import { useSession } from "../../session";

type Statut = "a_envoyer" | "envoyee" | "remise" | "lue" | "echec" | "annulee";

interface Relance {
  id: string;
  type: string;
  canal: string;
  statut: Statut;
  clientId: string;
  clientNom: string;
  destinataire: string;
  motif: string | null;
  tentatives: number;
  planifieeLe: string;
  envoyeeLe: string | null;
  annuleePar: string | null;
  texte: string | null;
}

interface AFaire {
  cle: string;
  type: string;
  clientId: string;
  clientNom: string;
  telephone: string;
  texte: string | null;
}

interface DonneesRelances {
  configuration: { canaux: string[]; simulation: boolean; heuresEnvoi: { debut: number; fin: number } };
  resume: Record<Statut, number>;
  relances: Relance[];
  aFaireALaMain: AFaire[];
}

interface Bilan {
  dejaEnCours: boolean;
  planifiees: number;
  horsHeures: boolean;
  envoyees: number;
  erreurs: number;
}

const CARTES: { statut: Statut; titre: string; ton: "bleu" | "gris" | "vert" | "rouge" }[] = [
  { statut: "a_envoyer", titre: "À envoyer", ton: "bleu" },
  { statut: "envoyee", titre: "Envoyées", ton: "gris" },
  { statut: "remise", titre: "Remises", ton: "vert" },
  { statut: "lue", titre: "Lues", ton: "vert" },
  { statut: "echec", titre: "En échec", ton: "rouge" },
];

function tonStatut(statut: Statut) {
  return statut === "lue" || statut === "remise" ? "vert" : statut === "echec" ? "rouge" : statut === "a_envoyer" ? "bleu" : "gris";
}

function pluriel(nombre: number, mot: string) {
  return `${nombre} ${mot}${nombre > 1 ? "s" : ""}`;
}

function resumeBilan(bilan: Bilan): string {
  if (bilan.dejaEnCours) return "Un envoi est déjà en cours : réessayez dans une minute.";
  const parties = [`${pluriel(bilan.planifiees, "relance")} ${bilan.planifiees > 1 ? "planifiées" : "planifiée"}`];
  if (bilan.horsHeures) parties.push("hors des heures d'envoi : elles partiront à la reprise");
  else parties.push(`${pluriel(bilan.envoyees, "message")} ${bilan.envoyees > 1 ? "envoyés" : "envoyé"}`);
  if (bilan.erreurs > 0) parties.push(`${pluriel(bilan.erreurs, "erreur")} (nouvel essai automatique)`);
  return `${parties.join(", ")}.`;
}

export function Relances() {
  const { peut } = useSession();
  const [donnees, setDonnees] = useState<DonneesRelances | null>(null);
  const [filtre, setFiltre] = useState<Statut | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(async () => {
    try {
      setDonnees(await api<DonneesRelances>(`/relances${filtre ? `?statut=${filtre}` : ""}`));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [filtre]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function lancer() {
    setErreur("");
    setMessage("");
    setEnvoi(true);
    try {
      const { bilan } = await api<{ bilan: Bilan }>("/relances/cycle", { corps: {} });
      setMessage(resumeBilan(bilan));
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  async function annuler(relance: Relance) {
    setErreur("");
    setMessage("");
    try {
      await api(`/relances/${relance.id}/annulation`, { corps: {} });
      setMessage(`Relance de ${relance.clientNom} annulée : elle ne partira pas.`);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  if (!donnees) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const { configuration } = donnees;
  const actifs = configuration.canaux.map((c) => CANAUX_RELANCE[c] ?? c).join(" et ");

  return (
    <>
      <h1>Relances</h1>
      <p>
        Échéances (J-30, J-15, J-7, le jour même, contrat expiré), devis restés sans réponse et avancement des sinistres :
        les clients qui l'ont accepté sont prévenus automatiquement, une seule fois par étape,
        entre {configuration.heuresEnvoi.debut} h et {configuration.heuresEnvoi.fin} h.
      </p>
      {configuration.simulation && <Alerte type="info">Mode simulation : les relances sont enregistrées, mais aucun message ne part.</Alerte>}
      {configuration.canaux.length === 0 ? (
        <Alerte type="info">
          L'envoi automatique n'est pas encore branché (compte WhatsApp Business de l'agence à faire valider par Meta).
          En attendant, les relances dues sont ci-dessous, avec le message prêt à envoyer.
        </Alerte>
      ) : (
        <div className="formulaire--ligne">
          <span>Envoi automatique par <strong>{actifs}</strong>, toutes les 15 minutes.</span>
          {peut("gerant") && (
            <button type="button" className="bouton bouton--principal bouton--petit" disabled={envoi} onClick={() => void lancer()}>
              {envoi ? "Envoi en cours…" : "Lancer les relances maintenant"}
            </button>
          )}
        </div>
      )}
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>

      <div className="cartes">
        {CARTES.map((carte) => (
          <button
            key={carte.statut}
            type="button"
            className={`carte carte--${carte.ton}${filtre === carte.statut ? " carte--active" : ""}`}
            aria-pressed={filtre === carte.statut}
            onClick={() => setFiltre(filtre === carte.statut ? null : carte.statut)}
          >
            <span className="carte__nombre">{donnees.resume[carte.statut]}</span>
            <span className="carte__titre">{carte.titre}</span>
          </button>
        ))}
      </div>

      <Section titre="À faire à la main">
        {donnees.aFaireALaMain.length === 0 ? (
          <Vide>Aucune relance en attente d'un accord du client.</Vide>
        ) : (
          <>
            <p className="note">
              Ces clients n'ont pas accepté les rappels {configuration.canaux.length > 0 ? `par ${configuration.canaux.map((c) => CANAUX_RELANCE[c] ?? c).join(" ou ")}` : "automatiques"} :
              relancez-les vous-même, et demandez-leur leur accord (sur leur fiche) pour la prochaine fois.
            </p>
            <div className="tableau-defilant">
              <table className="tableau">
                <thead><tr><th>Client</th><th>Relance</th><th>Contact</th></tr></thead>
                <tbody>
                  {donnees.aFaireALaMain.map((ligne) => (
                    <tr key={ligne.cle}>
                      <td><Lien href={`/clients/${ligne.clientId}`}>{ligne.clientNom}</Lien></td>
                      <td>
                        {TYPES_RELANCE[ligne.type] ?? ligne.type}
                        {ligne.texte && <p className="message-relance">{ligne.texte}</p>}
                      </td>
                      <td>
                        <a href={`tel:${ligne.telephone}`}>{telephone(ligne.telephone)}</a><br />
                        {ligne.texte && (
                          <a href={lienWhatsApp(ligne.telephone, ligne.texte)} target="_blank" rel="noopener noreferrer">Relancer sur WhatsApp</a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section titre={filtre ? `Relances : ${STATUTS_RELANCE[filtre]?.toLowerCase()}` : "Relances planifiées et envoyées"}>
        {donnees.relances.length === 0 ? (
          <Vide>Aucune relance {filtre ? "dans cette catégorie" : "pour l'instant"}.</Vide>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Date</th><th>Client</th><th>Relance</th><th>Canal</th><th>Statut</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {donnees.relances.map((r) => (
                  <tr key={r.id}>
                    <td>{dateHeure(r.envoyeeLe ?? r.planifieeLe)}</td>
                    <td><Lien href={`/clients/${r.clientId}`}>{r.clientNom}</Lien><br /><small>{telephone(r.destinataire)}</small></td>
                    <td>
                      {TYPES_RELANCE[r.type] ?? r.type}
                      {r.texte && <p className="message-relance">{r.texte}</p>}
                    </td>
                    <td>{CANAUX_RELANCE[r.canal] ?? r.canal}</td>
                    <td>
                      <Badge ton={tonStatut(r.statut)}>{STATUTS_RELANCE[r.statut] ?? r.statut}</Badge>
                      {r.motif && <p className="message-relance">{r.motif}</p>}
                      {r.annuleePar && <p className="message-relance">par {r.annuleePar}</p>}
                    </td>
                    <td>
                      {r.statut === "a_envoyer" && peut("gerant", "charge_clientele") && (
                        <button type="button" className="bouton bouton--petit" onClick={() => void annuler(r)}>Annuler</button>
                      )}
                    </td>
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

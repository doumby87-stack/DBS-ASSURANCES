// Tableau de bord : les contrats à renouveler (expirés, J-7, J-15, J-30) et les documents de véhicules
// à renouveler. C'est l'outil qui tient la promesse du site : « nous surveillons vos échéances ».

import { useCallback, useEffect, useState } from "react";
import { Alerte, Badge, Chargement, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, messageErreur } from "../../services/api";
import { BRANCHES, DOCUMENTS_VEHICULE, dateCourte, joursRestants, lienWhatsApp, telephone } from "../../services/format";
import { useSession } from "../../session";

type Categorie = "expire" | "j7" | "j15" | "j30" | "j60";

interface EcheanceContrat {
  contratId: string;
  clientId: string;
  clientNom: string;
  telephone: string;
  numeroPolice: string | null;
  branche: string;
  dateEcheance: string;
  joursRestants: number;
  categorie: Categorie;
}

interface EcheanceVehicule {
  vehiculeId: string;
  clientId: string;
  clientNom: string;
  telephone: string;
  immatriculation: string;
  document: string;
  echeance: string;
  joursRestants: number;
  categorie: Categorie;
}

interface Echeances {
  resume: Record<Categorie, number>;
  contrats: EcheanceContrat[];
  vehicules: EcheanceVehicule[];
}

const CARTES: { categorie: Categorie; titre: string; ton: "rouge" | "orange" | "bleu" | "gris" }[] = [
  { categorie: "expire", titre: "Expirés, non renouvelés", ton: "rouge" },
  { categorie: "j7", titre: "Dans 7 jours", ton: "orange" },
  { categorie: "j15", titre: "Dans 15 jours", ton: "bleu" },
  { categorie: "j30", titre: "Dans 30 jours", ton: "gris" },
];

function ton(categorie: Categorie) {
  return categorie === "expire" ? "rouge" : categorie === "j7" ? "orange" : categorie === "j15" ? "bleu" : "gris";
}

export function TableauDeBord() {
  const { peut } = useSession();
  const [donnees, setDonnees] = useState<Echeances | null>(null);
  const [filtre, setFiltre] = useState<Categorie | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  const charger = useCallback(async () => {
    try {
      setDonnees(await api<Echeances>("/echeances"));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function renouveler(ligne: EcheanceContrat) {
    setErreur("");
    setMessage("");
    try {
      await api(`/contrats/${ligne.contratId}/renouveler`, { corps: {} });
      setMessage(`Renouvellement préparé pour ${ligne.clientNom} : le nouveau contrat attend le paiement de la prime.`);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  if (!donnees) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const contrats = donnees.contrats.filter((c) => (filtre ? c.categorie === filtre : c.categorie !== "j60"));

  return (
    <>
      <h1>Échéances</h1>
      <div className="cartes">
        {CARTES.map((carte) => (
          <button
            key={carte.categorie}
            type="button"
            className={`carte carte--${carte.ton}${filtre === carte.categorie ? " carte--active" : ""}`}
            aria-pressed={filtre === carte.categorie}
            onClick={() => setFiltre(filtre === carte.categorie ? null : carte.categorie)}
          >
            <span className="carte__nombre">{donnees.resume[carte.categorie]}</span>
            <span className="carte__titre">{carte.titre}</span>
          </button>
        ))}
      </div>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>

      <Section titre="Contrats à renouveler">
        {contrats.length === 0 ? (
          <Vide>Aucun contrat à renouveler {filtre ? "dans cette catégorie" : "dans les 30 prochains jours"}.</Vide>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Client</th><th>Contrat</th><th>Échéance</th><th>Contact</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {contrats.map((ligne) => (
                  <tr key={ligne.contratId}>
                    <td><Lien href={`/clients/${ligne.clientId}`}>{ligne.clientNom}</Lien></td>
                    <td>{BRANCHES[ligne.branche] ?? ligne.branche}<br /><small>{ligne.numeroPolice ?? "n° de police à saisir"}</small></td>
                    <td>{dateCourte(ligne.dateEcheance)}<br /><Badge ton={ton(ligne.categorie)}>{joursRestants(ligne.joursRestants)}</Badge></td>
                    <td>
                      <a href={`tel:${ligne.telephone}`}>{telephone(ligne.telephone)}</a><br />
                      <a
                        href={lienWhatsApp(ligne.telephone,
                          `Bonjour ${ligne.clientNom}, votre assurance ${(BRANCHES[ligne.branche] ?? "").toLowerCase()}` +
                          `${ligne.numeroPolice ? ` (police ${ligne.numeroPolice})` : ""} arrive à échéance le ${dateCourte(ligne.dateEcheance)}. ` +
                          "DBS-ASSURANCES vous propose de la renouveler : répondez à ce message ou appelez le 07 49 36 07 02.")}
                        target="_blank" rel="noopener noreferrer"
                      >
                        Relancer sur WhatsApp
                      </a>
                    </td>
                    <td>
                      {peut("gerant", "charge_clientele") && (
                        <button type="button" className="bouton bouton--petit" onClick={() => void renouveler(ligne)}>Renouveler</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section titre="Documents des véhicules à renouveler">
        {donnees.vehicules.length === 0 ? (
          <Vide>Aucune visite technique, vignette ou carte de transport à renouveler dans les 60 prochains jours.</Vide>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Client</th><th>Véhicule</th><th>Document</th><th>Échéance</th></tr></thead>
              <tbody>
                {donnees.vehicules.map((ligne) => (
                  <tr key={`${ligne.vehiculeId}-${ligne.document}`}>
                    <td><Lien href={`/clients/${ligne.clientId}`}>{ligne.clientNom}</Lien></td>
                    <td>{ligne.immatriculation}</td>
                    <td>{DOCUMENTS_VEHICULE[ligne.document] ?? ligne.document}</td>
                    <td>{dateCourte(ligne.echeance)} <Badge ton={ton(ligne.categorie)}>{joursRestants(ligne.joursRestants)}</Badge></td>
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

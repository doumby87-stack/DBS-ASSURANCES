// Un véhicule : ses documents, ses périodes de couverture (avec l'attestation de chacune) et l'historique
// de ses sinistres, du plus récent au plus ancien.

import { useEffect, useState } from "react";
import { api, ErreurApi, messageErreur } from "../api";
import { Alerte, Badge, Chargement, Echeance } from "../composants";
import { dateCourte, NATURES_SINISTRE, STATUTS_CONTRAT, STATUTS_SINISTRE } from "../format";
import { Lien } from "../routeur";
import type { VehiculeFlotte } from "./TableauDeBord";

interface Detail {
  vehicule: VehiculeFlotte & { numeroChassis: string | null; usage: string | null; puissanceFiscale: number | null };
  periodes: {
    ligneId: string; numeroPolice: string | null; statutContrat: string; ajouteLe: string; jusquAu: string; retire: boolean;
    numeroAttestation: string | null; attestationDisponible: boolean;
  }[];
  sinistres: {
    id: string; survenuLe: string; declareLe: string; nature: string; statut: string; dommagesCorporels: boolean;
    referenceCompagnie: string | null; numeroPolice: string | null;
  }[];
}

const SINISTRE_CLOS = new Set(["regle", "refuse", "classe_sans_suite"]);

export function Vehicule({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setDetail(null);
    api<Detail>(`/portail/vehicules/${id}`).then(setDetail).catch((e: unknown) => {
      setErreur(e instanceof ErreurApi && e.statut === 404 ? "Ce véhicule ne fait pas partie de vos véhicules assurés." : messageErreur(e));
    });
  }, [id]);

  if (!detail) return erreur ? <><Alerte>{erreur}</Alerte><p><Lien href="/">Retour à l'accueil</Lien></p></> : <Chargement />;
  const { vehicule: v } = detail;

  return (
    <>
      <p className="fil"><Lien href="/">Accueil</Lien></p>
      <h1>{v.immatriculation}</h1>
      <dl className="fiche">
        <div><dt>Véhicule</dt><dd>{[v.marque, v.modele, v.genre].filter(Boolean).join(" · ") || "—"}</dd></div>
        {v.usage && <div><dt>Usage</dt><dd>{v.usage}</dd></div>}
        {v.puissanceFiscale && <div><dt>Puissance fiscale</dt><dd>{v.puissanceFiscale} CV</dd></div>}
        {v.numeroChassis && <div><dt>N° de châssis</dt><dd>{v.numeroChassis}</dd></div>}
        <div><dt>Visite technique</dt><dd><Echeance date={v.echeanceVisiteTechnique} /></dd></div>
        <div><dt>Vignette</dt><dd><Echeance date={v.echeanceVignette} /></dd></div>
        <div><dt>Carte de transport</dt><dd><Echeance date={v.echeanceCarteTransport} /></dd></div>
      </dl>

      <section className="section" aria-labelledby="titre-couverture">
        <h2 id="titre-couverture">Couverture</h2>
        {detail.periodes.length === 0 ? <p className="note">Ce véhicule n'est assuré par aucun contrat de l'agence.</p> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Contrat</th><th>Période</th><th>Attestation</th></tr></thead>
              <tbody>
                {detail.periodes.map((p) => (
                  <tr key={p.ligneId}>
                    <td>{p.numeroPolice ?? "N° à venir"}<br /><Badge ton={p.statutContrat === "en_vigueur" && !p.retire ? "vert" : "gris"}>
                      {p.retire ? "Retiré du contrat" : STATUTS_CONTRAT[p.statutContrat] ?? p.statutContrat}</Badge></td>
                    <td>du {dateCourte(p.ajouteLe)}<br />au {dateCourte(p.jusquAu)}</td>
                    <td>
                      {p.attestationDisponible ? (
                        <a href={`/api/portail/attestations/${p.ligneId}`} download>{p.numeroAttestation} (PDF)</a>
                      ) : p.numeroAttestation ?? <span className="note">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="titre-sinistres">
        <h2 id="titre-sinistres">Historique des sinistres</h2>
        {detail.sinistres.length === 0 ? <p className="note">Aucun sinistre déclaré pour ce véhicule.</p> : (
          <ol className="historique">
            {detail.sinistres.map((s) => (
              <li key={s.id}>
                <p>
                  <strong>{NATURES_SINISTRE[s.nature] ?? s.nature}</strong> le {dateCourte(s.survenuLe)}
                  {s.dommagesCorporels && " · avec dommages corporels"}
                </p>
                <p>
                  <Badge ton={SINISTRE_CLOS.has(s.statut) ? "gris" : "orange"}>{STATUTS_SINISTRE[s.statut] ?? s.statut}</Badge>
                  <span className="note"> Déclaré le {dateCourte(s.declareLe)}{s.numeroPolice && ` · contrat ${s.numeroPolice}`}
                    {s.referenceCompagnie && ` · référence de la compagnie ${s.referenceCompagnie}`}</span>
                </p>
              </li>
            ))}
          </ol>
        )}
        <p className="actions">
          <Lien href={`/sinistres/declarer?vehicule=${v.id}`} className="bouton bouton--principal">Déclarer un sinistre pour ce véhicule</Lien>
          <Lien href="/sinistres" className="bouton">Suivre vos sinistres</Lien>
        </p>
      </section>
    </>
  );
}

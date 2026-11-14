// Accueil de l'espace client : les chiffres qui comptent, les attestations (en lot pour une flotte), les
// contrats, leur reste à payer et le paiement en ligne, chaque véhicule avec ses échéances, son attestation et
// ses sinistres. Une entreprise y voit sa flotte ; un particulier, ses contrats.

import { useEffect, useState } from "react";
import { api, messageErreur } from "../api";
import { Alerte, Badge, Carte, Chargement, Echeance } from "../composants";
import { BRANCHES, dateCourte, montant, STATUTS_CONTRAT, type EcheancierPortail, montantAPayer } from "../format";
import { Lien } from "../routeur";

export interface VehiculeFlotte {
  id: string;
  immatriculation: string;
  marque: string | null;
  modele: string | null;
  genre: string | null;
  echeanceVisiteTechnique: string | null;
  echeanceVignette: string | null;
  echeanceCarteTransport: string | null;
  ligneId: string | null;
  contratId: string | null;
  numeroPolice: string | null;
  statutContrat: string | null;
  numeroAttestation: string | null;
  attestationDisponible: boolean;
  sinistres: number;
  sinistresEnCours: number;
}

interface Flotte {
  entreprise: string;
  typeClient: "particulier" | "professionnel" | "entreprise";
  paiementEnLigne: boolean;
  vehicules: VehiculeFlotte[];
  contrats: {
    id: string; numeroPolice: string | null; branche: string; statut: string; dateEffet: string; dateEcheance: string;
    primeDue: number; resteAPayer: number; vehicules: number; paiementEnCours: string | null;
    echeancier: EcheancierPortail | null;
  }[];
  resume: { vehicules: number; vehiculesAssures: number; documentsARenouveler: number; sinistresEnCours: number; resteAPayer: number };
}

export function TableauDeBord() {
  const [flotte, setFlotte] = useState<Flotte | null>(null);
  const [erreur, setErreur] = useState("");
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    api<Flotte>("/portail/flotte").then(setFlotte).catch((e: unknown) => setErreur(messageErreur(e)));
  }, []);

  if (!flotte) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const { resume } = flotte;
  const filtre = recherche.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const vehicules = filtre
    ? flotte.vehicules.filter((v) => `${v.immatriculation}${v.marque ?? ""}${v.modele ?? ""}`.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(filtre))
    : flotte.vehicules;
  const attestations = flotte.vehicules.filter((v) => v.attestationDisponible).length;
  const particulier = flotte.typeClient === "particulier";
  // Prime payée en plusieurs fois : « à payer » seulement quand une échéance est due ou proche (15 jours)
  const echeanceProche = (k: Flotte["contrats"][number]) =>
    !k.echeancier?.echeances.length || !!k.echeancier.aPayerMaintenant || (k.echeancier.prochaine?.jours ?? 99) <= 15;
  const payable = (k: Flotte["contrats"][number]) =>
    flotte.paiementEnLigne && k.resteAPayer > 0 && (k.statut === "en_attente_paiement" || k.statut === "en_vigueur") && echeanceProche(k);
  const aPayer = flotte.contrats.filter(payable);

  return (
    <>
      <h1>{particulier ? "Vos contrats" : "Votre flotte"}</h1>
      <div className="cartes">
        <Carte ton="bleu" nombre={`${resume.vehiculesAssures} / ${resume.vehicules}`} titre="Véhicules assurés" />
        <Carte ton={resume.documentsARenouveler > 0 ? "orange" : "vert"} nombre={resume.documentsARenouveler} titre="Documents à renouveler sous 30 jours" />
        <Carte ton={resume.sinistresEnCours > 0 ? "orange" : "vert"} nombre={resume.sinistresEnCours} titre="Sinistres en cours" />
        <Carte ton={resume.resteAPayer > 0 ? "rouge" : "vert"} nombre={montant(resume.resteAPayer)} titre="Reste à payer" />
      </div>

      {aPayer.length > 0 && (
        <section className="section section--a-payer" aria-labelledby="titre-a-payer">
          <h2 id="titre-a-payer">À payer</h2>
          <ul className="a-payer">
            {aPayer.map((k) => (
              <li key={k.id}>
                <span>
                  Contrat <strong>{k.numeroPolice ?? "N° à venir"}</strong> · {BRANCHES[k.branche] ?? k.branche} :{" "}
                  <strong>{montant(montantAPayer(k.resteAPayer, k.echeancier))}</strong>
                  {k.echeancier?.prochaine && (
                    <span className="note"><br />
                      Échéance {k.echeancier.prochaine.rang} sur {k.echeancier.echeances.length}
                      {k.echeancier.prochaine.jours < 0 ? `, en retard depuis le ${dateCourte(k.echeancier.prochaine.exigibleLe)}` : `, à payer avant le ${dateCourte(k.echeancier.prochaine.exigibleLe)}`}.
                    </span>
                  )}
                  {k.statut === "en_attente_paiement" && (
                    <span className="note"><br />{k.echeancier?.echeances.length
                      ? "Le contrat entre en vigueur une fois la première échéance payée."
                      : "Le contrat entre en vigueur une fois la prime payée."}</span>
                  )}
                </span>
                {k.paiementEnCours ? (
                  <Lien href={`/paiements/${k.paiementEnCours}`} className="bouton">Paiement en cours : voir</Lien>
                ) : (
                  <Lien href={`/payer/${k.id}`} className="bouton bouton--principal"
                    aria-label={`Payer en ligne le contrat ${k.numeroPolice ?? ""}`}>Payer en ligne</Lien>
                )}
              </li>
            ))}
          </ul>
          <p className="note">Wave, Orange Money, MTN MoMo ou Moov Money, depuis votre téléphone. Vous pouvez aussi payer à l'agence.</p>
        </section>
      )}

      <section className="section" aria-labelledby="titre-attestations">
        <h2 id="titre-attestations">Attestations d'assurance</h2>
        <p>
          {attestations === 0
            ? "Aucune attestation disponible pour l'instant : l'agence les dépose ici dès qu'elles sont émises."
            : `${attestations} attestation(s) disponible(s), à imprimer ou à garder dans chaque véhicule.`}
        </p>
        <div className="actions">
          {attestations > 0 && (
            <a className="bouton bouton--principal" href="/api/portail/attestations.zip" download>Télécharger toutes les attestations (ZIP)</a>
          )}
          {!particulier && <a className="bouton" href="/api/portail/flotte.csv" download>Exporter la liste des véhicules (Excel)</a>}
        </div>
      </section>

      <section className="section" aria-labelledby="titre-sinistre">
        <div className="section__entete">
          <h2 id="titre-sinistre">Un accident, un vol, un incendie ?</h2>
          <Lien href="/sinistres/declarer" className="bouton bouton--principal">Déclarer un sinistre</Lien>
        </div>
        <p className="note">Déclarez-le en ligne, avec vos photos et le constat amiable : l'agence le reçoit aussitôt et le transmet à la compagnie.</p>
      </section>

      <section className="section" aria-labelledby="titre-contrats">
        <h2 id="titre-contrats">Contrats</h2>
        {flotte.contrats.length === 0 ? <p className="note">Aucun contrat en cours.</p> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Contrat</th><th>Période</th><th>Véhicules</th><th>Prime due</th><th>Reste à payer</th></tr></thead>
              <tbody>
                {flotte.contrats.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <strong>{k.numeroPolice ?? "N° à venir"}</strong> · {BRANCHES[k.branche] ?? k.branche}
                      <br /><Badge ton={k.statut === "en_vigueur" ? "vert" : k.statut === "en_attente_paiement" ? "orange" : "gris"}>{STATUTS_CONTRAT[k.statut] ?? k.statut}</Badge>
                    </td>
                    <td>du {dateCourte(k.dateEffet)}<br />au {dateCourte(k.dateEcheance)}</td>
                    <td>{k.vehicules}</td>
                    <td>{montant(k.primeDue)}</td>
                    <td>
                      {k.resteAPayer > 0 ? <strong>{montant(k.resteAPayer)}</strong> : k.resteAPayer < -4 ? `Trop-perçu ${montant(-k.resteAPayer)}` : "Payé"}
                      {k.echeancier && k.echeancier.echeances.length > 0 && (
                        <><br /><small>
                          En {k.echeancier.echeances.length} fois
                          {k.echeancier.prochaine && ` · prochaine échéance ${montant(k.echeancier.prochaine.reste)} le ${dateCourte(k.echeancier.prochaine.exigibleLe)}`}
                        </small></>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="titre-vehicules">
        <div className="section__entete">
          <h2 id="titre-vehicules">Véhicules</h2>
          <label className="recherche">
            <span className="visuellement-cache">Rechercher un véhicule</span>
            <input type="search" placeholder="Plaque, marque…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          </label>
        </div>
        {vehicules.length === 0 ? <p className="note">Aucun véhicule {filtre ? "ne correspond à cette recherche" : ""}.</p> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr><th>Véhicule</th><th>Contrat</th><th>Attestation</th><th>Visite technique</th><th>Vignette</th><th>Carte de transport</th><th>Sinistres</th></tr>
              </thead>
              <tbody>
                {vehicules.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Lien href={`/vehicules/${v.id}`}><strong>{v.immatriculation}</strong></Lien>
                      {(v.marque || v.modele) && <span className="note"><br />{[v.marque, v.modele].filter(Boolean).join(" ")}</span>}
                    </td>
                    <td>{v.numeroPolice ?? <Badge ton="gris">Non assuré</Badge>}</td>
                    <td>
                      {v.attestationDisponible && v.ligneId ? (
                        <a href={`/api/portail/attestations/${v.ligneId}`} download aria-label={`Attestation ${v.numeroAttestation} de ${v.immatriculation} (PDF)`}>
                          {v.numeroAttestation}
                        </a>
                      ) : v.numeroPolice ? <span className="note">À venir</span> : <span className="note">—</span>}
                    </td>
                    <td><Echeance date={v.echeanceVisiteTechnique} /></td>
                    <td><Echeance date={v.echeanceVignette} /></td>
                    <td><Echeance date={v.echeanceCarteTransport} /></td>
                    <td>
                      {v.sinistres === 0 ? <span className="note">Aucun</span>
                        : <Lien href={`/vehicules/${v.id}`}>{v.sinistres}{v.sinistresEnCours > 0 && ` dont ${v.sinistresEnCours} en cours`}</Lien>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">
          Rappel gratuit : si vous l'avez accepté, l'agence vous prévient sur WhatsApp à J-30, à J-7 et à l'échéance de chaque document
          {particulier ? "." : ", en un seul message pour toute la flotte."}
        </p>
      </section>
    </>
  );
}

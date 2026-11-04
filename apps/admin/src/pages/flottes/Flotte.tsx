// Flotte d'un client (tâche 8) : import de la liste des véhicules (Excel ou CSV, contrôlée ligne par ligne
// avant tout enregistrement), échéances des documents, export pour la cotation en lot, composition des
// contrats et avenants au prorata : incorporation, retrait, réintégration et annulation.

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Alerte, Badge, Chargement, Champ, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import { aujourdHui, BRANCHES, dateCourte, dateHeure, montant, STATUTS_CONTRAT } from "../../services/format";
import { useSession } from "../../session";

interface Vehicule {
  id: string;
  immatriculation: string;
  marque: string | null;
  modele: string | null;
  genre: string | null;
  puissanceFiscale: number | null;
  valeurVenale: number | null;
  echeanceVisiteTechnique: string | null;
  echeanceVignette: string | null;
  echeanceCarteTransport: string | null;
  policeEnCours: string | null;
  sinistres: { id: string; survenuLe: string; nature: string; statut: string }[];
}

interface LigneContrat {
  ligneId: string;
  vehiculeId: string;
  immatriculation: string;
  ajouteLe: string;
  retireLe: string | null;
  primeVehicule: number | null;
  numeroAttestation: string | null;
  /** Attestation PDF déposée : analysée (« saine ») ou en attente d'analyse */
  attestation: "saine" | "a_analyser" | null;
}

type Mouvement = "incorporation" | "retrait";
const MOUVEMENTS: Record<Mouvement, string> = { incorporation: "Incorporation", retrait: "Retrait" };

interface LigneAvenant {
  vehiculeId: string;
  immatriculation: string;
  mouvement: Mouvement;
  primeVehicule: number;
  joursRestants?: number;
  joursPeriode?: number;
  montant: number;
}

interface Avenant {
  id: string;
  numero: number;
  nature: "mouvement" | "annulation";
  dateEffet: string;
  montant: number;
  motif: string | null;
  annuleNumero: number | null;
  annuleParNumero: number | null;
  regle: boolean | null;
  annulable: boolean;
  lignes: LigneAvenant[];
  creeLe: string;
  creePar: string;
}

interface Contrat {
  id: string;
  numeroPolice: string | null;
  branche: string;
  statut: string;
  dateEffet: string;
  dateEcheance: string;
  primeTtc: number;
  primesAvenants: number;
  vehicules: LigneContrat[];
  avenants: Avenant[];
}

interface Import {
  enregistre: boolean;
  lignes: { ligne: number; action: "creation" | "mise_a_jour"; vehicule: { immatriculation: string } }[];
  erreurs: { ligne: number; colonne: string; valeur: string; message: string }[];
  colonnes: string[];
  ignorees: string[];
  resume: { creations: number; misesAJour: number };
}

const DOCUMENTS: [keyof Vehicule, string][] = [
  ["echeanceVisiteTechnique", "Visite technique"],
  ["echeanceVignette", "Vignette"],
  ["echeanceCarteTransport", "Carte de transport"],
];

/** Échéance d'un document : rouge si échue, orange dans les 30 jours */
function Echeance({ date }: { date: string | null }) {
  if (!date) return <span className="note">—</span>;
  const jours = Math.round((Date.parse(date) - Date.parse(aujourdHui())) / 86_400_000);
  if (jours < 0) return <Badge ton="rouge">{dateCourte(date)} · échue</Badge>;
  if (jours <= 30) return <Badge ton="orange">{dateCourte(date)} · {jours === 0 ? "aujourd'hui" : `${jours} j`}</Badge>;
  return <span>{dateCourte(date)}</span>;
}

function lireEnBase64(fichier: File): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.addEventListener("load", () => resoudre(String(lecteur.result).split(",")[1] ?? ""));
    lecteur.addEventListener("error", () => rejeter(lecteur.error));
    lecteur.readAsDataURL(fichier);
  });
}

export function Flotte({ clientId }: { clientId: string }) {
  const { peut } = useSession();
  const [client, setClient] = useState<{ nom: string } | null>(null);
  const [donnees, setDonnees] = useState<{ vehicules: Vehicule[]; contrats: Contrat[] } | null>(null);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(async () => {
    try {
      const [fiche, flotte] = await Promise.all([
        api<{ client: { nom: string } }>(`/clients/${clientId}`),
        api<{ vehicules: Vehicule[]; contrats: Contrat[] }>(`/clients/${clientId}/flotte`),
      ]);
      setClient(fiche.client);
      setDonnees(flotte);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [clientId]);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (!donnees || !client) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  const gestion = peut("gerant", "charge_clientele", "commercial");
  const aRenouveler = donnees.vehicules.reduce(
    (total, v) => total + DOCUMENTS.filter(([cle]) => {
      const date = v[cle] as string | null;
      return date !== null && Date.parse(date) - Date.parse(aujourdHui()) <= 30 * 86_400_000;
    }).length,
    0,
  );

  return (
    <>
      <p className="fil"><Lien href={`/clients/${clientId}`}>{client.nom}</Lien></p>
      <h1>Flotte de {client.nom}</h1>
      <div className="cartes">
        <div className="carte carte--bleu"><span className="carte__nombre">{donnees.vehicules.length}</span><span className="carte__titre">Véhicules</span></div>
        <div className={`carte carte--${aRenouveler > 0 ? "orange" : "vert"}`}>
          <span className="carte__nombre">{aRenouveler}</span><span className="carte__titre">Documents à renouveler sous 30 jours</span>
        </div>
        <div className="carte carte--gris"><span className="carte__nombre">{donnees.contrats.length}</span><span className="carte__titre">Contrats avec véhicules</span></div>
      </div>
      <Alerte>{erreur}</Alerte>

      {gestion && <ImportVehicules clientId={clientId} apres={charger} />}

      <Section
        titre="Véhicules et échéances"
        actions={gestion && donnees.vehicules.length > 0 && (
          <a className="bouton bouton--petit" href={`/api/clients/${clientId}/flotte/export.csv`} download>Exporter pour la cotation</a>
        )}
      >
        {donnees.vehicules.length === 0 ? <Vide>Aucun véhicule : importez la liste de la flotte.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr><th>Immatriculation</th><th>Véhicule</th><th>Contrat</th>{DOCUMENTS.map(([, libelle]) => <th key={libelle}>{libelle}</th>)}<th>Sinistres</th></tr>
              </thead>
              <tbody>
                {donnees.vehicules.map((v) => (
                  <tr key={v.id}>
                    <td><strong>{v.immatriculation}</strong></td>
                    <td>
                      {[v.marque, v.modele, v.genre].filter(Boolean).join(" · ") || "—"}
                      {(v.puissanceFiscale || v.valeurVenale) && (
                        <span className="note"><br />{[v.puissanceFiscale && `${v.puissanceFiscale} CV`, v.valeurVenale && montant(v.valeurVenale)].filter(Boolean).join(" · ")}</span>
                      )}
                    </td>
                    <td>{v.policeEnCours ?? <span className="note">Aucun</span>}</td>
                    {DOCUMENTS.map(([cle]) => <td key={cle}><Echeance date={v[cle] as string | null} /></td>)}
                    <td>
                      {v.sinistres.length === 0 ? <span className="note">Aucun</span> : (
                        <>{v.sinistres.length}<span className="note"><br />dernier le {dateCourte(v.sinistres[0]!.survenuLe)}</span></>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">Les clients qui l'ont accepté reçoivent un rappel WhatsApp à J-30, à J-7 et à l'échéance : un seul message pour toute leur flotte.</p>
      </Section>

      {donnees.contrats.map((contrat) => (
        <ContratFlotte key={contrat.id} contrat={contrat} vehicules={donnees.vehicules} apres={charger} />
      ))}

      <SinistresFlotte vehicules={donnees.vehicules} contrats={donnees.contrats} apres={charger} />
    </>
  );
}

function ImportVehicules({ clientId, apres }: { clientId: string; apres: () => Promise<void> }) {
  const [fichier, setFichier] = useState<{ nom: string; contenu: string } | null>(null);
  const [resultat, setResultat] = useState<Import | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function choisir(evenement: ChangeEvent<HTMLInputElement>) {
    setErreur("");
    setMessage("");
    setResultat(null);
    const choisi = evenement.target.files?.[0];
    if (!choisi) return setFichier(null);
    if (choisi.size > 2 * 1024 * 1024) {
      setFichier(null);
      return setErreur("Le fichier dépasse 2 Mo : découpez la liste en plusieurs fichiers.");
    }
    const contenu = await lireEnBase64(choisi);
    setFichier({ nom: choisi.name, contenu });
    await envoyer({ nom: choisi.name, contenu }, false);
  }

  async function envoyer(source: { nom: string; contenu: string }, confirmer: boolean) {
    setEnvoi(true);
    setErreur("");
    try {
      const reponse = await api<Import>(`/clients/${clientId}/vehicules/import`, { corps: { fichier: source.contenu, confirmer } });
      setResultat(reponse);
      if (reponse.enregistre) {
        setMessage(`Import terminé : ${reponse.resume.creations} véhicule(s) ajouté(s), ${reponse.resume.misesAJour} mis à jour.`);
        setFichier(null);
        setResultat(null);
        await apres();
      }
    } catch (e) {
      if (e instanceof ErreurApi && e.code === "import_invalide") setResultat(e.donnees as unknown as Import);
      else setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Section titre="Importer la liste des véhicules" actions={<a className="bouton bouton--petit" href="/api/flottes/modele-import.csv" download>Télécharger le modèle</a>}>
      <p className="note">
        Classeur Excel (.xlsx) ou CSV, 2 Mo et 2 000 lignes au plus, une ligne par véhicule. Colonne obligatoire : Immatriculation.
        Les autres (marque, modèle, genre, usage, CV, valeur, n° de châssis, visite technique, vignette, carte de transport) sont reconnues
        d'après leur titre. Rien n'est enregistré avant votre confirmation, ni tant qu'une ligne est en erreur.
      </p>
      <Champ libelle="Fichier de la flotte">
        <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => void choisir(e)} />
      </Champ>
      {envoi && <p className="chargement" role="status">Vérification du fichier…</p>}
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>

      {resultat && !resultat.enregistre && (
        <div className="apercu-import">
          <p>
            <strong>{fichier?.nom}</strong> : {resultat.resume.creations} véhicule(s) à ajouter, {resultat.resume.misesAJour} à mettre à jour.
            {resultat.colonnes.length > 0 && <> Colonnes reconnues : {resultat.colonnes.join(", ")}.</>}
            {resultat.ignorees.length > 0 && <> Ignorées : {resultat.ignorees.join(", ")}.</>}
          </p>
          {resultat.erreurs.length > 0 ? (
            <>
              <Alerte>{`${resultat.erreurs.length} erreur(s) à corriger dans le fichier avant de l'importer :`}</Alerte>
              <div className="tableau-defilant">
                <table className="tableau">
                  <thead><tr><th>Ligne</th><th>Colonne</th><th>Valeur</th><th>Erreur</th></tr></thead>
                  <tbody>
                    {resultat.erreurs.map((e, i) => (
                      <tr key={`${e.ligne}-${e.colonne}-${i}`}><td>{e.ligne}</td><td>{e.colonne || "—"}</td><td>{e.valeur || "—"}</td><td>{e.message}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="formulaire__actions">
              <button type="button" className="bouton bouton--principal" disabled={envoi || !fichier} onClick={() => fichier && void envoyer(fichier, true)}>
                Importer {resultat.lignes.length} véhicule(s)
              </button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/** « Incorporation de 9003 FL 01, 9004 FL 01 · Retrait de 9001 FL 01 » (cinq plaques au plus par mouvement) */
function libelleAvenant(a: Avenant): string {
  if (a.nature === "annulation") return `Annulation de l'avenant n° ${a.annuleNumero}`;
  const plaques = (mouvement: Mouvement) => {
    const liste = a.lignes.filter((l) => l.mouvement === mouvement).map((l) => l.immatriculation);
    return liste.length > 5 ? `${liste.slice(0, 5).join(", ")} et ${liste.length - 5} autre(s)` : liste.join(", ");
  };
  return [
    a.lignes.some((l) => l.mouvement === "incorporation") && `Incorporation de ${plaques("incorporation")}`,
    a.lignes.some((l) => l.mouvement === "retrait") && `Retrait de ${plaques("retrait")}`,
  ].filter(Boolean).join(" · ");
}

const sommeAvenant = (valeur: number) => (valeur >= 0 ? `${montant(valeur)} à encaisser` : `ristourne de ${montant(-valeur)}`);

/** Détail du calcul, ligne par ligne : prime × jours restants ÷ jours de la période */
function DetailCalcul({ lignes, annulation }: { lignes: LigneAvenant[]; annulation?: boolean }) {
  const contenu = (
    <ul className="detail-avenant">
      {lignes.map((l) => (
        <li key={l.vehiculeId}>
          {annulation ? (l.mouvement === "incorporation" ? "Annulation de l'incorporation" : "Annulation du retrait") : MOUVEMENTS[l.mouvement]}
          {" "}de {l.immatriculation} :{" "}
          {l.joursRestants !== undefined && <>{montant(l.primeVehicule)} × {l.joursRestants} / {l.joursPeriode} j = </>}
          {l.montant >= 0 ? montant(l.montant) : `− ${montant(-l.montant)}`}
        </li>
      ))}
    </ul>
  );
  return lignes.length > 3 ? <details><summary>{lignes.length} véhicules</summary>{contenu}</details> : contenu;
}

function ContratFlotte({ contrat, vehicules, apres }: { contrat: Contrat; vehicules: Vehicule[]; apres: () => Promise<void> }) {
  const { peut } = useSession();
  const gestion = peut("gerant", "charge_clientele");
  const [aAnnuler, setAAnnuler] = useState<Avenant | null>(null);
  const [erreur, setErreur] = useState("");
  const actifs = contrat.vehicules.filter((v) => !v.retireLe);
  const enCours = useMemo(() => new Set(actifs.map((v) => v.vehiculeId)), [actifs]);
  const incorporables = vehicules.filter((v) => !enCours.has(v.id));

  async function detacher(ligne: LigneContrat) {
    setErreur("");
    try {
      await api(`/contrats/${contrat.id}/vehicules/${ligne.vehiculeId}`, { methode: "DELETE" });
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <Section titre={`Contrat ${contrat.numeroPolice ?? "sans n° de police"} · ${BRANCHES[contrat.branche] ?? contrat.branche}`}>
      <p>
        <Badge ton={contrat.statut === "en_vigueur" ? "vert" : contrat.statut === "en_attente_paiement" ? "orange" : "gris"}>
          {STATUTS_CONTRAT[contrat.statut] ?? contrat.statut}
        </Badge>{" "}
        Du {dateCourte(contrat.dateEffet)} au {dateCourte(contrat.dateEcheance)} · prime {montant(contrat.primeTtc)}
        {contrat.primesAvenants !== 0 && <> · avenants {contrat.primesAvenants > 0 ? "+" : "−"} {montant(Math.abs(contrat.primesAvenants))}</>}
        {" · "}<Lien href={`/contrats/${contrat.id}`}>Paiements</Lien>
      </p>
      <Alerte>{erreur}</Alerte>

      {contrat.vehicules.length === 0 ? <Vide>Aucun véhicule sur ce contrat.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr>
                <th>Véhicule</th><th>Couvert depuis</th><th>Retiré le</th><th>Prime du véhicule</th><th>Attestation</th>
                {gestion && contrat.statut === "en_attente_paiement" && <th><span className="visuellement-cache">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {contrat.vehicules.map((v) => (
                <tr key={`${v.vehiculeId}-${v.ajouteLe}`}>
                  <td>{v.immatriculation}</td>
                  <td>{dateCourte(v.ajouteLe)}</td>
                  <td>{v.retireLe ? dateCourte(v.retireLe) : "—"}</td>
                  <td>{v.primeVehicule ? montant(v.primeVehicule) : "—"}</td>
                  <td>
                    {v.attestation === "saine" ? (
                      <a href={`/api/attestations/${v.ligneId}`} download aria-label={`Attestation ${v.numeroAttestation} de ${v.immatriculation} (PDF)`}>{v.numeroAttestation}</a>
                    ) : v.numeroAttestation ? (
                      <>{v.numeroAttestation}{v.attestation === "a_analyser" && <span className="note"><br />PDF en attente d'analyse</span>}</>
                    ) : <span className="note">—</span>}
                  </td>
                  {gestion && contrat.statut === "en_attente_paiement" && (
                    <td>
                      <button type="button" className="bouton bouton--petit" aria-label={`Détacher ${v.immatriculation} du contrat`}
                        onClick={() => void detacher(v)}>Détacher</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gestion && contrat.statut === "en_attente_paiement" && incorporables.length > 0 && (
        <RattachementDepart contrat={contrat} disponibles={incorporables} apres={apres} />
      )}
      {gestion && contrat.statut === "en_vigueur" && actifs.length > 0 && (
        <DepotAttestations contrat={contrat} actifs={actifs} apres={apres} />
      )}
      {gestion && contrat.statut === "en_vigueur" && (incorporables.length > 0 || actifs.length > 0) && (
        <NouvelAvenant contrat={contrat} incorporables={incorporables} actifs={actifs} apres={apres} />
      )}

      {contrat.avenants.length > 0 && (
        <>
          <h3 className="sous-titre">Avenants</h3>
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>N°</th><th>Avenant</th><th>Effet</th><th>Calcul</th><th>Montant</th><th>État</th>{gestion && <th><span className="visuellement-cache">Actions</span></th>}</tr></thead>
              <tbody>
                {contrat.avenants.map((a) => (
                  <tr key={a.id}>
                    <td>{a.numero}</td>
                    <td>
                      {libelleAvenant(a)}
                      <span className="note"><br />{a.motif && <>« {a.motif} » · </>}{a.creePar}, {dateHeure(a.creeLe)}</span>
                    </td>
                    <td>{dateCourte(a.dateEffet)}</td>
                    <td><DetailCalcul lignes={a.lignes} annulation={a.nature === "annulation"} /></td>
                    <td>{a.montant >= 0 ? montant(a.montant) : `Ristourne ${montant(-a.montant)}`}</td>
                    <td>
                      {a.annuleParNumero !== null ? <Badge ton="gris">Annulé (n° {a.annuleParNumero})</Badge>
                        : a.regle === null ? "—" : a.regle ? <Badge ton="vert">Réglé</Badge> : <Badge ton="orange">À encaisser</Badge>}
                    </td>
                    {gestion && (
                      <td>
                        {a.annulable && (
                          <button type="button" className="bouton bouton--petit" aria-label={`Annuler l'avenant n° ${a.numero}`}
                            onClick={() => setAAnnuler(a)}>Annuler…</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {aAnnuler && <AnnulationAvenant contrat={contrat} avenant={aAnnuler} fermer={() => setAAnnuler(null)} apres={apres} />}
    </Section>
  );
}

function RattachementDepart({ contrat, disponibles, apres }: { contrat: Contrat; disponibles: Vehicule[]; apres: () => Promise<void> }) {
  const [vehiculeId, setVehiculeId] = useState(disponibles[0]?.id ?? "");
  const [prime, setPrime] = useState("");
  const [erreur, setErreur] = useState("");
  const choisi = disponibles.find((v) => v.id === vehiculeId) ?? disponibles[0];
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    try {
      await api(`/contrats/${contrat.id}/vehicules`, { corps: { vehiculeId: choisi?.id, ...(prime ? { primeVehicule: Number(prime) } : {}) } });
      setPrime("");
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }
  return (
    <form className="formulaire formulaire--grille" aria-label="Rattacher un véhicule de départ" onSubmit={(e) => void soumettre(e)}>
      <Champ libelle="Véhicule de départ" aide={`Couvert du ${dateCourte(contrat.dateEffet)} au ${dateCourte(contrat.dateEcheance)}, inclus dans la prime du contrat.`}>
        <select value={choisi?.id ?? ""} onChange={(e) => setVehiculeId(e.target.value)}>
          {disponibles.map((v) => <option key={v.id} value={v.id}>{v.immatriculation}</option>)}
        </select>
      </Champ>
      <Champ libelle="Prime du véhicule (F CFA, facultatif)" aide="Sert à calculer la ristourne si le véhicule est retiré plus tard.">
        <input inputMode="numeric" value={prime} onChange={(e) => setPrime(e.target.value.replace(/\D/g, ""))} />
      </Champ>
      <button type="submit" className="bouton bouton--principal">Rattacher au contrat</button>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

interface Calcul {
  montant: number;
  joursRestants?: number;
  joursPeriode?: number;
  annuleNumero?: number;
  lignes: LigneAvenant[];
}

/** Avenant de mouvement : des véhicules incorporés et des véhicules retirés, à une même date d'effet */
function NouvelAvenant({ contrat, incorporables, actifs, apres }: {
  contrat: Contrat; incorporables: Vehicule[]; actifs: LigneContrat[]; apres: () => Promise<void>;
}) {
  const [dateEffet, setDateEffet] = useState(aujourdHui());
  const [aIncorporer, setAIncorporer] = useState<Record<string, string>>({});
  const [aRetirer, setARetirer] = useState<Set<string>>(new Set());
  const [observation, setObservation] = useState("");
  const [apercu, setApercu] = useState<Calcul | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);

  // Réintégration : véhicule déjà passé sur ce contrat (sa dernière sortie et sa prime d'alors)
  const sorties = useMemo(() => {
    const parVehicule = new Map<string, LigneContrat>();
    for (const l of contrat.vehicules) {
      if (l.retireLe && (!parVehicule.has(l.vehiculeId) || parVehicule.get(l.vehiculeId)!.retireLe! < l.retireLe)) parVehicule.set(l.vehiculeId, l);
    }
    return parVehicule;
  }, [contrat.vehicules]);

  const lignes = () => [
    ...Object.entries(aIncorporer).map(([vehiculeId, prime]) => ({
      vehiculeId, mouvement: "incorporation" as const, ...(prime ? { primeVehicule: Number(prime) } : {}),
    })),
    ...[...aRetirer].map((vehiculeId) => ({ vehiculeId, mouvement: "retrait" as const })),
  ];
  const nombre = Object.keys(aIncorporer).length + aRetirer.size;
  const corps = (confirmer: boolean) => ({ dateEffet, lignes: lignes(), ...(observation.trim() ? { observation: observation.trim() } : {}), confirmer });

  useEffect(() => setApercu(null), [dateEffet, aIncorporer, aRetirer]);

  function basculerIncorporation(vehiculeId: string, coche: boolean) {
    setMessage("");
    setAIncorporer((avant) => {
      const suite = { ...avant };
      if (coche) suite[vehiculeId] = "";
      else delete suite[vehiculeId];
      return suite;
    });
  }
  function basculerRetrait(vehiculeId: string, coche: boolean) {
    setMessage("");
    setARetirer((avant) => {
      const suite = new Set(avant);
      if (coche) suite.add(vehiculeId);
      else suite.delete(vehiculeId);
      return suite;
    });
  }

  async function calculer() {
    setErreur("");
    setEnvoi(true);
    try {
      setApercu((await api<{ apercu: Calcul }>(`/contrats/${contrat.id}/avenants`, { corps: corps(false) })).apercu);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  async function enregistrer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const { avenant } = await api<{ avenant: Avenant }>(`/contrats/${contrat.id}/avenants`, { corps: corps(true) });
      setMessage(`Avenant n° ${avenant.numero} enregistré : ${sommeAvenant(avenant.montant)}.`);
      setApercu(null);
      setAIncorporer({});
      setARetirer(new Set());
      setObservation("");
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="formulaire avenant" aria-label="Nouvel avenant" onSubmit={(e) => void enregistrer(e)}>
      <h3 className="sous-titre sous-titre--serre">Nouvel avenant</h3>
      <p className="note">
        Cochez les véhicules à incorporer ou à retirer à une même date d'effet : un seul avenant, un seul numéro. La prime de chaque véhicule
        incorporé est celle de la compagnie pour toute la période du contrat ; la base calcule le prorata.
      </p>
      <div className="formulaire--grille avenant__entete">
        <Champ libelle="Date d'effet" aide={`Entre le ${dateCourte(contrat.dateEffet)} et le ${dateCourte(contrat.dateEcheance)}, exclus.`}>
          <input type="date" value={dateEffet} min={contrat.dateEffet} max={contrat.dateEcheance} onChange={(e) => setDateEffet(e.target.value)} required />
        </Champ>
        <Champ libelle="Observation (facultatif)" aide="Par exemple : achat de deux tracteurs, vente d'un camion.">
          <input value={observation} maxLength={500} onChange={(e) => setObservation(e.target.value)} />
        </Champ>
      </div>

      {incorporables.length > 0 && (
        <fieldset className="avenant__groupe">
          <legend>Incorporer</legend>
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Véhicule</th><th>Prime pour la période (F CFA)</th></tr></thead>
              <tbody>
                {incorporables.map((v) => {
                  const coche = v.id in aIncorporer;
                  const sortie = sorties.get(v.id);
                  return (
                    <tr key={v.id}>
                      <td>
                        <label className="case-a-cocher">
                          <input type="checkbox" aria-label={`Incorporer ${v.immatriculation}${sortie?.retireLe ? " (réintégration)" : ""}`} checked={coche}
                            onChange={(e) => basculerIncorporation(v.id, e.target.checked)} />
                          <span>
                            {v.immatriculation}
                            {sortie?.retireLe && <span className="note"><br />Sorti le {dateCourte(sortie.retireLe)} : réintégration</span>}
                          </span>
                        </label>
                      </td>
                      <td>
                        <input inputMode="numeric" aria-label={`Prime de ${v.immatriculation} pour la période (F CFA)`} disabled={!coche}
                          placeholder={sortie?.primeVehicule ? `${sortie.primeVehicule} (précédente)` : ""}
                          value={aIncorporer[v.id] ?? ""}
                          onChange={(e) => setAIncorporer((avant) => ({ ...avant, [v.id]: e.target.value.replace(/\D/g, "") }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </fieldset>
      )}

      {actifs.length > 0 && (
        <fieldset className="avenant__groupe">
          <legend>Retirer</legend>
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Véhicule</th><th>Couvert depuis</th><th>Prime connue</th></tr></thead>
              <tbody>
                {actifs.map((v) => (
                  <tr key={v.vehiculeId}>
                    <td>
                      <label className="case-a-cocher">
                        <input type="checkbox" aria-label={`Retirer ${v.immatriculation}`} checked={aRetirer.has(v.vehiculeId)}
                          onChange={(e) => basculerRetrait(v.vehiculeId, e.target.checked)} />
                        <span>{v.immatriculation}</span>
                      </label>
                    </td>
                    <td>{dateCourte(v.ajouteLe)}</td>
                    <td>{v.primeVehicule ? montant(v.primeVehicule) : <span className="note">Inconnue : à indiquer à la compagnie</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      )}

      {apercu && (
        <div className="alerte alerte--info" role="status">
          <DetailCalcul lignes={apercu.lignes.map((l) => ({ ...l, joursRestants: apercu.joursRestants, joursPeriode: apercu.joursPeriode }))} />
          <p><strong>Total de l'avenant : {sommeAvenant(apercu.montant)}</strong></p>
        </div>
      )}
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
      <div className="formulaire__actions">
        <button type="button" className="bouton" disabled={nombre === 0 || envoi} onClick={() => void calculer()}>
          Calculer le prorata{nombre > 0 ? ` (${nombre} véhicule${nombre > 1 ? "s" : ""})` : ""}
        </button>
        <button type="submit" className="bouton bouton--principal" disabled={!apercu || envoi}>Enregistrer l'avenant</button>
      </div>
    </form>
  );
}

/** Avenant d'annulation : défait exactement un avenant saisi par erreur, avec son motif */
function AnnulationAvenant({ contrat, avenant, fermer, apres }: {
  contrat: Contrat; avenant: Avenant; fermer: () => void; apres: () => Promise<void>;
}) {
  const [motif, setMotif] = useState("");
  const [apercu, setApercu] = useState<Calcul | null>(null);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const url = `/contrats/${contrat.id}/avenants/${avenant.id}/annulation`;

  useEffect(() => setApercu(null), [motif]);

  async function calculer() {
    setErreur("");
    setEnvoi(true);
    try {
      setApercu((await api<{ apercu: Calcul }>(url, { corps: { motif: motif.trim() } })).apercu);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  async function confirmer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      await api(url, { corps: { motif: motif.trim(), confirmer: true } });
      fermer();
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="formulaire avenant" aria-label={`Annuler l'avenant n° ${avenant.numero}`} onSubmit={(e) => void confirmer(e)}>
      <h3 className="sous-titre sous-titre--serre">Annuler l'avenant n° {avenant.numero}</h3>
      <p className="note">
        {libelleAvenant(avenant)}, effet au {dateCourte(avenant.dateEffet)}. L'annulation est elle-même un avenant numéroté : les véhicules
        incorporés n'auront jamais été couverts, les véhicules retirés le restent, et le montant est contre-passé.
      </p>
      <Champ libelle="Motif de l'annulation" aide="5 caractères au moins ; il figure au journal.">
        <input value={motif} maxLength={500} onChange={(e) => setMotif(e.target.value)} required minLength={5} />
      </Champ>
      {apercu && (
        <div className="alerte alerte--info" role="status">
          <DetailCalcul lignes={apercu.lignes} annulation />
          <p><strong>Effet de l'annulation : {sommeAvenant(apercu.montant)}</strong></p>
        </div>
      )}
      <Alerte>{erreur}</Alerte>
      <div className="formulaire__actions">
        <button type="button" className="bouton" disabled={motif.trim().length < 5 || envoi} onClick={() => void calculer()}>Voir l'effet</button>
        <button type="submit" className="bouton bouton--danger" disabled={!apercu || envoi}>Confirmer l'annulation</button>
        <button type="button" className="bouton bouton--lien" onClick={fermer}>Fermer</button>
      </div>
    </form>
  );
}

/** Plaque sans espaces ni tirets, en majuscules : « 1234-ab-01 » et « 1234 AB 01 » donnent « 1234AB01 » */
const clePlaque = (texte: string) => texte.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Attestations des véhicules couverts (PDF de l'ASACI) : une à une, ou plusieurs PDF choisis d'un coup,
 * rapprochés du véhicule dont la plaque figure dans le nom du fichier. Chaque PDF est analysé par
 * l'antivirus, chiffré, puis visible par l'entreprise sur son portail.
 */
function DepotAttestations({ contrat, actifs, apres }: { contrat: Contrat; actifs: LigneContrat[]; apres: () => Promise<void> }) {
  const [saisies, setSaisies] = useState<Record<string, { numero: string; fichier: File | null }>>({});
  const [etats, setEtats] = useState<Record<string, { ok: boolean; texte: string }>>({});
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const deposees = actifs.filter((v) => v.attestation).length;
  const saisie = (v: LigneContrat) => saisies[v.vehiculeId] ?? { numero: v.numeroAttestation ?? "", fichier: null };
  const pretes = actifs.filter((v) => saisie(v).fichier && saisie(v).numero.trim().length >= 3);

  function modifier(v: LigneContrat, changement: Partial<{ numero: string; fichier: File | null }>) {
    setMessage("");
    setSaisies((avant) => ({ ...avant, [v.vehiculeId]: { ...saisie(v), ...avant[v.vehiculeId], ...changement } }));
  }

  function choisirPlusieurs(evenement: ChangeEvent<HTMLInputElement>) {
    const fichiers = [...(evenement.target.files ?? [])];
    const rapproches = new Map<string, File>();
    const ignores: string[] = [];
    for (const fichier of fichiers) {
      const nom = clePlaque(fichier.name);
      const vehicule = actifs.find((v) => nom.includes(clePlaque(v.immatriculation)));
      if (vehicule) rapproches.set(vehicule.vehiculeId, fichier);
      else ignores.push(fichier.name);
    }
    setSaisies((avant) => {
      const suite = { ...avant };
      for (const v of actifs) {
        const fichier = rapproches.get(v.vehiculeId);
        if (fichier) suite[v.vehiculeId] = { ...saisie(v), ...avant[v.vehiculeId], fichier };
      }
      return suite;
    });
    setMessage(`${rapproches.size} PDF rapproché(s) d'un véhicule d'après la plaque dans leur nom.`
      + (ignores.length ? ` Sans plaque reconnue : ${ignores.join(", ")}.` : "") + " Indiquez le n° de chaque attestation, puis déposez.");
    evenement.target.value = "";
  }

  async function deposer(evenement: FormEvent) {
    evenement.preventDefault();
    setEnvoi(true);
    setMessage("");
    let reussies = 0;
    for (const v of pretes) {
      const { numero, fichier } = saisie(v);
      try {
        await api(`/contrats/${contrat.id}/vehicules/${v.vehiculeId}/attestation`, {
          corps: { numero: numero.trim(), fichier: await lireEnBase64(fichier!) },
        });
        reussies += 1;
        setEtats((avant) => ({ ...avant, [v.vehiculeId]: { ok: true, texte: "Déposée" } }));
        setSaisies((avant) => {
          const suite = { ...avant };
          delete suite[v.vehiculeId];
          return suite;
        });
      } catch (e) {
        setEtats((avant) => ({ ...avant, [v.vehiculeId]: { ok: false, texte: messageErreur(e) } }));
      }
    }
    setEnvoi(false);
    setMessage(`${reussies} attestation(s) déposée(s) sur ${pretes.length}.`);
    await apres();
  }

  return (
    <details className="avenant">
      <summary>Attestations : {deposees} déposée(s) sur {actifs.length} véhicule(s)</summary>
      <form className="formulaire" aria-label={`Attestations du contrat ${contrat.numeroPolice ?? ""}`} onSubmit={(e) => void deposer(e)}>
        <p className="note">
          PDF de l'attestation digitale (ASACI), 2 Mo au plus. Choisissez-les un à un, ou plusieurs d'un coup : chaque fichier est rapproché du
          véhicule dont la plaque figure dans son nom (par exemple « attestation-1234-AB-01.pdf »).
        </p>
        <Champ libelle="Plusieurs PDF d'un coup">
          <input type="file" accept="application/pdf,.pdf" multiple onChange={choisirPlusieurs} />
        </Champ>
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Véhicule</th><th>N° d'attestation</th><th>Fichier PDF</th><th>État</th></tr></thead>
            <tbody>
              {actifs.map((v) => {
                const s = saisie(v);
                const etat = etats[v.vehiculeId];
                return (
                  <tr key={v.ligneId}>
                    <td>{v.immatriculation}</td>
                    <td>
                      <input aria-label={`N° d'attestation de ${v.immatriculation}`} value={s.numero} maxLength={40}
                        onChange={(e) => modifier(v, { numero: e.target.value })} />
                    </td>
                    <td>
                      <input type="file" accept="application/pdf,.pdf" aria-label={`PDF de l'attestation de ${v.immatriculation}`}
                        onChange={(e) => modifier(v, { fichier: e.target.files?.[0] ?? null })} />
                      {s.fichier && <span className="note"><br />{s.fichier.name}</span>}
                    </td>
                    <td>
                      {etat ? <Badge ton={etat.ok ? "vert" : "rouge"}>{etat.texte}</Badge>
                        : v.attestation === "saine" ? <Badge ton="vert">Disponible sur le portail</Badge>
                        : <span className="note">À déposer</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Alerte type="info">{message}</Alerte>
        <div className="formulaire__actions">
          <button type="submit" className="bouton bouton--principal" disabled={pretes.length === 0 || envoi}>
            {envoi ? "Dépôt en cours…" : `Déposer ${pretes.length} attestation(s)`}
          </button>
        </div>
      </form>
    </details>
  );
}

const NATURES_SINISTRE: Record<string, string> = {
  materiel: "Dommages matériels", corporel: "Dommages corporels", vol: "Vol", incendie: "Incendie",
  bris_de_glace: "Bris de glace", degat_des_eaux: "Dégât des eaux", autre: "Autre",
};
const STATUTS_SINISTRE: Record<string, string> = {
  declare: "Déclaré", transmis_compagnie: "Transmis à la compagnie", expertise: "En expertise", offre_recue: "Offre reçue",
  regle: "Réglé", refuse: "Refusé", classe_sans_suite: "Classé sans suite",
};

/** Sinistres de la flotte : historique par véhicule, déclaration et suivi (le portail les montre à l'entreprise) */
function SinistresFlotte({ vehicules, contrats, apres }: { vehicules: Vehicule[]; contrats: Contrat[]; apres: () => Promise<void> }) {
  const { peut } = useSession();
  const gestion = peut("gerant", "charge_clientele");
  const [erreur, setErreur] = useState("");
  const [contratId, setContratId] = useState(contrats[0]?.id ?? "");
  const [vehiculeId, setVehiculeId] = useState("");
  const [survenuLe, setSurvenuLe] = useState(aujourdHui());
  const [nature, setNature] = useState("materiel");
  const [description, setDescription] = useState("");
  const sinistres = vehicules.flatMap((v) => v.sinistres.map((s) => ({ ...s, immatriculation: v.immatriculation })))
    .sort((a, b) => b.survenuLe.localeCompare(a.survenuLe));
  const contrat = contrats.find((k) => k.id === contratId) ?? contrats[0];
  const couverts = contrat?.vehicules.filter((l) => l.ajouteLe <= survenuLe && (!l.retireLe || l.retireLe > survenuLe)) ?? [];

  async function changerStatut(id: string, statut: string) {
    setErreur("");
    try {
      await api(`/sinistres/${id}`, { methode: "PATCH", corps: { statut } });
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  async function declarer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    try {
      await api(`/contrats/${contrat!.id}/sinistres`, {
        corps: { survenuLe, nature, ...(vehiculeId ? { vehiculeId } : {}), ...(description.trim() ? { description } : {}) },
      });
      setDescription("");
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  if (sinistres.length === 0 && (!gestion || contrats.length === 0)) return null;
  return (
    <Section titre="Sinistres de la flotte">
      <Alerte>{erreur}</Alerte>
      {sinistres.length === 0 ? <Vide>Aucun sinistre enregistré sur les véhicules de ce client.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Survenu le</th><th>Véhicule</th><th>Nature</th><th>Statut</th></tr></thead>
            <tbody>
              {sinistres.map((s) => (
                <tr key={s.id}>
                  <td>{dateCourte(s.survenuLe)}</td>
                  <td>{s.immatriculation}</td>
                  <td>{NATURES_SINISTRE[s.nature] ?? s.nature}</td>
                  <td>
                    {gestion ? (
                      <select aria-label={`Statut du sinistre de ${s.immatriculation} du ${dateCourte(s.survenuLe)}`} value={s.statut}
                        onChange={(e) => void changerStatut(s.id, e.target.value)}>
                        {Object.entries(STATUTS_SINISTRE).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
                      </select>
                    ) : STATUTS_SINISTRE[s.statut] ?? s.statut}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gestion && contrat && (
        <details className="avenant">
          <summary>Déclarer un sinistre</summary>
          <form className="formulaire formulaire--grille" aria-label="Déclarer un sinistre" onSubmit={(e) => void declarer(e)}>
            <Champ libelle="Contrat">
              <select value={contrat.id} onChange={(e) => { setContratId(e.target.value); setVehiculeId(""); }}>
                {contrats.map((k) => <option key={k.id} value={k.id}>{k.numeroPolice ?? "Sans n° de police"} · {STATUTS_CONTRAT[k.statut] ?? k.statut}</option>)}
              </select>
            </Champ>
            <Champ libelle="Survenu le">
              <input type="date" value={survenuLe} max={aujourdHui()} onChange={(e) => { setSurvenuLe(e.target.value); setVehiculeId(""); }} required />
            </Champ>
            <Champ libelle="Véhicule concerné" aide="Seuls les véhicules couverts ce jour-là.">
              <select value={vehiculeId} onChange={(e) => setVehiculeId(e.target.value)}>
                <option value="">Aucun véhicule précis</option>
                {couverts.map((l) => <option key={l.ligneId} value={l.vehiculeId}>{l.immatriculation}</option>)}
              </select>
            </Champ>
            <Champ libelle="Nature">
              <select value={nature} onChange={(e) => setNature(e.target.value)}>
                {Object.entries(NATURES_SINISTRE).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
              </select>
            </Champ>
            <Champ libelle="Circonstances (note interne, non visible par le client)">
              <textarea value={description} maxLength={4000} rows={2} onChange={(e) => setDescription(e.target.value)} />
            </Champ>
            <button type="submit" className="bouton bouton--principal">Enregistrer le sinistre</button>
          </form>
        </details>
      )}
    </Section>
  );
}

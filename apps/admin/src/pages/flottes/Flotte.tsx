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
}

interface LigneContrat {
  vehiculeId: string;
  immatriculation: string;
  ajouteLe: string;
  retireLe: string | null;
  primeVehicule: number | null;
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
                <tr><th>Immatriculation</th><th>Véhicule</th><th>Contrat</th>{DOCUMENTS.map(([, libelle]) => <th key={libelle}>{libelle}</th>)}</tr>
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
                <th>Véhicule</th><th>Couvert depuis</th><th>Retiré le</th><th>Prime du véhicule</th>
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

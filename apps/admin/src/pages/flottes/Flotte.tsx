// Flotte d'un client (tâche 8) : import de la liste des véhicules (Excel ou CSV, contrôlée ligne par ligne
// avant tout enregistrement), échéances des documents, export pour la cotation en lot, composition des
// contrats et avenants au prorata.

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

interface Avenant {
  id: string;
  numero: number;
  nature: "ajout" | "retrait";
  immatriculation: string;
  dateEffet: string;
  primeVehicule: number;
  joursRestants: number;
  joursPeriode: number;
  montant: number;
  regle: boolean | null;
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

function ContratFlotte({ contrat, vehicules, apres }: { contrat: Contrat; vehicules: Vehicule[]; apres: () => Promise<void> }) {
  const { peut } = useSession();
  const actifs = contrat.vehicules.filter((v) => !v.retireLe);
  const surLeContrat = useMemo(() => new Set(contrat.vehicules.map((v) => v.vehiculeId)), [contrat.vehicules]);
  const disponibles = vehicules.filter((v) => !surLeContrat.has(v.id));
  const gestion = peut("gerant", "charge_clientele");

  return (
    <Section titre={`Contrat ${contrat.numeroPolice ?? "sans n° de police"} · ${BRANCHES[contrat.branche] ?? contrat.branche}`}>
      <p>
        <Badge ton={contrat.statut === "en_vigueur" ? "vert" : contrat.statut === "en_attente_paiement" ? "orange" : "gris"}>
          {STATUTS_CONTRAT[contrat.statut] ?? contrat.statut}
        </Badge>{" "}
        Du {dateCourte(contrat.dateEffet)} au {dateCourte(contrat.dateEcheance)} · prime {montant(contrat.primeTtc)}
        {contrat.primesAvenants !== 0 && <> · avenants {contrat.primesAvenants > 0 ? "+" : ""}{montant(contrat.primesAvenants)}</>}
        {" · "}<Lien href={`/contrats/${contrat.id}`}>Paiements</Lien>
      </p>

      {contrat.vehicules.length === 0 ? <Vide>Aucun véhicule sur ce contrat.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Véhicule</th><th>Couvert depuis</th><th>Retiré le</th><th>Prime du véhicule</th></tr></thead>
            <tbody>
              {contrat.vehicules.map((v) => (
                <tr key={v.vehiculeId}>
                  <td>{v.immatriculation}</td>
                  <td>{dateCourte(v.ajouteLe)}</td>
                  <td>{v.retireLe ? dateCourte(v.retireLe) : "—"}</td>
                  <td>{v.primeVehicule ? montant(v.primeVehicule) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gestion && contrat.statut === "en_attente_paiement" && disponibles.length > 0 && (
        <RattachementDepart contrat={contrat} disponibles={disponibles} apres={apres} />
      )}
      {gestion && contrat.statut === "en_vigueur" && (
        <NouvelAvenant contrat={contrat} disponibles={disponibles} actifs={actifs} apres={apres} />
      )}

      {contrat.avenants.length > 0 && (
        <>
          <h3 className="sous-titre">Avenants</h3>
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>N°</th><th>Avenant</th><th>Effet</th><th>Calcul</th><th>Montant</th><th>Règlement</th></tr></thead>
              <tbody>
                {contrat.avenants.map((a) => (
                  <tr key={a.id}>
                    <td>{a.numero}</td>
                    <td>{a.nature === "ajout" ? "Ajout" : "Retrait"} de {a.immatriculation}<span className="note"><br />{a.creePar}, {dateHeure(a.creeLe)}</span></td>
                    <td>{dateCourte(a.dateEffet)}</td>
                    <td>{montant(a.primeVehicule)} × {a.joursRestants} / {a.joursPeriode} j</td>
                    <td>{a.montant >= 0 ? montant(a.montant) : `Ristourne ${montant(-a.montant)}`}</td>
                    <td>{a.regle === null ? "—" : a.regle ? <Badge ton="vert">Réglé</Badge> : <Badge ton="orange">À encaisser</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

function RattachementDepart({ contrat, disponibles, apres }: { contrat: Contrat; disponibles: Vehicule[]; apres: () => Promise<void> }) {
  const [vehiculeId, setVehiculeId] = useState(disponibles[0]?.id ?? "");
  const [prime, setPrime] = useState("");
  const [erreur, setErreur] = useState("");
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    try {
      await api(`/contrats/${contrat.id}/vehicules`, { corps: { vehiculeId, ...(prime ? { primeVehicule: Number(prime) } : {}) } });
      setPrime("");
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }
  return (
    <form className="formulaire formulaire--grille" aria-label="Rattacher un véhicule de départ" onSubmit={(e) => void soumettre(e)}>
      <Champ libelle="Véhicule de départ" aide={`Couvert du ${dateCourte(contrat.dateEffet)} au ${dateCourte(contrat.dateEcheance)}, inclus dans la prime du contrat.`}>
        <select value={vehiculeId} onChange={(e) => setVehiculeId(e.target.value)}>
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

function NouvelAvenant({ contrat, disponibles, actifs, apres }: {
  contrat: Contrat; disponibles: Vehicule[]; actifs: LigneContrat[]; apres: () => Promise<void>;
}) {
  const [nature, setNature] = useState<"ajout" | "retrait">("ajout");
  const choix = nature === "ajout" ? disponibles.map((v) => ({ id: v.id, immatriculation: v.immatriculation, prime: null as number | null }))
    : actifs.map((v) => ({ id: v.vehiculeId, immatriculation: v.immatriculation, prime: v.primeVehicule }));
  const [vehiculeId, setVehiculeId] = useState("");
  const [dateEffet, setDateEffet] = useState(aujourdHui());
  const [prime, setPrime] = useState("");
  const [apercu, setApercu] = useState<{ montant: number; joursRestants: number; joursPeriode: number; primeVehicule: number } | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  const choisi = choix.find((c) => c.id === vehiculeId) ?? choix[0];
  const primeConnue = nature === "retrait" ? choisi?.prime ?? null : null;
  const corps = () => ({
    vehiculeId: choisi?.id ?? "", nature, dateEffet, ...(prime && !primeConnue ? { primeVehicule: Number(prime) } : {}),
  });

  useEffect(() => setApercu(null), [nature, vehiculeId, dateEffet, prime]);

  async function calculer() {
    setErreur("");
    try {
      setApercu((await api<{ apercu: NonNullable<typeof apercu> }>(`/contrats/${contrat.id}/avenants/apercu`, { corps: corps() })).apercu);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  async function enregistrer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    try {
      const { avenant } = await api<{ avenant: Avenant }>(`/contrats/${contrat.id}/avenants`, { corps: corps() });
      setMessage(avenant.montant >= 0
        ? `Avenant n° ${avenant.numero} enregistré : ${montant(avenant.montant)} à encaisser.`
        : `Avenant n° ${avenant.numero} enregistré : ristourne de ${montant(-avenant.montant)}.`);
      setApercu(null);
      setPrime("");
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  if (choix.length === 0 && nature === "ajout" && actifs.length === 0) return null;
  return (
    <form className="formulaire formulaire--grille avenant" aria-label="Nouvel avenant" onSubmit={(e) => void enregistrer(e)}>
      <Champ libelle="Avenant">
        <select value={nature} onChange={(e) => { setNature(e.target.value as "ajout" | "retrait"); setVehiculeId(""); }}>
          <option value="ajout">Ajouter un véhicule</option>
          <option value="retrait">Retirer un véhicule</option>
        </select>
      </Champ>
      <Champ libelle="Véhicule">
        <select value={choisi?.id ?? ""} onChange={(e) => setVehiculeId(e.target.value)} disabled={choix.length === 0}>
          {choix.length === 0 && <option value="">Aucun véhicule</option>}
          {choix.map((c) => <option key={c.id} value={c.id}>{c.immatriculation}</option>)}
        </select>
      </Champ>
      <Champ libelle="Date d'effet">
        <input type="date" value={dateEffet} min={contrat.dateEffet} max={contrat.dateEcheance} onChange={(e) => setDateEffet(e.target.value)} />
      </Champ>
      <Champ libelle="Prime du véhicule pour la période (F CFA)" aide={primeConnue ? `Connue : ${montant(primeConnue)}` : "Cotation de la compagnie, pour toute la durée du contrat."}>
        <input inputMode="numeric" value={primeConnue ? String(primeConnue) : prime} disabled={!!primeConnue} onChange={(e) => setPrime(e.target.value.replace(/\D/g, ""))} />
      </Champ>
      <div className="formulaire__actions">
        <button type="button" className="bouton" disabled={!choisi} onClick={() => void calculer()}>Calculer le prorata</button>
        <button type="submit" className="bouton bouton--principal" disabled={!apercu}>Enregistrer l'avenant</button>
      </div>
      {apercu && (
        <p className="alerte alerte--info" role="status">
          {montant(apercu.primeVehicule)} × {apercu.joursRestants} jours restants / {apercu.joursPeriode} jours ={" "}
          <strong>{apercu.montant >= 0 ? `${montant(apercu.montant)} à encaisser` : `ristourne de ${montant(-apercu.montant)}`}</strong>
        </p>
      )}
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
    </form>
  );
}

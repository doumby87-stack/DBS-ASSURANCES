// Fiche client : identification (lutte contre le blanchiment, tâche 12).
//   · tous les rôles voient l'état de la fiche et ce qui manque ;
//   · le gérant et le chargé de clientèle la remplissent, joignent les justificatifs, confirment avoir vu l'original ;
//     le n° de pièce ne s'affiche en entier qu'à leur demande (consignée) ;
//   · l'auditeur lit la fiche, sans le n° en entier.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LectureAutomatique, type PieceLisible, type ResultatLecture } from "../../composants/LectureAutomatique";
import { Alerte, Badge, Champ, Chargement, Section, Vide } from "../../composants/communs";
import { api, messageErreur } from "../../services/api";
import { dateCourte, dateHeure } from "../../services/format";
import { useSession } from "../../session";

const TYPES_PIECE: Record<string, string> = {
  cni: "Carte nationale d'identité", passeport: "Passeport", carte_sejour: "Carte de séjour", carte_consulaire: "Carte consulaire",
  permis_conduire: "Permis de conduire", attestation_identite: "Attestation d'identité",
};
const NATURES: Record<string, string> = {
  piece_identite: "Pièce d'identité", justificatif_domicile: "Justificatif de domicile", rccm: "RCCM", statuts: "Statuts",
  liste_beneficiaires: "Liste des bénéficiaires effectifs", autre: "Autre",
};
const RISQUES: Record<string, string> = { faible: "Faible", normal: "Normal", eleve: "Élevé" };
const STATUTS: Record<string, { libelle: string; ton: "vert" | "orange" | "rouge" | "gris" }> = {
  complete: { libelle: "Complète", ton: "vert" }, incomplete: { libelle: "À compléter", ton: "orange" },
  a_revoir: { libelle: "À revoir", ton: "rouge" }, absente: { libelle: "Absente", ton: "gris" },
};

interface Etat { statut: string; niveauRisque: string; manques: string[]; prochaineRevue: string | null }
interface Fiche {
  niveauRisque: string; motifRisque: string | null; personnePolitiquementExposee: boolean; typePiece: string | null;
  numeroPieceFin: string | null; pieceExpireLe: string | null; dateNaissance: string | null; nationalite: string | null;
  activite: string | null; adresse: string | null; numeroContribuable: string | null; formeJuridique: string | null;
  origineFonds: string | null; verifieeLe: string | null; verifieePar: string | null; prochaineRevue: string | null;
}
interface Personne { id: string; nom: string; estDirigeant: boolean; estBeneficiaireEffectif: boolean; partCapital: number | null; personnePolitiquementExposee: boolean }
interface Justificatif { id: string; nature: string; nom: string; taille: number; etatAnalyse: string; deposeLe: string; deposePar: string }
interface Donnees { etat: Etat; fiche: Fiche | null; dirigeants: Personne[]; justificatifs: Justificatif[] }

function lireEnBase64(fichier: File): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.addEventListener("load", () => resoudre(String(lecteur.result).split(",")[1] ?? ""));
    lecteur.addEventListener("error", () => rejeter(lecteur.error));
    lecteur.readAsDataURL(fichier);
  });
}

export function Identification({ clientId, entreprise }: { clientId: string; entreprise: boolean }) {
  const { peut } = useSession();
  const gestion = peut("gerant", "charge_clientele");
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [edition, setEdition] = useState(false);
  const [numero, setNumero] = useState("");

  const charger = useCallback(async () => {
    try {
      setDonnees(await api<Donnees>(`/clients/${clientId}/identification`));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [clientId]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function action(promesse: Promise<unknown>, succes: string) {
    setErreur("");
    setMessage("");
    try {
      await promesse;
      setMessage(succes);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  async function afficherNumero() {
    setErreur("");
    try {
      setNumero((await api<{ numero: string }>(`/clients/${clientId}/identification/numero`, { corps: {} })).numero);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  if (!donnees) return <Section titre="Identification">{erreur ? <Alerte>{erreur}</Alerte> : <Chargement />}</Section>;
  const { etat, fiche } = donnees;
  const statut = STATUTS[etat.statut] ?? STATUTS.absente!;

  return (
    <Section
      titre="Identification (lutte contre le blanchiment)"
      actions={gestion && <button type="button" className="bouton bouton--petit" aria-expanded={edition} onClick={() => setEdition(!edition)}>{edition ? "Fermer" : fiche ? "Modifier la fiche" : "Remplir la fiche"}</button>}
    >
      <p>
        <Badge ton={statut.ton}>Fiche {statut.libelle.toLowerCase()}</Badge>{" "}
        Risque {RISQUES[etat.niveauRisque]?.toLowerCase()}
        {etat.prochaineRevue && <> · prochaine revue le {dateCourte(etat.prochaineRevue)}</>}
      </p>
      {etat.manques.length > 0 && <p className="note">À compléter : {etat.manques.join(", ")}.</p>}
      {etat.niveauRisque === "eleve" && etat.statut !== "complete" && (
        <Alerte type="info">Client à risque élevé : aucun contrat ne peut être souscrit tant que la fiche n'est pas complète et à jour.</Alerte>
      )}
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>

      {fiche && !edition && (
        <dl className="details">
          {!entreprise && (
            <>
              <div>
                <dt>Pièce</dt>
                <dd>
                  {fiche.typePiece ? TYPES_PIECE[fiche.typePiece] : "—"}
                  {fiche.numeroPieceFin && <> n° {numero || `••••${fiche.numeroPieceFin}`}</>}
                  {fiche.pieceExpireLe && <> · expire le {dateCourte(fiche.pieceExpireLe)}</>}
                  {gestion && fiche.numeroPieceFin && !numero && (
                    <> <button type="button" className="bouton bouton--petit" onClick={() => void afficherNumero()}>Afficher le n° en entier</button></>
                  )}
                </dd>
              </div>
              <div><dt>Naissance</dt><dd>{dateCourte(fiche.dateNaissance)}</dd></div>
              <div><dt>Nationalité</dt><dd>{fiche.nationalite ?? "—"}</dd></div>
              <div><dt>Activité</dt><dd>{fiche.activite ?? "—"}</dd></div>
            </>
          )}
          {entreprise && (
            <>
              <div><dt>Forme juridique</dt><dd>{fiche.formeJuridique ?? "—"}</dd></div>
              <div><dt>N° de compte contribuable</dt><dd>{fiche.numeroContribuable ?? "—"}</dd></div>
            </>
          )}
          <div><dt>{entreprise ? "Siège" : "Adresse"}</dt><dd>{fiche.adresse ?? "—"}</dd></div>
          {fiche.personnePolitiquementExposee && <div><dt>Exposition</dt><dd><Badge ton="rouge">Personne politiquement exposée</Badge></dd></div>}
          {fiche.motifRisque && <div><dt>Motif du niveau de risque</dt><dd>{fiche.motifRisque}</dd></div>}
          {fiche.origineFonds && <div><dt>Origine des fonds</dt><dd className="texte-libre">{fiche.origineFonds}</dd></div>}
          <div>
            <dt>Original vu</dt>
            <dd>
              {fiche.verifieeLe ? `le ${dateCourte(fiche.verifieeLe)} par ${fiche.verifieePar}` : "Non"}
              {gestion && (
                <> <button type="button" className="bouton bouton--petit" onClick={() => void action(api(`/clients/${clientId}/identification/verification`, { corps: {} }),
                  "Vérification enregistrée à votre nom.")}>J'ai vu l'original</button></>
              )}
            </dd>
          </div>
        </dl>
      )}
      {!fiche && !gestion && <Vide>Fiche pas encore remplie.</Vide>}

      {gestion && edition && (
        <FormulaireFiche clientId={clientId} entreprise={entreprise} fiche={fiche} justificatifs={donnees.justificatifs}
          apres={async () => { setEdition(false); setNumero(""); setMessage("Fiche enregistrée."); await charger(); }} />
      )}

      {entreprise && fiche && (
        <Dirigeants clientId={clientId} personnes={donnees.dirigeants} gestion={gestion}
          action={(p, s) => void action(p, s)} />
      )}
      {fiche && (
        <Justificatifs clientId={clientId} justificatifs={donnees.justificatifs} gestion={gestion} entreprise={entreprise}
          action={(p, s) => void action(p, s)} />
      )}
    </Section>
  );
}

function FormulaireFiche({ clientId, entreprise, fiche, justificatifs, apres }: {
  clientId: string; entreprise: boolean; fiche: Fiche | null; justificatifs: Justificatif[]; apres: () => Promise<void>;
}) {
  const [s, setS] = useState({
    niveauRisque: fiche?.niveauRisque ?? "normal", motifRisque: fiche?.motifRisque ?? "", ppe: fiche?.personnePolitiquementExposee ?? false,
    typePiece: fiche?.typePiece ?? "cni", numeroPiece: "", pieceExpireLe: fiche?.pieceExpireLe ?? "", dateNaissance: fiche?.dateNaissance ?? "",
    nationalite: fiche?.nationalite ?? "", activite: fiche?.activite ?? "", adresse: fiche?.adresse ?? "",
    numeroContribuable: fiche?.numeroContribuable ?? "", formeJuridique: fiche?.formeJuridique ?? "", origineFonds: fiche?.origineFonds ?? "",
  });
  const [erreur, setErreur] = useState("");
  // Champs pré-remplis par la lecture automatique : surlignés jusqu'à ce que la personne les modifie ou enregistre
  const [lus, setLus] = useState<Set<string>>(new Set());
  const maj = (champ: keyof typeof s) => (e: { target: { value: string } }) => {
    setS({ ...s, [champ]: e.target.value });
    setLus((l) => new Set([...l].filter((c) => c !== champ)));
  };
  const lu = (champ: string) => (lus.has(champ) ? "saisie-lue" : undefined);

  function reporter({ champs }: ResultatLecture) {
    const valeurs: Partial<typeof s> = {};
    if (typeof champs.typePiece === "string" && champs.typePiece in TYPES_PIECE) valeurs.typePiece = champs.typePiece;
    if (typeof champs.numero === "string") valeurs.numeroPiece = champs.numero;
    if (typeof champs.dateExpiration === "string") valeurs.pieceExpireLe = champs.dateExpiration;
    if (typeof champs.dateNaissance === "string") valeurs.dateNaissance = champs.dateNaissance;
    if (typeof champs.nationalite === "string") valeurs.nationalite = champs.nationalite;
    setS((avant) => ({ ...avant, ...valeurs }));
    setLus(new Set(Object.keys(valeurs)));
  }
  const piecesLisibles: PieceLisible[] = justificatifs
    .filter((j) => j.etatAnalyse === "saine" && j.nature === "piece_identite")
    .map((j) => ({ id: j.id, libelle: `Justificatif : ${j.nom}`, source: "justificatifId" }));

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    const facultatif = (cle: string, valeur: string) => (valeur.trim() ? { [cle]: valeur.trim() } : {});
    try {
      await api(`/clients/${clientId}/identification`, {
        methode: "PUT",
        corps: {
          niveauRisque: s.niveauRisque, personnePolitiquementExposee: s.ppe, ...facultatif("motifRisque", s.motifRisque),
          ...(entreprise ? { ...facultatif("numeroContribuable", s.numeroContribuable), ...facultatif("formeJuridique", s.formeJuridique) } : {
            typePiece: s.typePiece, ...facultatif("numeroPiece", s.numeroPiece), ...(s.pieceExpireLe ? { pieceExpireLe: s.pieceExpireLe } : {}),
            ...(s.dateNaissance ? { dateNaissance: s.dateNaissance } : {}), ...facultatif("nationalite", s.nationalite), ...facultatif("activite", s.activite),
          }),
          ...facultatif("adresse", s.adresse), ...facultatif("origineFonds", s.origineFonds),
        },
      });
      await apres();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <>
    {!entreprise && <LectureAutomatique document="piece_identite" pieces={piecesLisibles} libelleReport="Pré-remplir la fiche avec ces valeurs" onLu={reporter} />}
    <form className="formulaire formulaire--grille" aria-label="Fiche d'identification" onSubmit={(e) => void soumettre(e)}>
      {!entreprise && (
        <>
          <Champ libelle="Type de pièce">
            <select className={lu("typePiece")} value={s.typePiece} onChange={maj("typePiece")}>{Object.entries(TYPES_PIECE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Champ>
          <Champ libelle="N° de la pièce" aide={fiche?.numeroPieceFin ? `Enregistré (••••${fiche.numeroPieceFin}) : ne le saisissez que pour le remplacer.` : "Chiffré dès l'enregistrement."}>
            <input className={lu("numeroPiece")} autoComplete="off" maxLength={40} value={s.numeroPiece} onChange={maj("numeroPiece")} />
          </Champ>
          <Champ libelle="Expire le"><input className={lu("pieceExpireLe")} type="date" value={s.pieceExpireLe} onChange={maj("pieceExpireLe")} /></Champ>
          <Champ libelle="Date de naissance"><input className={lu("dateNaissance")} type="date" value={s.dateNaissance} onChange={maj("dateNaissance")} /></Champ>
          <Champ libelle="Nationalité"><input className={lu("nationalite")} maxLength={60} value={s.nationalite} onChange={maj("nationalite")} /></Champ>
          <Champ libelle="Activité (profession)"><input maxLength={120} value={s.activite} onChange={maj("activite")} /></Champ>
        </>
      )}
      {entreprise && (
        <>
          <Champ libelle="Forme juridique"><input maxLength={60} placeholder="SARL, SA, SAS…" value={s.formeJuridique} onChange={maj("formeJuridique")} /></Champ>
          <Champ libelle="N° de compte contribuable"><input maxLength={30} value={s.numeroContribuable} onChange={maj("numeroContribuable")} /></Champ>
        </>
      )}
      <Champ libelle={entreprise ? "Adresse du siège" : "Adresse"}><input maxLength={300} value={s.adresse} onChange={maj("adresse")} /></Champ>
      <Champ libelle="Niveau de risque" aide="Faible ou élevé : motif obligatoire. Élevé : origine des fonds exigée, revue chaque année.">
        <select value={s.niveauRisque} onChange={maj("niveauRisque")}>{Object.entries(RISQUES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Champ>
      <Champ libelle="Motif du niveau de risque"><input maxLength={500} value={s.motifRisque} onChange={maj("motifRisque")} /></Champ>
      <Champ libelle="Origine des fonds"><input maxLength={500} value={s.origineFonds} onChange={maj("origineFonds")} /></Champ>
      <label className="case-a-cocher">
        <input type="checkbox" checked={s.ppe} onChange={(e) => setS({ ...s, ppe: e.target.checked })} />
        <span>Personne politiquement exposée (risque élevé d'office)</span>
      </label>
      <button className="bouton bouton--principal">Enregistrer la fiche</button>
      <Alerte>{erreur}</Alerte>
    </form>
    </>
  );
}

function Dirigeants({ clientId, personnes, gestion, action }: {
  clientId: string; personnes: Personne[]; gestion: boolean; action: (promesse: Promise<unknown>, succes: string) => void;
}) {
  const [s, setS] = useState({ nom: "", dirigeant: true, beneficiaire: false, part: "", ppe: false });

  function ajouter(evenement: FormEvent) {
    evenement.preventDefault();
    action(api(`/clients/${clientId}/dirigeants`, {
      corps: { nom: s.nom, estDirigeant: s.dirigeant, estBeneficiaireEffectif: s.beneficiaire, personnePolitiquementExposee: s.ppe,
        ...(s.part ? { partCapital: Number(s.part) } : {}) },
    }).then(() => setS({ nom: "", dirigeant: true, beneficiaire: false, part: "", ppe: false })), `${s.nom} ajouté.`);
  }

  return (
    <>
      <h3>Dirigeants et bénéficiaires effectifs</h3>
      <p className="note">Bénéficiaire effectif : la personne qui possède ou contrôle l'entreprise en dernier ressort (25 % du capital ou plus, ou le contrôle effectif).</p>
      {personnes.length === 0 ? <Vide>Aucune personne enregistrée.</Vide> : (
        <ul className="liste-simple">
          {personnes.map((p) => (
            <li key={p.id}>
              <strong>{p.nom}</strong> · {[p.estDirigeant && "dirigeant", p.estBeneficiaireEffectif && "bénéficiaire effectif"].filter(Boolean).join(" et ")}
              {p.partCapital !== null && ` · ${p.partCapital} % du capital`}
              {p.personnePolitiquementExposee && <> <Badge ton="rouge">Politiquement exposée</Badge></>}
              {gestion && <> <button type="button" className="bouton bouton--petit" aria-label={`Retirer ${p.nom}`}
                onClick={() => action(api(`/clients/${clientId}/dirigeants/${p.id}`, { methode: "DELETE" }), `${p.nom} retiré.`)}>Retirer</button></>}
            </li>
          ))}
        </ul>
      )}
      {gestion && (
        <form className="formulaire formulaire--grille" aria-label="Ajouter un dirigeant ou un bénéficiaire" onSubmit={ajouter}>
          <Champ libelle="Nom et prénoms"><input required minLength={2} maxLength={160} value={s.nom} onChange={(e) => setS({ ...s, nom: e.target.value })} /></Champ>
          <Champ libelle="Part du capital (%)"><input type="number" min={0} max={100} step="0.01" value={s.part} onChange={(e) => setS({ ...s, part: e.target.value })} /></Champ>
          <label className="case-a-cocher"><input type="checkbox" checked={s.dirigeant} onChange={(e) => setS({ ...s, dirigeant: e.target.checked })} /><span>Dirigeant</span></label>
          <label className="case-a-cocher"><input type="checkbox" checked={s.beneficiaire} onChange={(e) => setS({ ...s, beneficiaire: e.target.checked })} /><span>Bénéficiaire effectif</span></label>
          <label className="case-a-cocher"><input type="checkbox" checked={s.ppe} onChange={(e) => setS({ ...s, ppe: e.target.checked })} /><span>Politiquement exposée</span></label>
          <button className="bouton" disabled={!s.dirigeant && !s.beneficiaire}>Ajouter</button>
        </form>
      )}
    </>
  );
}

function Justificatifs({ clientId, justificatifs, gestion, entreprise, action }: {
  clientId: string; justificatifs: Justificatif[]; gestion: boolean; entreprise: boolean; action: (promesse: Promise<unknown>, succes: string) => void;
}) {
  const [nature, setNature] = useState(entreprise ? "rccm" : "piece_identite");
  const [fichier, setFichier] = useState<File | null>(null);
  const [cle, setCle] = useState(0);

  function deposer(evenement: FormEvent) {
    evenement.preventDefault();
    if (!fichier) return;
    action(lireEnBase64(fichier).then((contenu) =>
      api(`/clients/${clientId}/justificatifs`, { corps: { nature, nom: fichier.name, type: fichier.type, fichier: contenu } }))
      .then(() => { setFichier(null); setCle((c) => c + 1); }), `${fichier.name} joint à la fiche.`);
  }

  return (
    <>
      <h3>Justificatifs</h3>
      {justificatifs.length === 0 ? <Vide>Aucun justificatif.</Vide> : (
        <ul className="liste-simple">
          {justificatifs.map((j) => (
            <li key={j.id}>
              {gestion && j.etatAnalyse === "saine" ? <a href={`/api/clients/${clientId}/justificatifs/${j.id}`} download>{j.nom}</a> : j.nom}
              <small> · {NATURES[j.nature] ?? j.nature} · déposé le {dateHeure(j.deposeLe)} par {j.deposePar}</small>
            </li>
          ))}
        </ul>
      )}
      {gestion && (
        <form className="formulaire formulaire--grille" aria-label="Joindre un justificatif" onSubmit={deposer}>
          <Champ libelle="Nature">
            <select value={nature} onChange={(e) => setNature(e.target.value)}>{Object.entries(NATURES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Champ>
          <Champ libelle="Fichier (JPEG, PNG ou PDF, 5 Mo au plus)">
            <input key={cle} type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
          </Champ>
          <button className="bouton" disabled={!fichier}>Joindre</button>
        </form>
      )}
    </>
  );
}

// Agenda de l'agence (tâche 13) : demandes de rendez-vous du site à confirmer (jour, heure, durée, avec qui),
// rendez-vous à venir jour par jour, rendez-vous passés à clôturer (venu ou non), et rendez-vous fixés au guichet ou
// au téléphone. Les heures sont celles d'Abidjan. Après confirmation, un lien prépare le message WhatsApp au client.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Chargement, Champ, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, messageErreur } from "../../services/api";
import {
  aujourdHui, CRENEAUX, dateCourte, dateHeure, heure, jourAbidjan, lienWhatsApp, MODES_RENDEZ_VOUS, MOTIFS_RENDEZ_VOUS, telephone, TYPES_CLIENT,
} from "../../services/format";
import { useSession } from "../../session";

interface RendezVous {
  id: string;
  numero: number;
  origine: "site" | "agence";
  motif: string;
  mode: string;
  profil: string | null;
  nom: string;
  telephone: string;
  email: string | null;
  message: string | null;
  clientId: string | null;
  nomClient: string | null;
  souhaiteLe: string | null;
  creneauSouhaite: string | null;
  debut: string | null;
  dureeMinutes: number | null;
  avec: string | null;
  nomAvec: string | null;
  statut: "demande" | "confirme" | "honore" | "manque" | "annule";
  motifAnnulation: string | null;
  creeLe: string;
  closLe: string | null;
}

interface Agenda {
  demandes: RendezVous[];
  aVenir: RendezVous[];
  aCloturer: RendezVous[];
  recents: RendezVous[];
  personnes: { id: string; nom: string }[];
}

const STATUTS: Record<RendezVous["statut"], { libelle: string; ton: "bleu" | "vert" | "orange" | "gris" | "rouge" }> = {
  demande: { libelle: "À confirmer", ton: "orange" },
  confirme: { libelle: "Confirmé", ton: "bleu" },
  honore: { libelle: "A eu lieu", ton: "vert" },
  manque: { libelle: "Personne n'est venu", ton: "rouge" },
  annule: { libelle: "Annulé", ton: "gris" },
};
const DUREES = [15, 30, 45, 60, 90, 120];

const jourEnLettres = (jour: string) =>
  new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export function RendezVousPage() {
  const { peut } = useSession();
  const gestion = peut("gerant", "charge_clientele", "commercial");
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  const charger = useCallback(async () => {
    try {
      setAgenda(await api<Agenda>("/rendez-vous"));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function traiter(id: string, corps: Record<string, unknown>, succes: string) {
    setErreur("");
    setMessage("");
    try {
      await api(`/rendez-vous/${id}/traitement`, { corps });
      setMessage(succes);
      await charger();
      return true;
    } catch (e) {
      setErreur(messageErreur(e));
      return false;
    }
  }

  if (!agenda) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  // Rendez-vous à venir, groupés par jour
  const parJour = new Map<string, RendezVous[]>();
  for (const r of agenda.aVenir) {
    const jour = jourAbidjan(r.debut!);
    parJour.set(jour, [...(parJour.get(jour) ?? []), r]);
  }

  return (
    <>
      <h1>Rendez-vous</h1>
      <p>
        Les demandes envoyées par le site indiquent un jour et une demi-journée : fixez l'heure, puis prévenez la personne.
        Notez ensuite si le rendez-vous a eu lieu.
      </p>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>

      <Section titre={`Demandes à confirmer (${agenda.demandes.length})`}>
        {agenda.demandes.length === 0 ? <Vide>Aucune demande en attente.</Vide> : (
          <ul className="liste-cartes">
            {agenda.demandes.map((r) => (
              <li key={r.id} className="carte-rdv">
                <EnTete r={r} />
                <p>Souhaité : <strong>{jourEnLettres(r.souhaiteLe!)}, {CRENEAUX[r.creneauSouhaite!]}</strong> · {MODES_RENDEZ_VOUS[r.mode]}</p>
                {r.message && <p className="texte-libre">{r.message}</p>}
                {gestion && (
                  <>
                    <Confirmation r={r} personnes={agenda.personnes} onConfirmer={(corps) => traiter(r.id, { action: "confirmer", ...corps }, `Rendez-vous n° ${r.numero} confirmé : prévenez ${r.nom}.`)} />
                    <Annulation onAnnuler={(motif) => traiter(r.id, { action: "annuler", motifAnnulation: motif }, `Demande n° ${r.numero} annulée.`)} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {agenda.aCloturer.length > 0 && (
        <Section titre={`Rendez-vous passés à clôturer (${agenda.aCloturer.length})`}>
          <ul className="liste-cartes">
            {agenda.aCloturer.map((r) => (
              <li key={r.id} className="carte-rdv">
                <EnTete r={r} />
                <p>{dateHeure(r.debut!)} · {r.dureeMinutes} min avec {r.nomAvec} · {MODES_RENDEZ_VOUS[r.mode]}</p>
                {gestion && (
                  <div className="formulaire__actions">
                    <button type="button" className="bouton bouton--petit bouton--principal" onClick={() => void traiter(r.id, { action: "honore" }, `Rendez-vous n° ${r.numero} : a eu lieu.`)}>A eu lieu</button>
                    <button type="button" className="bouton bouton--petit" onClick={() => void traiter(r.id, { action: "manque" }, `Rendez-vous n° ${r.numero} : personne n'est venu.`)}>Personne n'est venu</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section titre="À venir">
        {parJour.size === 0 ? <Vide>Aucun rendez-vous fixé.</Vide> : [...parJour.entries()].map(([jour, liste]) => (
          <div key={jour} className="jour-agenda">
            <h3>{jour === aujourdHui() ? "Aujourd'hui" : jourEnLettres(jour)}</h3>
            <ul className="liste-cartes">
              {liste.map((r) => (
                <li key={r.id} className="carte-rdv">
                  <EnTete r={r} heureDebut={`${heure(r.debut!)} · ${r.dureeMinutes} min avec ${r.nomAvec}`} />
                  <p>{MODES_RENDEZ_VOUS[r.mode]}{r.message && ` · ${r.message}`}</p>
                  <p>
                    <a href={lienWhatsApp(r.telephone, messageConfirmation(r))} target="_blank" rel="noopener noreferrer">Envoyer la confirmation sur WhatsApp</a>
                  </p>
                  {gestion && (
                    <details>
                      <summary>Déplacer ou annuler</summary>
                      <Confirmation r={r} personnes={agenda.personnes} libelle="Déplacer" onConfirmer={(corps) => traiter(r.id, { action: "confirmer", ...corps }, `Rendez-vous n° ${r.numero} déplacé : prévenez ${r.nom}.`)} />
                      <Annulation onAnnuler={(motif) => traiter(r.id, { action: "annuler", motifAnnulation: motif }, `Rendez-vous n° ${r.numero} annulé : prévenez ${r.nom}.`)} />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      {gestion && <NouveauRendezVous personnes={agenda.personnes} onCree={async (numero) => { setMessage(`Rendez-vous n° ${numero} fixé.`); await charger(); }} />}

      <Section titre="Clos ces 30 derniers jours">
        {agenda.recents.length === 0 ? <Vide>Aucun.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>N°</th><th>Personne</th><th>Prévu</th><th>Issue</th></tr></thead>
              <tbody>
                {agenda.recents.map((r) => (
                  <tr key={r.id}>
                    <td>n° {r.numero}</td>
                    <td>{r.nom}<br /><span className="note">{MOTIFS_RENDEZ_VOUS[r.motif]}</span></td>
                    <td>{r.debut ? dateHeure(r.debut) : `${dateCourte(r.souhaiteLe)}, ${CRENEAUX[r.creneauSouhaite ?? ""] ?? ""}`}</td>
                    <td><Badge ton={STATUTS[r.statut].ton}>{STATUTS[r.statut].libelle}</Badge>{r.motifAnnulation && <><br /><span className="note">{r.motifAnnulation}</span></>}</td>
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

function EnTete({ r, heureDebut }: { r: RendezVous; heureDebut?: string }) {
  return (
    <p>
      {heureDebut && <><strong>{heureDebut}</strong><br /></>}
      <strong>{r.nom}</strong> · n° {r.numero} <Badge ton={STATUTS[r.statut].ton}>{STATUTS[r.statut].libelle}</Badge><br />
      <span className="note">
        {MOTIFS_RENDEZ_VOUS[r.motif]}{r.profil && ` · ${TYPES_CLIENT[r.profil] ?? r.profil}`} · <a href={`tel:${r.telephone}`}>{telephone(r.telephone)}</a>
        {r.origine === "site" ? " · demandé sur le site" : ""}
        {r.clientId && <> · <Lien href={`/clients/${r.clientId}`}>fiche de {r.nomClient}</Lien></>}
      </span>
    </p>
  );
}

function messageConfirmation(r: RendezVous): string {
  const quand = `le ${jourEnLettres(jourAbidjan(r.debut!))} à ${heure(r.debut!).replace(":", " h ")}`;
  const ou = r.mode === "agence" ? "à l'agence" : r.mode === "telephone" ? "par téléphone : nous vous appellerons" : "chez vous, comme convenu";
  return `Bonjour ${r.nom}, ici DBS-ASSURANCES. Votre rendez-vous n° ${r.numero} est fixé ${quand}, ${ou}. Un empêchement ? Répondez à ce message.`;
}

function Confirmation({ r, personnes, libelle = "Confirmer", onConfirmer }: {
  r: RendezVous; personnes: Agenda["personnes"]; libelle?: string;
  onConfirmer: (corps: { jour: string; heure: string; dureeMinutes: number; avec: string; mode: string }) => Promise<boolean>;
}) {
  const [jour, setJour] = useState(r.debut ? jourAbidjan(r.debut) : r.souhaiteLe ?? aujourdHui(1));
  const [h, setH] = useState(r.debut ? heure(r.debut) : r.creneauSouhaite === "apres_midi" ? "15:00" : "09:00");
  const [duree, setDuree] = useState(r.dureeMinutes ?? 30);
  const [avec, setAvec] = useState(r.avec ?? personnes[0]?.id ?? "");
  const [mode, setMode] = useState(r.mode);
  const [envoi, setEnvoi] = useState(false);

  async function envoyer(evenement: FormEvent) {
    evenement.preventDefault();
    setEnvoi(true);
    await onConfirmer({ jour, heure: h, dureeMinutes: duree, avec, mode });
    setEnvoi(false);
  }

  return (
    <form className="formulaire formulaire--ligne" aria-label={`${libelle} le rendez-vous n° ${r.numero}`} onSubmit={(e) => void envoyer(e)}>
      <Champ libelle="Jour"><input type="date" required value={jour} min={aujourdHui()} onChange={(e) => setJour(e.target.value)} /></Champ>
      <Champ libelle="Heure"><input type="time" required value={h} min="07:00" max="19:50" step={300} onChange={(e) => setH(e.target.value)} /></Champ>
      <Champ libelle="Durée">
        <select value={duree} onChange={(e) => setDuree(Number(e.target.value))}>{DUREES.map((d) => <option key={d} value={d}>{d} min</option>)}</select>
      </Champ>
      <Champ libelle="Avec">
        <select required value={avec} onChange={(e) => setAvec(e.target.value)}>{personnes.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}</select>
      </Champ>
      <Champ libelle="Où">
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          {Object.entries(MODES_RENDEZ_VOUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Champ>
      <button type="submit" className="bouton bouton--principal" disabled={envoi}>{libelle}</button>
    </form>
  );
}

function Annulation({ onAnnuler }: { onAnnuler: (motif: string) => Promise<boolean> }) {
  const [motif, setMotif] = useState("");
  return (
    <form className="formulaire formulaire--ligne" aria-label="Annuler" onSubmit={(e) => { e.preventDefault(); void onAnnuler(motif).then((ok) => ok && setMotif("")); }}>
      <Champ libelle="Motif de l'annulation"><input value={motif} required minLength={3} maxLength={300} onChange={(e) => setMotif(e.target.value)} /></Champ>
      <button type="submit" className="bouton">Annuler le rendez-vous</button>
    </form>
  );
}

function NouveauRendezVous({ personnes, onCree }: { personnes: Agenda["personnes"]; onCree: (numero: number) => Promise<void> }) {
  const parametres = new URLSearchParams(window.location.search);
  const [motif, setMotif] = useState("devis");
  const [mode, setMode] = useState("agence");
  const [nom, setNom] = useState(parametres.get("nom") ?? "");
  const [tel, setTel] = useState(parametres.get("telephone") ?? "");
  const clientId = parametres.get("client") ?? undefined;
  const [jour, setJour] = useState(aujourdHui(1));
  const [h, setH] = useState("09:00");
  const [duree, setDuree] = useState(30);
  const [avec, setAvec] = useState(personnes[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState("");

  async function creer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    try {
      const { numero } = await api<{ numero: number }>("/rendez-vous", {
        corps: { motif, mode, nom: nom.trim(), telephone: tel, jour, heure: h, dureeMinutes: duree, avec, ...(note.trim() ? { message: note.trim() } : {}), ...(clientId ? { clientId } : {}) },
      });
      setNote("");
      await onCree(numero);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <Section titre="Fixer un rendez-vous">
      <form className="formulaire formulaire--grille" aria-label="Fixer un rendez-vous" onSubmit={(e) => void creer(e)}>
        <Champ libelle="Nom"><input required minLength={2} maxLength={160} value={nom} onChange={(e) => setNom(e.target.value)} /></Champ>
        <Champ libelle="Téléphone"><input required type="tel" maxLength={25} value={tel} onChange={(e) => setTel(e.target.value)} /></Champ>
        <Champ libelle="Motif">
          <select value={motif} onChange={(e) => setMotif(e.target.value)}>{Object.entries(MOTIFS_RENDEZ_VOUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Champ>
        <Champ libelle="Où">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>{Object.entries(MODES_RENDEZ_VOUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Champ>
        <Champ libelle="Jour"><input type="date" required value={jour} min={aujourdHui()} onChange={(e) => setJour(e.target.value)} /></Champ>
        <Champ libelle="Heure"><input type="time" required value={h} min="07:00" max="19:50" step={300} onChange={(e) => setH(e.target.value)} /></Champ>
        <Champ libelle="Durée">
          <select value={duree} onChange={(e) => setDuree(Number(e.target.value))}>{DUREES.map((d) => <option key={d} value={d}>{d} min</option>)}</select>
        </Champ>
        <Champ libelle="Avec">
          <select required value={avec} onChange={(e) => setAvec(e.target.value)}>{personnes.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}</select>
        </Champ>
        <Champ libelle="Note (facultatif)"><input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Champ>
        <Alerte>{erreur}</Alerte>
        <div className="formulaire__actions"><button type="submit" className="bouton bouton--principal">Fixer le rendez-vous</button></div>
      </form>
    </Section>
  );
}

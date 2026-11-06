// Caisse : ma caisse depuis la dernière clôture, clôture avec billetage, visa des clôtures par un gérant,
// journal des encaissements du jour pour toutes les caisses.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Chargement, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, messageErreur } from "../../services/api";
import { aujourdHui, COUPURES, dateHeure, montant, MODES_PAIEMENT } from "../../services/format";
import { useSession } from "../../session";
import { PaiementsEnLigne } from "./PaiementsEnLigne";

interface Totaux {
  especes: number;
  cheque: number;
  mobile_money: number;
  virement: number;
  total: number;
  nombre: number;
}

interface Mouvement {
  id: string;
  numeroRecu: number;
  montant: number;
  mode: string;
  reference: string | null;
  encaisseLe: string;
  annuleEncaissementId: string | null;
  clientNom: string;
  numeroPolice: string | null;
}

interface Cloture {
  id: string;
  numero: number;
  caissierId: string;
  caissier: string;
  debut: string | null;
  fin: string;
  nombreEncaissements: number;
  especesAttendues: number;
  totalCheques: number;
  totalMobileMoney: number;
  totalVirements: number;
  especesComptees: number;
  ecart: number;
  commentaire: string | null;
  viseeLe: string | null;
  viseePar: string | null;
}

interface MaCaisse {
  depuis: string | null;
  mouvements: Mouvement[];
  totaux: Totaux;
}

export function Caisse() {
  const { peut } = useSession();
  // Après une clôture, l'historique des clôtures se recharge
  const [version, setVersion] = useState(0);
  return (
    <>
      <h1>Caisse</h1>
      {peut("gerant", "caissier") && <MaCaisseSection apresCloture={() => setVersion((v) => v + 1)} />}
      {peut("gerant", "caissier", "auditeur") && <Clotures key={version} />}
      <JournalDuJour />
      <PaiementsEnLigne />
    </>
  );
}

function CartesTotaux({ totaux }: { totaux: Totaux }) {
  return (
    <div className="cartes">
      <div className="carte carte--bleu"><span className="carte__nombre">{montant(totaux.especes)}</span><span className="carte__titre">Espèces</span></div>
      <div className="carte carte--gris"><span className="carte__nombre">{montant(totaux.mobile_money)}</span><span className="carte__titre">Mobile Money</span></div>
      <div className="carte carte--gris"><span className="carte__nombre">{montant(totaux.cheque)}</span><span className="carte__titre">Chèques</span></div>
      <div className="carte carte--gris"><span className="carte__nombre">{montant(totaux.virement)}</span><span className="carte__titre">Virements</span></div>
    </div>
  );
}

function MaCaisseSection({ apresCloture }: { apresCloture: () => void }) {
  const [caisse, setCaisse] = useState<MaCaisse | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  const charger = useCallback(async () => {
    try {
      setCaisse(await api<MaCaisse>("/caisse"));
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  if (!caisse) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;
  return (
    <Section titre={caisse.depuis ? `Ma caisse depuis la clôture du ${dateHeure(caisse.depuis)}` : "Ma caisse"}>
      <Alerte type="succes">{message}</Alerte>
      <CartesTotaux totaux={caisse.totaux} />
      {caisse.mouvements.length === 0 ? <Vide>Aucun encaissement depuis la dernière clôture.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Reçu</th><th>Heure</th><th>Client</th><th>Mode</th><th>Montant</th></tr></thead>
            <tbody>
              {caisse.mouvements.map((m) => (
                <tr key={m.id}>
                  <td><Lien href={`/recus/${m.id}`}>N° {m.numeroRecu}</Lien>{m.annuleEncaissementId && <> <Badge ton="gris">Contre-passation</Badge></>}</td>
                  <td>{dateHeure(m.encaisseLe)}</td>
                  <td>{m.clientNom}<br /><small>{m.numeroPolice ?? "police à saisir"}</small></td>
                  <td>{MODES_PAIEMENT[m.mode]}{m.reference && <><br /><small>{m.reference}</small></>}</td>
                  <td className="nombre">{montant(m.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FormulaireCloture
        attendues={caisse.totaux.especes}
        apres={async (texte) => {
          setMessage(texte);
          await charger();
          apresCloture();
        }}
      />
    </Section>
  );
}

function FormulaireCloture({ attendues, apres }: { attendues: number; apres: (message: string) => Promise<void> }) {
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const [commentaire, setCommentaire] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const billetage = Object.fromEntries(
    Object.entries(quantites).filter(([, q]) => q.trim() !== "" && Number(q) > 0).map(([c, q]) => [c, Number(q)]),
  );
  const comptees = Object.entries(billetage).reduce((total, [c, q]) => total + Number(c) * q, 0);
  const ecart = comptees - attendues;

  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const { cloture } = await api<{ cloture: Cloture }>("/caisse/clotures", {
        corps: { especesComptees: comptees, billetage, ...(commentaire.trim() ? { commentaire: commentaire.trim() } : {}) },
      });
      setQuantites({});
      setCommentaire("");
      await apres(`Caisse clôturée (clôture n° ${cloture.numero}). Remettez les espèces au gérant avec le billetage.`);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="formulaire cloture" onSubmit={soumettre} aria-labelledby="titre-cloture">
      <h3 id="titre-cloture">Clôturer ma caisse</h3>
      <p className="note">Comptez les espèces (sans le fonds de caisse) et indiquez le nombre de billets et de pièces de chaque valeur.</p>
      <div className="billetage">
        {COUPURES.map((coupure) => (
          <Champ key={coupure} libelle={`${new Intl.NumberFormat("fr-FR").format(coupure)} F`}>
            <input type="number" min={0} step={1} inputMode="numeric" value={quantites[coupure] ?? ""}
                   onChange={(e) => setQuantites({ ...quantites, [coupure]: e.target.value })} />
          </Champ>
        ))}
      </div>
      <dl className="identite">
        <div><dt>Espèces comptées</dt><dd>{montant(comptees)}</dd></div>
        <div><dt>Espèces attendues</dt><dd>{montant(attendues)}</dd></div>
        <div><dt>Écart</dt><dd>{ecart === 0 ? <Badge ton="vert">Aucun</Badge> : <Badge ton="rouge">{montant(ecart)}</Badge>}</dd></div>
      </dl>
      {ecart !== 0 && (
        <Champ libelle="Explication de l'écart" aide="Obligatoire : le gérant la lira avant de viser la clôture">
          <textarea required minLength={5} maxLength={1000} rows={2} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
        </Champ>
      )}
      <div className="formulaire__actions"><button className="bouton bouton--principal" disabled={envoi}>Clôturer la caisse</button></div>
      <Alerte>{erreur}</Alerte>
    </form>
  );
}

function Clotures() {
  const { peut, session } = useSession();
  const [clotures, setClotures] = useState<Cloture[] | null>(null);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(async () => {
    try {
      setClotures((await api<{ clotures: Cloture[] }>("/caisse/clotures")).clotures);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function viser(id: string) {
    setErreur("");
    try {
      await api(`/caisse/clotures/${id}/visa`, { corps: {} });
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <Section titre="Clôtures de caisse">
      <Alerte>{erreur}</Alerte>
      {!clotures ? <Chargement /> : clotures.length === 0 ? <Vide>Aucune clôture pour l'instant.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>N°</th><th>Caisse</th><th>Clôturée le</th><th>Attendu</th><th>Compté</th><th>Écart</th><th>Visa</th></tr></thead>
            <tbody>
              {clotures.map((c) => (
                <tr key={c.id}>
                  <td>{c.numero}</td>
                  <td>{c.caissier}<br /><small>{c.nombreEncaissements} reçu(s)</small></td>
                  <td>{dateHeure(c.fin)}</td>
                  <td className="nombre">{montant(c.especesAttendues)}</td>
                  <td className="nombre">{montant(c.especesComptees)}</td>
                  <td>
                    {c.ecart === 0 ? <Badge ton="vert">Aucun</Badge> : <Badge ton="rouge">{montant(c.ecart)}</Badge>}
                    {c.commentaire && <><br /><small>{c.commentaire}</small></>}
                  </td>
                  <td>
                    {c.viseeLe ? <>{c.viseePar}<br /><small>{dateHeure(c.viseeLe)}</small></>
                      : peut("gerant") && c.caissierId !== session?.utilisateur.id
                        ? <button type="button" className="bouton bouton--petit" onClick={() => void viser(c.id)}>Viser</button>
                        : <Badge ton="orange">À viser</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function JournalDuJour() {
  const [jour, setJour] = useState(aujourdHui());
  const [journal, setJournal] = useState<{ encaissements: (Mouvement & { encaissePar: string })[]; totaux: Totaux } | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setJournal(null);
    api<{ encaissements: (Mouvement & { encaissePar: string })[]; totaux: Totaux }>(`/encaissements?du=${jour}`)
      .then(setJournal)
      .catch((e: unknown) => setErreur(messageErreur(e)));
  }, [jour]);

  return (
    <Section
      titre="Journal des encaissements"
      actions={<Champ libelle="Jour"><input type="date" value={jour} max={aujourdHui()} onChange={(e) => setJour(e.target.value || aujourdHui())} /></Champ>}
    >
      <Alerte>{erreur}</Alerte>
      {!journal ? <Chargement /> : journal.encaissements.length === 0 ? <Vide>Aucun encaissement ce jour-là.</Vide> : (
        <>
          <p>{journal.totaux.nombre} reçu(s), {montant(journal.totaux.total)} au total, dont {montant(journal.totaux.especes)} en espèces.</p>
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Reçu</th><th>Heure</th><th>Client</th><th>Mode</th><th>Montant</th><th>Caisse</th></tr></thead>
              <tbody>
                {journal.encaissements.map((e) => (
                  <tr key={e.id}>
                    <td><Lien href={`/recus/${e.id}`}>N° {e.numeroRecu}</Lien></td>
                    <td>{dateHeure(e.encaisseLe)}</td>
                    <td>{e.clientNom}</td>
                    <td>{MODES_PAIEMENT[e.mode]}</td>
                    <td className="nombre">{montant(e.montant)}</td>
                    <td>{e.encaissePar}</td>
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

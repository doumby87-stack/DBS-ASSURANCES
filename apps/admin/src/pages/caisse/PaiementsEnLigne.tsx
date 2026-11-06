// Paiements en ligne des clients (Mobile Money, depuis leur espace) : encaissés sans passer par une caisse,
// confirmés par le prestataire. Ceux reçus mais non encaissés (montant différent, prime déjà soldée) sont
// « à régulariser » : le gérant rembourse ou affecte la somme, puis note ce qu'il a fait.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Chargement, Section, Vide } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, messageErreur } from "../../services/api";
import { dateHeure, montant, MOYENS_MOBILE_MONEY, STATUTS_PAIEMENT_EN_LIGNE } from "../../services/format";
import { useSession } from "../../session";

interface PaiementEnLigne {
  id: string;
  reference: string;
  montant: number;
  statut: string;
  moyen: string | null;
  referenceOperateur: string | null;
  motif: string | null;
  creeLe: string;
  contratId: string;
  numeroPolice: string | null;
  clientId: string;
  client: string;
  payePar: string | null;
}

function ton(statut: string): "vert" | "orange" | "rouge" | "gris" {
  if (statut === "accepte") return "vert";
  if (statut === "a_regulariser") return "rouge";
  return statut === "initie" || statut === "en_attente" ? "orange" : "gris";
}

export function PaiementsEnLigne() {
  const { peut } = useSession();
  const [paiements, setPaiements] = useState<PaiementEnLigne[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState<string | null>(null);
  const [motif, setMotif] = useState("");

  const charger = useCallback(async () => {
    try {
      setPaiements((await api<{ paiements: PaiementEnLigne[] }>("/paiements-en-ligne")).paiements);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function regulariser(evenement: FormEvent, id: string) {
    evenement.preventDefault();
    setErreur("");
    setMessage("");
    try {
      await api(`/paiements-en-ligne/${id}/regularisation`, { corps: { motif } });
      setMessage("Paiement régularisé.");
      setEnCours(null);
      setMotif("");
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  const aRegulariser = paiements?.filter((p) => p.statut === "a_regulariser").length ?? 0;

  return (
    <Section titre="Paiements en ligne des clients">
      <p className="note">
        Payés depuis l'espace client par Mobile Money et confirmés par le prestataire : encaissés automatiquement, hors caisse (ils n'entrent
        dans aucune clôture). Ils figurent au journal et sur le contrat sous « Paiement en ligne ».
      </p>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
      {aRegulariser > 0 && (
        <Alerte type="info">
          {aRegulariser} paiement(s) reçu(s) mais non encaissé(s) : remboursez le client ou affectez la somme, puis notez-le ici
          {peut("gerant") ? "." : " (gérant)."}
        </Alerte>
      )}
      {!paiements ? (!erreur && <Chargement />) : paiements.length === 0 ? <Vide>Aucun paiement en ligne pour l'instant.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Date</th><th>Client</th><th>Contrat</th><th className="nombre">Montant</th><th>Statut</th><th>Moyen</th></tr></thead>
            <tbody>
              {paiements.map((p) => (
                <tr key={p.id}>
                  <td>{dateHeure(p.creeLe)}<span className="note"><br />{p.reference}</span></td>
                  <td><Lien href={`/clients/${p.clientId}`}>{p.client}</Lien>{p.payePar && p.payePar !== p.client && <span className="note"><br />par {p.payePar}</span>}</td>
                  <td><Lien href={`/contrats/${p.contratId}`}>{p.numeroPolice ?? "N° à venir"}</Lien></td>
                  <td className="nombre">{montant(p.montant)}</td>
                  <td>
                    <Badge ton={ton(p.statut)}>{STATUTS_PAIEMENT_EN_LIGNE[p.statut] ?? p.statut}</Badge>
                    {p.motif && <span className="note texte-libre"><br />{p.motif}</span>}
                    {p.statut === "a_regulariser" && peut("gerant") && (
                      enCours === p.id ? (
                        <form className="formulaire" aria-label={`Régulariser le paiement ${p.reference}`} onSubmit={(e) => void regulariser(e, p.id)}>
                          <label className="champ">
                            <span className="champ__libelle">Ce qui a été fait</span>
                            <input value={motif} required minLength={5} maxLength={300} placeholder="Remboursé par Wave le…" onChange={(e) => setMotif(e.target.value)} />
                          </label>
                          <div className="actions">
                            <button type="submit" className="bouton bouton--petit bouton--principal">Enregistrer</button>
                            <button type="button" className="bouton bouton--petit" onClick={() => setEnCours(null)}>Annuler</button>
                          </div>
                        </form>
                      ) : (
                        <><br /><button type="button" className="bouton bouton--petit" onClick={() => { setEnCours(p.id); setMotif(""); }}>Régulariser</button></>
                      )
                    )}
                  </td>
                  <td>{p.moyen ? MOYENS_MOBILE_MONEY[p.moyen] ?? p.moyen : "—"}{p.referenceOperateur && <span className="note"><br />{p.referenceOperateur}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

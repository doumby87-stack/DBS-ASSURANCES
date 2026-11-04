// Fiche client (entreprise ou professionnel) : accès au portail des entreprises (tâche 10).
// L'agence crée l'accès du titulaire (représentant de l'entreprise) et, au besoin, de ses collaborateurs ;
// le titulaire peut aussi ajouter ou retirer ses collaborateurs depuis le portail. La connexion se fait par
// un code envoyé sur WhatsApp au numéro de l'accès : aucun mot de passe à transmettre.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Section, Vide } from "../../composants/communs";
import { api, messageErreur } from "../../services/api";
import { dateHeure, telephone } from "../../services/format";
import { useSession } from "../../session";

interface Acces {
  id: string;
  nom: string;
  telephone: string;
  role: "titulaire" | "gestionnaire";
  actif: boolean;
  creeLe: string;
  desactiveLe: string | null;
  derniereConnexionLe: string | null;
  creePar: string | null;
}

const ROLES_ACCES = { titulaire: "Titulaire", gestionnaire: "Collaborateur" } as const;

export function AccesPortail({ clientId }: { clientId: string }) {
  const { peut } = useSession();
  const gestion = peut("gerant", "charge_clientele");
  const [acces, setAcces] = useState<Acces[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [nom, setNom] = useState("");
  const [numero, setNumero] = useState("");
  const [role, setRole] = useState<"titulaire" | "gestionnaire">("titulaire");
  const [message, setMessage] = useState("");

  const charger = useCallback(async () => {
    try {
      const liste = (await api<{ acces: Acces[] }>(`/clients/${clientId}/acces-portail`)).acces;
      setAcces(liste);
      // Une fois le titulaire créé, on ajoute plutôt des collaborateurs
      setRole(liste.some((a) => a.actif && a.role === "titulaire") ? "gestionnaire" : "titulaire");
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, [clientId]);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function creer(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setMessage("");
    try {
      const { acces: cree } = await api<{ acces: Acces }>(`/clients/${clientId}/acces-portail`, { corps: { nom, telephone: numero, role } });
      setMessage(`Accès créé pour ${cree.nom} : il se connecte au portail avec son numéro ${telephone(cree.telephone)} et le code reçu sur WhatsApp.`);
      setNom("");
      setNumero("");
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  async function modifier(a: Acces, corps: { actif?: boolean; role?: Acces["role"] }) {
    setErreur("");
    setMessage("");
    try {
      await api(`/acces-portail/${a.id}`, { methode: "PATCH", corps });
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <Section titre="Portail entreprise">
      <p className="note">
        Le portail montre à l'entreprise sa flotte, ses contrats et ce qui reste à payer, les échéances des documents, les attestations
        (à télécharger une à une ou en lot) et l'historique des sinistres. Connexion par un code envoyé sur WhatsApp au numéro de l'accès.
      </p>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
      {acces === null ? null : acces.length === 0 ? <Vide>Aucun accès au portail.</Vide> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr><th>Personne</th><th>Rôle</th><th>Dernière connexion</th><th>État</th>{gestion && <th><span className="visuellement-cache">Actions</span></th>}</tr>
            </thead>
            <tbody>
              {acces.map((a) => (
                <tr key={a.id}>
                  <td>{a.nom}<span className="note"><br />{telephone(a.telephone)}{a.creePar && <> · créé par {a.creePar}</>}</span></td>
                  <td>{ROLES_ACCES[a.role]}</td>
                  <td>{a.derniereConnexionLe ? dateHeure(a.derniereConnexionLe) : <span className="note">Jamais</span>}</td>
                  <td>{a.actif ? <Badge ton="vert">Actif</Badge> : <Badge ton="gris">Retiré le {dateHeure(a.desactiveLe!)}</Badge>}</td>
                  {gestion && (
                    <td>
                      <div className="actions">
                        {a.actif ? (
                          <button type="button" className="bouton bouton--petit" aria-label={`Retirer l'accès de ${a.nom}`} onClick={() => void modifier(a, { actif: false })}>Retirer l'accès</button>
                        ) : (
                          <button type="button" className="bouton bouton--petit" aria-label={`Rétablir l'accès de ${a.nom}`} onClick={() => void modifier(a, { actif: true })}>Rétablir</button>
                        )}
                        {a.actif && a.role === "gestionnaire" && (
                          <button type="button" className="bouton bouton--petit" onClick={() => void modifier(a, { role: "titulaire" })}>Nommer titulaire</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gestion && (
        <form className="formulaire formulaire--grille" aria-label="Nouvel accès au portail" onSubmit={(e) => void creer(e)}>
          <Champ libelle="Nom et prénoms">
            <input value={nom} onChange={(e) => setNom(e.target.value)} required minLength={2} maxLength={120} autoComplete="off" />
          </Champ>
          <Champ libelle="Numéro WhatsApp" aide="Il reçoit le code de connexion. Un numéro, une personne.">
            <input type="tel" value={numero} onChange={(e) => setNumero(e.target.value)} required inputMode="tel" autoComplete="off" />
          </Champ>
          <Champ libelle="Rôle" aide="Le titulaire représente l'entreprise : il peut ajouter ou retirer ses collaborateurs.">
            <select value={role} onChange={(e) => setRole(e.target.value as Acces["role"])}>
              <option value="titulaire">Titulaire</option>
              <option value="gestionnaire">Collaborateur</option>
            </select>
          </Champ>
          <button type="submit" className="bouton bouton--principal">Créer l'accès</button>
        </form>
      )}
    </Section>
  );
}

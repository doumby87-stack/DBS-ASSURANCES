// Accès de l'équipe : chaque personne qui suit la flotte a son propre accès (son numéro, son code).
// Le titulaire ajoute ou retire ses collaborateurs ; un collaborateur voit la liste.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, messageErreur } from "../api";
import { Alerte, Badge, Chargement } from "../composants";
import { dateHeure, telephone, TELEPHONE_AGENCE } from "../format";
import { useSession } from "../session";

interface Acces {
  id: string;
  nom: string;
  telephone: string;
  role: "titulaire" | "gestionnaire";
  derniereConnexionLe: string | null;
  moi: boolean;
}

export function Collaborateurs() {
  const { session } = useSession();
  const titulaire = session?.role === "titulaire";
  const [acces, setAcces] = useState<Acces[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [nom, setNom] = useState("");
  const [numero, setNumero] = useState("");

  const charger = useCallback(async () => {
    try {
      setAcces((await api<{ gestionnaires: Acces[] }>("/portail/gestionnaires")).gestionnaires);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function ajouter(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setMessage("");
    try {
      await api("/portail/gestionnaires", { corps: { nom, telephone: numero } });
      setMessage(`${nom} peut maintenant se connecter avec son numéro : il recevra un code sur WhatsApp.`);
      setNom("");
      setNumero("");
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  async function retirer(a: Acces) {
    setErreur("");
    setMessage("");
    try {
      await api(`/portail/gestionnaires/${a.id}`, { methode: "DELETE" });
      setMessage(`L'accès de ${a.nom} est retiré : il est déconnecté aussitôt.`);
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  return (
    <>
      <h1>Accès de l'équipe</h1>
      <p>
        Chaque personne qui suit la flotte a son propre accès : son numéro WhatsApp, et un code à chaque connexion.
        {titulaire ? " Retirez sans attendre l'accès d'une personne qui quitte l'entreprise." : ` Pour ajouter ou retirer un accès, adressez-vous au titulaire de l'accès de l'entreprise ou à l'agence (${TELEPHONE_AGENCE}).`}
      </p>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{message}</Alerte>
      {!acces ? <Chargement /> : (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead><tr><th>Personne</th><th>Rôle</th><th>Dernière connexion</th>{titulaire && <th><span className="visuellement-cache">Actions</span></th>}</tr></thead>
            <tbody>
              {acces.map((a) => (
                <tr key={a.id}>
                  <td>{a.nom}{a.moi && " (vous)"}<span className="note"><br />{telephone(a.telephone)}</span></td>
                  <td>{a.role === "titulaire" ? <Badge ton="bleu">Titulaire</Badge> : "Collaborateur"}</td>
                  <td>{a.derniereConnexionLe ? dateHeure(a.derniereConnexionLe) : <span className="note">Jamais</span>}</td>
                  {titulaire && (
                    <td>
                      {a.role === "gestionnaire" && !a.moi && (
                        <button type="button" className="bouton bouton--petit" aria-label={`Retirer l'accès de ${a.nom}`} onClick={() => void retirer(a)}>
                          Retirer l'accès
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {titulaire && (
        <form className="formulaire section" aria-label="Ajouter un collaborateur" onSubmit={(e) => void ajouter(e)}>
          <h2>Ajouter un collaborateur</h2>
          <label className="champ">
            <span className="champ__libelle">Nom et prénoms</span>
            <input value={nom} onChange={(e) => setNom(e.target.value)} required minLength={2} maxLength={120} autoComplete="off" />
          </label>
          <label className="champ">
            <span className="champ__libelle">Numéro WhatsApp</span>
            <input type="tel" inputMode="tel" value={numero} onChange={(e) => setNumero(e.target.value)} required autoComplete="off" />
            <span className="champ__aide">Il recevra son code de connexion sur ce numéro. Un numéro, une personne.</span>
          </label>
          <button type="submit" className="bouton bouton--principal">Ajouter</button>
        </form>
      )}
    </>
  );
}

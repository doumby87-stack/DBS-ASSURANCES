// Changement de mot de passe : obligatoire après un mot de passe provisoire, possible à tout moment.

import { useState, type FormEvent } from "react";
import { Alerte, Champ } from "../composants/communs";
import { api, messageErreur } from "../services/api";

export function ChangementMotDePasse({
  actuelConnu,
  email,
  apresChangement,
}: {
  /** Mot de passe saisi juste avant (connexion) : inutile de le redemander. */
  actuelConnu?: string;
  email: string;
  apresChangement: () => void | Promise<void>;
}) {
  const [actuel, setActuel] = useState(actuelConnu ?? "");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState("");
  const [succes, setSucces] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function valider(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setSucces("");
    if (nouveau !== confirmation) {
      setErreur("Les deux saisies du nouveau mot de passe ne correspondent pas.");
      return;
    }
    setEnvoi(true);
    try {
      await api("/auth/mot-de-passe", { corps: { actuel, nouveau } });
      setSucces("Mot de passe modifié. Vos autres sessions ont été fermées.");
      setNouveau("");
      setConfirmation("");
      await apresChangement();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={valider} className="formulaire">
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      {actuelConnu === undefined && (
        <Champ libelle="Mot de passe actuel">
          <input type="password" autoComplete="current-password" required value={actuel} onChange={(e) => setActuel(e.target.value)} />
        </Champ>
      )}
      <Champ libelle="Nouveau mot de passe" aide="Au moins 12 caractères. Une phrase facile à retenir convient très bien : « la mangue verte du marché d'Adjamé ».">
        <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={nouveau} onChange={(e) => setNouveau(e.target.value)} />
      </Champ>
      <Champ libelle="Confirmez le nouveau mot de passe">
        <input type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
      </Champ>
      <Alerte>{erreur}</Alerte>
      <Alerte type="succes">{succes}</Alerte>
      <button className="bouton bouton--principal" disabled={envoi}>Enregistrer le mot de passe</button>
    </form>
  );
}

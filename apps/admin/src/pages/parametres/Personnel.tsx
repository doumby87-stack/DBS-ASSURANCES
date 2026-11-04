// Personnel de l'agence (gérant) : création des comptes, rôles, désactivation, réinitialisation de l'accès.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alerte, Badge, Champ, Chargement, Section } from "../../composants/communs";
import { api, messageErreur, type Role } from "../../services/api";
import { ROLES } from "../../services/format";
import { useSession } from "../../session";

interface Membre {
  id: string;
  email: string;
  nom: string;
  role: Role;
  actif: boolean;
}

export function Personnel() {
  const { session, peut } = useSession();
  const [membres, setMembres] = useState<Membre[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [provisoire, setProvisoire] = useState<{ nom: string; motDePasse: string } | null>(null);

  const charger = useCallback(async () => {
    try {
      setMembres((await api<{ utilisateurs: Membre[] }>("/utilisateurs")).utilisateurs);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => {
    void charger();
  }, [charger]);

  async function action(travail: () => Promise<void>) {
    setErreur("");
    try {
      await travail();
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  const gerant = peut("gerant");
  return (
    <>
      <h1>Personnel</h1>
      {provisoire && (
        <div className="alerte alerte--info" role="alert">
          <p>
            Mot de passe provisoire de <strong>{provisoire.nom}</strong>, affiché <strong>une seule fois</strong> :
            remettez-le en main propre, jamais par message.
          </p>
          <p><code className="secret">{provisoire.motDePasse}</code></p>
          <button type="button" className="bouton bouton--petit" onClick={() => setProvisoire(null)}>C'est noté, masquer</button>
        </div>
      )}
      <Alerte>{erreur}</Alerte>
      {gerant && <NouveauMembre apres={async (nom, motDePasse) => { setProvisoire({ nom, motDePasse }); await charger(); }} />}
      <Section titre="Comptes">
        {!membres ? <Chargement /> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>État</th>{gerant && <th aria-label="Actions" />}</tr></thead>
              <tbody>
                {membres.map((m) => {
                  const moiMeme = m.id === session?.utilisateur.id;
                  return (
                    <tr key={m.id}>
                      <td>{m.nom}{moiMeme && " (vous)"}</td>
                      <td>{m.email}</td>
                      <td>
                        {gerant && !moiMeme ? (
                          <select aria-label={`Rôle de ${m.nom}`} value={m.role}
                            onChange={(e) => void action(() => api(`/utilisateurs/${m.id}`, { methode: "PATCH", corps: { role: e.target.value } }))}>
                            {Object.entries(ROLES).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
                          </select>
                        ) : ROLES[m.role]}
                      </td>
                      <td>{m.actif ? <Badge ton="vert">Actif</Badge> : <Badge ton="gris">Désactivé</Badge>}</td>
                      {gerant && (
                        <td className="actions">
                          {!moiMeme && (
                            <>
                              <button type="button" className="bouton bouton--petit"
                                onClick={() => void action(() => api(`/utilisateurs/${m.id}`, { methode: "PATCH", corps: { actif: !m.actif } }))}>
                                {m.actif ? "Désactiver" : "Réactiver"}
                              </button>
                              <button type="button" className="bouton bouton--petit"
                                onClick={() => {
                                  if (!window.confirm(`Réinitialiser l'accès de ${m.nom} ? Son mot de passe et son deuxième facteur seront remplacés, ses sessions fermées.`)) return;
                                  void action(async () => {
                                    const { motDePasseProvisoire } = await api<{ motDePasseProvisoire: string }>(`/utilisateurs/${m.id}/reinitialiser-acces`, { methode: "POST" });
                                    setProvisoire({ nom: m.nom, motDePasse: motDePasseProvisoire });
                                  });
                                }}>
                                Réinitialiser l'accès
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function NouveauMembre({ apres }: { apres: (nom: string, motDePasse: string) => Promise<void> }) {
  const [champs, setChamps] = useState({ email: "", nom: "", role: "charge_clientele" });
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  async function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const { utilisateur, motDePasseProvisoire } = await api<{ utilisateur: Membre; motDePasseProvisoire: string }>("/utilisateurs", { corps: champs });
      setChamps({ email: "", nom: "", role: "charge_clientele" });
      await apres(utilisateur.nom, motDePasseProvisoire);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <Section titre="Nouveau compte">
      <form className="formulaire formulaire--grille" onSubmit={soumettre}>
        <Champ libelle="Nom et prénoms"><input required minLength={2} maxLength={120} value={champs.nom} onChange={(e) => setChamps({ ...champs, nom: e.target.value })} /></Champ>
        <Champ libelle="Adresse e-mail"><input type="email" required value={champs.email} onChange={(e) => setChamps({ ...champs, email: e.target.value })} /></Champ>
        <Champ libelle="Rôle">
          <select value={champs.role} onChange={(e) => setChamps({ ...champs, role: e.target.value })}>
            {Object.entries(ROLES).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
          </select>
        </Champ>
        <div className="formulaire__actions"><button className="bouton bouton--principal" disabled={envoi}>Créer le compte</button></div>
      </form>
      <Alerte>{erreur}</Alerte>
    </Section>
  );
}

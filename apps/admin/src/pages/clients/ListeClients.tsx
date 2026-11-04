// Liste et recherche des clients ; création, avec alerte si le numéro de téléphone existe déjà.

import { useEffect, useState, type FormEvent } from "react";
import { Alerte, Champ, Chargement, Section, Vide } from "../../composants/communs";
import { Lien, naviguer } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import { TYPES_CLIENT, telephone } from "../../services/format";
import { useSession } from "../../session";

interface ClientResume {
  id: string;
  type: string;
  nom: string;
  telephone: string;
  commune: string | null;
  contratsEnVigueur: number;
}

export function ListeClients() {
  const { peut } = useSession();
  const [recherche, setRecherche] = useState("");
  const [clients, setClients] = useState<ClientResume[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [creation, setCreation] = useState(false);

  useEffect(() => {
    let actif = true;
    const minuterie = window.setTimeout(() => {
      api<{ clients: ClientResume[] }>(`/clients?recherche=${encodeURIComponent(recherche)}`)
        .then((r) => actif && setClients(r.clients))
        .catch((e: unknown) => actif && setErreur(messageErreur(e)));
    }, 250);
    return () => {
      actif = false;
      window.clearTimeout(minuterie);
    };
  }, [recherche]);

  return (
    <>
      <h1>Clients</h1>
      <div className="barre-outils">
        <input
          type="search" className="recherche" placeholder="Rechercher un nom ou un numéro de téléphone"
          aria-label="Rechercher un client" value={recherche} maxLength={80} onChange={(e) => setRecherche(e.target.value)}
        />
        {peut("gerant", "charge_clientele", "commercial", "apporteur") && (
          <button type="button" className="bouton bouton--principal" onClick={() => setCreation(!creation)}>
            {creation ? "Fermer" : "Nouveau client"}
          </button>
        )}
      </div>
      {creation && <NouveauClient />}
      <Alerte>{erreur}</Alerte>
      <Section titre="Résultats">
        {!clients ? <Chargement /> : clients.length === 0 ? <Vide>Aucun client trouvé.</Vide> : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead><tr><th>Nom</th><th>Type</th><th>Téléphone</th><th>Commune</th><th>Contrats en vigueur</th></tr></thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td><Lien href={`/clients/${c.id}`}>{c.nom}</Lien></td>
                    <td>{TYPES_CLIENT[c.type]}</td>
                    <td>{telephone(c.telephone)}</td>
                    <td>{c.commune ?? "—"}</td>
                    <td>{c.contratsEnVigueur}</td>
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

function NouveauClient() {
  const [champs, setChamps] = useState({ type: "particulier", nom: "", telephone: "", email: "", commune: "" });
  const [doublons, setDoublons] = useState<{ id: string; nom: string }[]>([]);
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const modifier = (nom: keyof typeof champs) => (e: { target: { value: string } }) => setChamps({ ...champs, [nom]: e.target.value });

  async function creer(confirmerDoublon: boolean) {
    setErreur("");
    setEnvoi(true);
    try {
      const corps = Object.fromEntries(Object.entries(champs).filter(([, valeur]) => valeur.trim() !== ""));
      const { client } = await api<{ client: { id: string } }>("/clients", {
        corps: { ...corps, ...(confirmerDoublon ? { confirmerDoublon: true } : {}) },
      });
      naviguer(`/clients/${client.id}`);
    } catch (e) {
      if (e instanceof ErreurApi && e.code === "doublon_possible") setDoublons(e.donnees.doublons as { id: string; nom: string }[]);
      else setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    void creer(false);
  }

  return (
    <Section titre="Nouveau client">
      <form className="formulaire formulaire--grille" onSubmit={soumettre}>
        <Champ libelle="Type">
          <select value={champs.type} onChange={modifier("type")}>
            {Object.entries(TYPES_CLIENT).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
          </select>
        </Champ>
        <Champ libelle="Nom et prénoms ou raison sociale">
          <input required minLength={2} maxLength={160} value={champs.nom} onChange={modifier("nom")} />
        </Champ>
        <Champ libelle="Téléphone" aide="10 chiffres, ou numéro étranger commençant par +">
          <input type="tel" required value={champs.telephone} onChange={modifier("telephone")} placeholder="07 00 00 00 00" />
        </Champ>
        <Champ libelle="E-mail (facultatif)">
          <input type="email" value={champs.email} onChange={modifier("email")} />
        </Champ>
        <Champ libelle="Commune (facultatif)">
          <input maxLength={80} value={champs.commune} onChange={modifier("commune")} />
        </Champ>
        <div className="formulaire__actions">
          <button className="bouton bouton--principal" disabled={envoi}>Créer le client</button>
        </div>
      </form>
      <Alerte>{erreur}</Alerte>
      {doublons.length > 0 && (
        <div className="alerte alerte--info" role="alert">
          <p>Ce numéro est déjà celui de :</p>
          <ul>{doublons.map((d) => <li key={d.id}><Lien href={`/clients/${d.id}`}>{d.nom}</Lien></li>)}</ul>
          <button type="button" className="bouton" onClick={() => void creer(true)} disabled={envoi}>
            C'est une autre personne : créer quand même
          </button>
        </div>
      )}
    </Section>
  );
}

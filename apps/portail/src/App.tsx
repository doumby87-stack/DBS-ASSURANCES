// Coquille du portail : connexion, puis en-tête de l'entreprise et pages de la flotte.

import { Chargement } from "./composants";
import { TELEPHONE_AGENCE, WHATSAPP_AGENCE } from "./format";
import { Collaborateurs } from "./pages/Collaborateurs";
import { Connexion } from "./pages/Connexion";
import { TableauDeBord } from "./pages/TableauDeBord";
import { Vehicule } from "./pages/Vehicule";
import { Lien, useChemin } from "./routeur";
import { useSession } from "./session";

export function App() {
  const { session, fermer } = useSession();
  const chemin = useChemin();

  if (session === undefined) return <main className="page"><Chargement /></main>;
  if (session === null) return <Connexion />;

  const vehicule = /^\/vehicules\/([0-9a-f-]{36})$/.exec(chemin)?.[1];
  let page;
  if (chemin === "/") page = <TableauDeBord />;
  else if (vehicule) page = <Vehicule id={vehicule} />;
  else if (chemin === "/collaborateurs") page = <Collaborateurs />;
  else page = <><h1>Page introuvable</h1><p><Lien href="/">Retour à votre flotte</Lien></p></>;

  return (
    <>
      <a className="evitement" href="#contenu">Aller au contenu</a>
      <header className="entete">
        <div className="entete__haut">
          <Lien href="/" className="entete__marque" aria-label="DBS-ASSURANCES, espace entreprise : accueil">
            DBS-ASSURANCES <span>Espace entreprise</span>
          </Lien>
          <button type="button" className="bouton bouton--clair bouton--petit" onClick={() => void fermer()}>Se déconnecter</button>
        </div>
        <p className="entete__entreprise"><strong>{session.entreprise}</strong> · {session.nom}</p>
        <nav aria-label="Navigation principale" className="entete__navigation">
          <Lien href="/" aria-current={chemin === "/" ? "page" : undefined}>Ma flotte</Lien>
          <Lien href="/collaborateurs" aria-current={chemin === "/collaborateurs" ? "page" : undefined}>Accès de l'équipe</Lien>
        </nav>
      </header>
      <main id="contenu" className="page">{page}</main>
      <footer className="pied">
        Une question sur un contrat, une attestation ou un sinistre ? Votre agence : <a href={`tel:+225${TELEPHONE_AGENCE.replace(/\s/g, "")}`}>{TELEPHONE_AGENCE}</a>
        {" "}ou <a href={WHATSAPP_AGENCE} target="_blank" rel="noopener noreferrer">WhatsApp</a>.
        <br />DBS-ASSURANCES, Agent Général SanlamAllianz Côte d'Ivoire.
      </footer>
    </>
  );
}

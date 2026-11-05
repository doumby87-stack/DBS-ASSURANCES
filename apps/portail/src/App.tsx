// Coquille de l'espace client : connexion, puis en-tête du client et ses pages. Une entreprise y suit sa
// flotte et les accès de son équipe ; un particulier, ses contrats. Tous paient en ligne et déclarent leurs
// sinistres.

import { Chargement } from "./composants";
import { TELEPHONE_AGENCE, WHATSAPP_AGENCE } from "./format";
import { Collaborateurs } from "./pages/Collaborateurs";
import { Connexion } from "./pages/Connexion";
import { HistoriquePaiements, PagePaiement, Payer } from "./pages/Paiements";
import { DeclarerSinistre, DetailSinistre, ListeSinistres } from "./pages/Sinistres";
import { TableauDeBord } from "./pages/TableauDeBord";
import { Vehicule } from "./pages/Vehicule";
import { Lien, useChemin } from "./routeur";
import { useSession } from "./session";

const UUID = "([0-9a-f-]{36})";

export function App() {
  const { session, fermer } = useSession();
  const chemin = useChemin();

  if (session === undefined) return <main className="page"><Chargement /></main>;
  if (session === null) return <Connexion />;

  const particulier = session.typeClient === "particulier";
  const accueil = particulier ? "Mes contrats" : "Ma flotte";
  const parametre = (motif: string) => new RegExp(`^${motif.replace("ID", UUID)}$`).exec(chemin)?.[1];
  let page;
  if (chemin === "/") page = <TableauDeBord />;
  else if (parametre("/vehicules/ID")) page = <Vehicule id={parametre("/vehicules/ID")!} />;
  else if (parametre("/payer/ID")) page = <Payer contratId={parametre("/payer/ID")!} />;
  else if (chemin === "/paiements") page = <HistoriquePaiements />;
  else if (parametre("/paiements/ID")) page = <PagePaiement id={parametre("/paiements/ID")!} />;
  else if (chemin === "/sinistres") page = <ListeSinistres />;
  else if (chemin === "/sinistres/declarer") page = <DeclarerSinistre />;
  else if (parametre("/sinistres/ID")) page = <DetailSinistre id={parametre("/sinistres/ID")!} />;
  else if (chemin === "/collaborateurs" && !particulier) page = <Collaborateurs />;
  else page = <><h1>Page introuvable</h1><p><Lien href="/">Retour à l'accueil</Lien></p></>;

  const actif = (prefixe: string) => (prefixe === "/" ? chemin === "/" || chemin.startsWith("/vehicules/") : chemin.startsWith(prefixe)) ? "page" : undefined;

  return (
    <>
      <a className="evitement" href="#contenu">Aller au contenu</a>
      <header className="entete">
        <div className="entete__haut">
          <Lien href="/" className="entete__marque" aria-label="DBS-ASSURANCES, espace client : accueil">
            DBS-ASSURANCES <span>Espace client</span>
          </Lien>
          <button type="button" className="bouton bouton--clair bouton--petit" onClick={() => void fermer()}>Se déconnecter</button>
        </div>
        <p className="entete__entreprise">
          {particulier ? <strong>{session.nom}</strong> : <><strong>{session.entreprise}</strong> · {session.nom}</>}
        </p>
        <nav aria-label="Navigation principale" className="entete__navigation">
          <Lien href="/" aria-current={actif("/")}>{accueil}</Lien>
          <Lien href="/sinistres" aria-current={actif("/sinistres")}>Sinistres</Lien>
          <Lien href="/paiements" aria-current={actif("/paiements") ?? actif("/payer")}>Paiements</Lien>
          {!particulier && <Lien href="/collaborateurs" aria-current={actif("/collaborateurs")}>Accès de l'équipe</Lien>}
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

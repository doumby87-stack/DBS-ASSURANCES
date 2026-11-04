// Assemblage : connexion, ou mise en page et page demandée.

import type { ReactNode } from "react";
import { Chargement } from "./composants/communs";
import { Caisse } from "./pages/caisse/Caisse";
import { PageRecu } from "./pages/caisse/Recu";
import { FicheClient } from "./pages/clients/FicheClient";
import { ListeClients } from "./pages/clients/ListeClients";
import { Commissions } from "./pages/commissions/Commissions";
import { Contrat } from "./pages/contrats/Contrat";
import { Personnel } from "./pages/parametres/Personnel";
import { PageBordereau } from "./pages/reversements/Bordereau";
import { Reversements } from "./pages/reversements/Reversements";
import { TableauDeBord } from "./pages/tableau-de-bord/TableauDeBord";
import { Lien, useChemin } from "./routeur";
import { ChangementMotDePasse } from "./securite/ChangementMotDePasse";
import { Connexion } from "./securite/Connexion";
import { ROLES } from "./services/format";
import { useSession } from "./session";

export function App() {
  const { session, chargement, recharger } = useSession();
  if (chargement) return <Chargement />;
  if (!session) return <Connexion />;
  if (session.motDePasseProvisoire) {
    return (
      <main className="connexion">
        <div className="connexion__carte">
          <h1>Choisissez votre mot de passe</h1>
          <p>Le mot de passe remis par le gérant est provisoire : remplacez-le avant de continuer.</p>
          <ChangementMotDePasse email={session.utilisateur.email} apresChangement={recharger} />
        </div>
      </main>
    );
  }
  return (
    <MiseEnPage>
      <Page />
    </MiseEnPage>
  );
}

function Page() {
  const chemin = useChemin();
  const { session, peut, recharger } = useSession();
  if (chemin === "/") return <TableauDeBord />;
  if (chemin === "/clients") return <ListeClients />;
  const client = /^\/clients\/([0-9a-f-]{36})$/.exec(chemin);
  if (client) return <FicheClient key={client[1]} id={client[1]!} />;
  const contrat = /^\/contrats\/([0-9a-f-]{36})$/.exec(chemin);
  if (contrat) return <Contrat key={contrat[1]} id={contrat[1]!} />;
  const recu = /^\/recus\/([0-9a-f-]{36})$/.exec(chemin);
  if (recu) return <PageRecu key={recu[1]} id={recu[1]!} />;
  if (chemin === "/caisse") return <Caisse />;
  if (chemin === "/reversements") return <Reversements />;
  const bordereau = /^\/reversements\/([0-9a-f-]{36})$/.exec(chemin);
  if (bordereau) return <PageBordereau key={bordereau[1]} id={bordereau[1]!} />;
  if (chemin === "/commissions") return <Commissions />;
  if (chemin === "/personnel") return <Personnel />;
  if (chemin === "/mon-compte") {
    return (
      <>
        <h1>Mon compte</h1>
        <p>{session?.utilisateur.nom} · {session && ROLES[session.utilisateur.role]} · {session?.utilisateur.email}</p>
        <h2>Changer de mot de passe</h2>
        <ChangementMotDePasse email={session?.utilisateur.email ?? ""} apresChangement={recharger} />
        {peut("gerant") && <p className="note">Téléphone perdu ou deuxième facteur à refaire : demandez à un autre gérant de réinitialiser votre accès.</p>}
      </>
    );
  }
  return <><h1>Page introuvable</h1><p><Lien href="/">Retour au tableau de bord</Lien></p></>;
}

function MiseEnPage({ children }: { children: ReactNode }) {
  const { session, peut, deconnecter } = useSession();
  const chemin = useChemin();
  const actif = (prefixe: string) => (prefixe === "/" ? chemin === "/" : chemin.startsWith(prefixe)) ? "page" : undefined;
  return (
    <>
      <a className="lien-evitement" href="#contenu">Aller au contenu</a>
      <header className="entete">
        <div className="entete__interieur">
          <Lien href="/" className="entete__marque">DBS-ASSURANCES <span>Gestion</span></Lien>
          <nav aria-label="Navigation principale" className="entete__nav">
            <Lien href="/" aria-current={actif("/")}>Échéances</Lien>
            <Lien href="/clients" aria-current={actif("/clients")}>Clients</Lien>
            {peut("gerant", "caissier", "charge_clientele", "auditeur") && <Lien href="/caisse" aria-current={actif("/caisse")}>Caisse</Lien>}
            {peut("gerant", "caissier", "auditeur") && <Lien href="/reversements" aria-current={actif("/reversements")}>Reversements</Lien>}
            {peut("gerant", "auditeur") && <Lien href="/commissions" aria-current={actif("/commissions")}>Commissions</Lien>}
            {peut("gerant") && <Lien href="/personnel" aria-current={actif("/personnel")}>Personnel</Lien>}
          </nav>
          <div className="entete__compte">
            <Lien href="/mon-compte">{session?.utilisateur.nom}</Lien>
            <span className="entete__role">{session && ROLES[session.utilisateur.role]}</span>
            <button type="button" className="bouton bouton--clair bouton--petit" onClick={() => void deconnecter()}>Se déconnecter</button>
          </div>
        </div>
      </header>
      <main id="contenu" className="contenu">{children}</main>
    </>
  );
}

// Connexion du personnel : mot de passe, puis deuxième facteur (configuré à la première connexion),
// puis mot de passe personnel si celui remis par le gérant est encore provisoire.

import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { Alerte, Champ } from "../composants/communs";
import { api, messageErreur } from "../services/api";
import { useSession } from "../session";
import { ChangementMotDePasse } from "./ChangementMotDePasse";

type Etape = "identifiants" | "configuration_mfa" | "mfa" | "mot_de_passe";

export function Connexion() {
  const { recharger } = useSession();
  const [etape, setEtape] = useState<Etape>("identifiants");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function terminer(reponse: { motDePasseProvisoire: boolean }) {
    if (reponse.motDePasseProvisoire) setEtape("mot_de_passe");
    else {
      setMotDePasse("");
      await recharger();
    }
  }

  async function seConnecter(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const reponse = await api<{ etape: "mfa" | "configuration_mfa" }>("/auth/connexion", { corps: { email, motDePasse } });
      setEtape(reponse.etape);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <main className="connexion">
      <div className="connexion__carte">
        <p className="connexion__marque">DBS-ASSURANCES</p>
        <h1>Espace de gestion</h1>

        {etape === "identifiants" && (
          <form onSubmit={seConnecter} className="formulaire">
            <Champ libelle="Adresse e-mail">
              <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Champ>
            <Champ libelle="Mot de passe">
              <input type="password" autoComplete="current-password" required value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
            </Champ>
            <Alerte>{erreur}</Alerte>
            <button className="bouton bouton--principal" disabled={envoi}>Continuer</button>
          </form>
        )}

        {etape === "configuration_mfa" && <ConfigurationDeuxiemeFacteur email={email} terminer={terminer} />}
        {etape === "mfa" && <CodeDeuxiemeFacteur terminer={terminer} />}

        {etape === "mot_de_passe" && (
          <>
            <p>Dernière étape : remplacez le mot de passe provisoire remis par le gérant par un mot de passe personnel.</p>
            <ChangementMotDePasse actuelConnu={motDePasse} email={email} apresChangement={recharger} />
          </>
        )}
      </div>
      <p className="connexion__pied">Accès réservé au personnel de l'agence. Chaque connexion est enregistrée.</p>
    </main>
  );
}

function SaisieCode({ libelleBouton, envoyer }: { libelleBouton: string; envoyer: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function valider(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      await envoyer(code);
    } catch (e) {
      setErreur(messageErreur(e));
      setCode("");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={valider} className="formulaire">
      <Champ libelle="Code à 6 chiffres affiché par l'application">
        <input
          className="saisie-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </Champ>
      <Alerte>{erreur}</Alerte>
      <button className="bouton bouton--principal" disabled={envoi || code.length !== 6}>{libelleBouton}</button>
    </form>
  );
}

function ConfigurationDeuxiemeFacteur({ email, terminer }: { email: string; terminer: (r: { motDePasseProvisoire: boolean }) => Promise<void> }) {
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let actif = true;
    api<{ secret: string; uri: string }>("/auth/mfa/configuration", { methode: "POST" })
      .then(async ({ secret, uri }) => {
        // QR code dessiné dans le navigateur : le secret n'est envoyé à aucun service extérieur
        const image = await QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: "M" });
        if (actif) {
          setSecret(secret);
          setQr(image);
        }
      })
      .catch((e: unknown) => actif && setErreur(messageErreur(e)));
    return () => {
      actif = false;
    };
  }, []);

  return (
    <div className="mfa">
      <h2>Protégez votre compte</h2>
      <ol className="etapes">
        <li>Installez une application d'authentification sur votre téléphone : Google Authenticator, Microsoft Authenticator ou Aegis.</li>
        <li>Dans l'application, ajoutez un compte en scannant ce QR code.</li>
        <li>Saisissez le code à 6 chiffres qu'elle affiche.</li>
      </ol>
      <Alerte>{erreur}</Alerte>
      {qr && (
        <figure className="mfa__qr">
          <img src={qr} alt={`QR code du compte ${email}`} width={220} height={220} />
          <figcaption>
            Impossible de scanner ? Saisissez cette clé : <code className="secret">{secret.match(/.{1,4}/g)?.join(" ")}</code>
          </figcaption>
        </figure>
      )}
      <SaisieCode
        libelleBouton="Activer et continuer"
        envoyer={async (code) => terminer(await api("/auth/mfa/activation", { corps: { code } }))}
      />
    </div>
  );
}

function CodeDeuxiemeFacteur({ terminer }: { terminer: (r: { motDePasseProvisoire: boolean }) => Promise<void> }) {
  return (
    <div className="mfa">
      <h2>Deuxième vérification</h2>
      <p>Ouvrez votre application d'authentification et saisissez le code de DBS-ASSURANCES.</p>
      <SaisieCode libelleBouton="Se connecter" envoyer={async (code) => terminer(await api("/auth/mfa", { corps: { code } }))} />
    </div>
  );
}

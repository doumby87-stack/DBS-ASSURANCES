// Connexion au portail : le numéro WhatsApp de l'accès, puis le code reçu (6 chiffres, 10 minutes).
// Aucun mot de passe : rien à retenir, rien à se faire voler.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, messageErreur } from "../api";
import { Alerte } from "../composants";
import { TELEPHONE_AGENCE, WHATSAPP_AGENCE } from "../format";
import { useSession, type Session } from "../session";

export function Connexion() {
  const { ouvrir } = useSession();
  const [etape, setEtape] = useState<"numero" | "code">("numero");
  const [telephone, setTelephone] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const champCode = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (etape === "code") champCode.current?.focus();
  }, [etape]);

  async function demanderCode(evenement?: FormEvent) {
    evenement?.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const reponse = await api<{ message: string }>("/portail/connexion/code", { corps: { telephone } });
      setMessage(reponse.message);
      setCode("");
      setEtape("code");
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  }

  async function seConnecter(evenement: FormEvent) {
    evenement.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const { session } = await api<{ session: Session }>("/portail/connexion", { corps: { telephone, code } });
      ouvrir(session);
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
        <h1>Espace entreprise</h1>
        <p className="note">Votre flotte, vos attestations, vos échéances et vos sinistres, au même endroit.</p>

        {etape === "numero" ? (
          <form className="formulaire" aria-label="Recevoir un code de connexion" onSubmit={(e) => void demanderCode(e)}>
            <label className="champ">
              <span className="champ__libelle">Votre numéro WhatsApp</span>
              <input type="tel" name="telephone" inputMode="tel" autoComplete="tel" required value={telephone}
                placeholder="07 00 00 00 00" onChange={(e) => setTelephone(e.target.value)} />
              <span className="champ__aide">Celui que l'agence a enregistré pour votre accès.</span>
            </label>
            <Alerte>{erreur}</Alerte>
            <button type="submit" className="bouton bouton--principal" disabled={envoi || telephone.trim().length < 8}>
              {envoi ? "Envoi…" : "Recevoir mon code"}
            </button>
          </form>
        ) : (
          <form className="formulaire" aria-label="Saisir le code reçu" onSubmit={(e) => void seConnecter(e)}>
            <Alerte type="info">{message}</Alerte>
            <label className="champ">
              <span className="champ__libelle">Code reçu sur WhatsApp</span>
              <input ref={champCode} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
                value={code} className="champ__code" onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
              <span className="champ__aide">6 chiffres. Ne le communiquez à personne : l'agence ne vous le demandera jamais.</span>
            </label>
            <Alerte>{erreur}</Alerte>
            <button type="submit" className="bouton bouton--principal" disabled={envoi || code.length !== 6}>
              {envoi ? "Vérification…" : "Se connecter"}
            </button>
            <div className="connexion__liens">
              <button type="button" className="bouton bouton--lien" onClick={() => void demanderCode()} disabled={envoi}>Renvoyer un code</button>
              <button type="button" className="bouton bouton--lien" onClick={() => { setEtape("numero"); setErreur(""); }}>Changer de numéro</button>
            </div>
          </form>
        )}

        <p className="note connexion__aide">
          Pas encore d'accès, ou plus de code reçu ? Appelez l'agence au <a href={`tel:+225${TELEPHONE_AGENCE.replace(/\s/g, "")}`}>{TELEPHONE_AGENCE}</a>
          {" "}ou écrivez-lui sur <a href={WHATSAPP_AGENCE} target="_blank" rel="noopener noreferrer">WhatsApp</a>.
        </p>
      </div>
    </main>
  );
}

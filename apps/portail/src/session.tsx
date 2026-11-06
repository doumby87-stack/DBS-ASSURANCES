// Session du portail : la personne connectée, son rôle, son entreprise (ou elle-même, pour un particulier). Lue auprès de l'API au chargement ;
// perdue (expirée, accès retiré) dès qu'une réponse le signale.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ErreurApi, quandSessionPerdue } from "./api";

export interface Session {
  nom: string;
  role: "titulaire" | "gestionnaire";
  /** Nom du client : l'entreprise, ou le particulier lui-même */
  entreprise: string;
  telephone: string;
  typeClient: "particulier" | "professionnel" | "entreprise";
}

interface ContexteSession {
  /** undefined : vérification en cours ; null : personne n'est connecté */
  session: Session | null | undefined;
  ouvrir(session: Session): void;
  fermer(): Promise<void>;
}

const Contexte = createContext<ContexteSession | null>(null);

export function FournisseurSession({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    quandSessionPerdue(() => setSession(null));
    api<{ session: Session }>("/portail/session")
      .then((r) => setSession(r.session))
      .catch((e: unknown) => {
        if (!(e instanceof ErreurApi) || e.statut !== 401) console.error(e);
        setSession(null);
      });
  }, []);

  const fermer = useCallback(async () => {
    await api("/portail/deconnexion", { methode: "POST" }).catch(() => undefined);
    setSession(null);
  }, []);

  return <Contexte.Provider value={{ session, ouvrir: setSession, fermer }}>{children}</Contexte.Provider>;
}

export function useSession(): ContexteSession {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error("useSession hors de FournisseurSession");
  return contexte;
}

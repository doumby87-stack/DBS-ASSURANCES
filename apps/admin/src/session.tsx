// Session de la personne connectée, partagée par toutes les pages.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ErreurApi, quandSessionPerdue, type Role, type Session } from "./services/api";

interface ContexteSession {
  session: Session | null;
  chargement: boolean;
  recharger: () => Promise<void>;
  deconnecter: () => Promise<void>;
  /** La personne a-t-elle l'un de ces rôles ? Sert à masquer des actions : l'API vérifie de toute façon. */
  peut: (...roles: Role[]) => boolean;
}

const Contexte = createContext<ContexteSession | null>(null);

export function FournisseurSession({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [chargement, setChargement] = useState(true);

  const recharger = useCallback(async () => {
    try {
      setSession(await api<Session>("/auth/session"));
    } catch (erreur) {
      if (erreur instanceof ErreurApi && (erreur.statut === 401 || erreur.statut === 403)) setSession(null);
      else throw erreur;
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    quandSessionPerdue(() => setSession(null));
    void recharger();
  }, [recharger]);

  const deconnecter = useCallback(async () => {
    try {
      await api("/auth/deconnexion", { methode: "POST" });
    } finally {
      setSession(null);
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const peut = useCallback((...roles: Role[]) => !!session && roles.includes(session.utilisateur.role), [session]);

  return <Contexte.Provider value={{ session, chargement, recharger, deconnecter, peut }}>{children}</Contexte.Provider>;
}

export function useSession(): ContexteSession {
  const contexte = useContext(Contexte);
  if (!contexte) throw new Error("useSession hors de FournisseurSession");
  return contexte;
}

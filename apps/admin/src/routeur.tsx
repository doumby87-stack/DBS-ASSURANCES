// Navigation entre les pages, sans dépendance : l'historique du navigateur suffit pour quelques écrans.

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

const EVENEMENT = "dbs:navigation";

export function naviguer(chemin: string): void {
  if (chemin === window.location.pathname) return;
  window.history.pushState(null, "", chemin);
  window.dispatchEvent(new Event(EVENEMENT));
  window.scrollTo(0, 0);
}

export function useChemin(): string {
  const [chemin, setChemin] = useState(window.location.pathname);
  useEffect(() => {
    const suivre = () => setChemin(window.location.pathname);
    window.addEventListener("popstate", suivre);
    window.addEventListener(EVENEMENT, suivre);
    return () => {
      window.removeEventListener("popstate", suivre);
      window.removeEventListener(EVENEMENT, suivre);
    };
  }, []);
  return chemin;
}

/** Lien interne : change de page sans recharger. */
export function Lien({ href, onClick, ...autres }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function cliquer(evenement: MouseEvent<HTMLAnchorElement>) {
    onClick?.(evenement);
    if (evenement.defaultPrevented || evenement.button !== 0 || evenement.metaKey || evenement.ctrlKey || evenement.shiftKey) return;
    evenement.preventDefault();
    naviguer(href);
  }
  return <a href={href} onClick={cliquer} {...autres} />;
}

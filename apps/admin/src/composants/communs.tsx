// Petits composants partagés. Aucun attribut style="…" : la politique de sécurité du contenu les interdit.

import { cloneElement, useId, type ReactElement, type ReactNode } from "react";

export function Alerte({ type = "erreur", children }: { type?: "erreur" | "succes" | "info"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p className={`alerte alerte--${type}`} role={type === "erreur" ? "alert" : "status"}>
      {children}
    </p>
  );
}

/** Libellé relié au champ ; l'aide est annoncée comme description, pas comme partie du nom. */
export function Champ({
  libelle,
  aide,
  children,
}: {
  libelle: string;
  aide?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = useId();
  const idAide = useId();
  return (
    <div className="champ">
      <label className="champ__libelle" htmlFor={id}>{libelle}</label>
      {cloneElement(children, { id, ...(aide ? { "aria-describedby": idAide } : {}) })}
      {aide && <span id={idAide} className="champ__aide">{aide}</span>}
    </div>
  );
}

export function Badge({ ton, children }: { ton: "vert" | "orange" | "rouge" | "bleu" | "gris"; children: ReactNode }) {
  return <span className={`badge badge--${ton}`}>{children}</span>;
}

export function Chargement() {
  return <p className="chargement" role="status">Chargement…</p>;
}

export function Vide({ children }: { children: ReactNode }) {
  return <p className="vide">{children}</p>;
}

export function Section({ titre, actions, children }: { titre: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header className="section__entete">
        <h2>{titre}</h2>
        {actions && <div className="section__actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

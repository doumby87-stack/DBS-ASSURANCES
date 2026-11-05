// Composants communs du portail.

import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { joursAvant, dateCourte } from "./format";

export function Alerte({ type = "erreur", children }: { type?: "erreur" | "succes" | "info"; children: ReactNode }) {
  if (!children) return null;
  return <p className={`alerte alerte--${type}`} role={type === "erreur" ? "alert" : "status"}>{children}</p>;
}

export function Badge({ ton, children }: { ton: "vert" | "orange" | "rouge" | "bleu" | "gris"; children: ReactNode }) {
  return <span className={`badge badge--${ton}`}>{children}</span>;
}

/** Libellé relié au champ par son id ; l'aide est annoncée comme description, pas comme partie du nom. */
export function Champ({ libelle, aide, children }: {
  libelle: string;
  aide?: ReactNode;
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

/** Une ligne d'une fiche (liste de définitions) : libellé, valeur. */
export function Ligne({ titre, children }: { titre: string; children: ReactNode }) {
  return <div><dt>{titre}</dt><dd>{children}</dd></div>;
}

export function Chargement() {
  return <p className="chargement" role="status">Chargement…</p>;
}

export function Carte({ nombre, titre, ton }: { nombre: ReactNode; titre: string; ton: "bleu" | "vert" | "orange" | "rouge" | "gris" }) {
  return (
    <div className={`carte carte--${ton}`}>
      <span className="carte__nombre">{nombre}</span>
      <span className="carte__titre">{titre}</span>
    </div>
  );
}

/** Échéance d'un document : rouge si dépassée, orange dans les 30 jours. */
export function Echeance({ date }: { date: string | null }) {
  if (!date) return <span className="note">—</span>;
  const jours = joursAvant(date);
  if (jours < 0) return <Badge ton="rouge">{dateCourte(date)} · dépassée</Badge>;
  if (jours <= 30) return <Badge ton="orange">{dateCourte(date)} · {jours === 0 ? "aujourd'hui" : `dans ${jours} j`}</Badge>;
  return <span>{dateCourte(date)}</span>;
}

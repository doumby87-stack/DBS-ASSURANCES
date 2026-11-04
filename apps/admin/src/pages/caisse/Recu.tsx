// Reçu imprimable : remis au client, avec le montant en lettres et le reste à payer.
// À l'impression, seule la feuille du reçu apparaît (styles « @media print »).

import { useEffect, useState } from "react";
import { Alerte, Chargement } from "../../composants/communs";
import { Lien } from "../../routeur";
import { api, ErreurApi, messageErreur } from "../../services/api";
import { BRANCHES, dateCourte, dateHeure, lienWhatsApp, montant, MODES_PAIEMENT, telephone } from "../../services/format";

interface Recu {
  id: string;
  numeroRecu: number;
  montant: number;
  montantEnLettres: string;
  mode: string;
  reference: string | null;
  motif: string | null;
  encaisseLe: string;
  encaissePar: string;
  clientNom: string;
  clientTelephone: string;
  contratId: string;
  numeroPolice: string | null;
  branche: string;
  dateEffet: string;
  dateEcheance: string;
  primeTtc: number;
  resteAPayer: number;
  annuleRecu: number | null;
  contrePasseParRecu: number | null;
  agence: { nom: string; qualite: string; codeAgence: string; compagnie: string; adresse: string; telephone: string };
}

export function PageRecu({ id }: { id: string }) {
  const [recu, setRecu] = useState<Recu | null>(null);
  const [erreur, setErreur] = useState("");
  const [introuvable, setIntrouvable] = useState(false);

  useEffect(() => {
    api<{ recu: Recu }>(`/encaissements/${id}/recu`)
      .then(({ recu }) => setRecu(recu))
      .catch((e: unknown) => {
        if (e instanceof ErreurApi && (e.statut === 404 || e.statut === 400)) setIntrouvable(true);
        else setErreur(messageErreur(e));
      });
  }, [id]);

  if (introuvable) return <><h1>Reçu introuvable</h1><p><Lien href="/caisse">Retour à la caisse</Lien></p></>;
  if (!recu) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />;

  const message =
    `Bonjour ${recu.clientNom}, ${recu.agence.nom} confirme la réception de ${montant(recu.montant)} ` +
    `(reçu n° ${recu.numeroRecu}) pour votre assurance ${(BRANCHES[recu.branche] ?? "").toLowerCase()}` +
    `${recu.numeroPolice ? ` (police ${recu.numeroPolice})` : ""}. ` +
    (recu.resteAPayer > 0 ? `Reste à payer : ${montant(recu.resteAPayer)}.` : "Votre prime est entièrement payée. Merci !");

  return (
    <>
      <div className="barre-outils non-imprimable">
        <Lien href={`/contrats/${recu.contratId}`} className="bouton bouton--petit">Retour au contrat</Lien>
        <button type="button" className="bouton bouton--principal bouton--petit" onClick={() => window.print()}>Imprimer</button>
        {recu.montant > 0 && (
          <a className="bouton bouton--petit" href={lienWhatsApp(recu.clientTelephone, message)} target="_blank" rel="noopener noreferrer">
            Envoyer la confirmation sur WhatsApp
          </a>
        )}
      </div>

      <article className="recu" aria-labelledby="titre-recu">
        <header className="recu__entete">
          <div>
            <p className="recu__agence">{recu.agence.nom}</p>
            <p>{recu.agence.qualite} · Code agence {recu.agence.codeAgence}</p>
            <p>{recu.agence.adresse} · {recu.agence.telephone}</p>
          </div>
          <div className="recu__numero">
            <h1 id="titre-recu">{recu.montant < 0 ? "Contre-passation" : "Reçu"} n° {String(recu.numeroRecu).padStart(6, "0")}</h1>
            <p>{dateHeure(recu.encaisseLe)}</p>
          </div>
        </header>

        {recu.contrePasseParRecu && (
          <p className="recu__annule">Annulé par la contre-passation n° {String(recu.contrePasseParRecu).padStart(6, "0")}</p>
        )}

        <dl className="recu__details">
          <div><dt>Reçu de</dt><dd>{recu.clientNom} · {telephone(recu.clientTelephone)}</dd></div>
          <div><dt>Contrat</dt><dd>{BRANCHES[recu.branche]} · police {recu.numeroPolice ?? "en cours d'émission"} · du {dateCourte(recu.dateEffet)} au {dateCourte(recu.dateEcheance)}</dd></div>
          <div className="recu__montant"><dt>Montant</dt><dd>{montant(recu.montant)}<br /><span>{recu.montantEnLettres}</span></dd></div>
          <div><dt>Mode de paiement</dt><dd>{MODES_PAIEMENT[recu.mode]}{recu.reference ? ` · ${recu.reference}` : ""}</dd></div>
          {recu.annuleRecu && <div><dt>Annule le reçu</dt><dd>n° {String(recu.annuleRecu).padStart(6, "0")} · {recu.motif}</dd></div>}
          <div><dt>Prime TTC du contrat</dt><dd>{montant(recu.primeTtc)}</dd></div>
          <div><dt>Reste à payer après ce paiement</dt><dd>{montant(recu.resteAPayer)}</dd></div>
          <div><dt>Encaissé par</dt><dd>{recu.encaissePar}</dd></div>
        </dl>

        <p className="recu__mention">
          Prime encaissée pour le compte de {recu.agence.compagnie}. La garantie prend effet une fois la prime entièrement payée
          (Code CIMA, art. 13). Conservez ce reçu.
        </p>
        <div className="recu__signatures">
          <p>Signature et cachet de l'agence</p>
          <p>Signature du client</p>
        </div>
      </article>
    </>
  );
}

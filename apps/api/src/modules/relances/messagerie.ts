// Messagerie des relances : les canaux réellement disponibles et l'envoi d'un message.
//   · WhatsApp : actif dès que l'accès à l'API Cloud de Meta est configuré ;
//   · SMS : actif quand l'opérateur sera choisi et branché (integrations/sms) ;
//   · simulation (développement, tests) : les deux canaux « envoient » sans que rien ne parte.

import { randomUUID } from "node:crypto";
import type { ConfigurationRelances } from "../../config/configuration.js";
import type { ResultatEnvoi } from "../../integrations/envoi.js";
import { creerClientWhatsApp } from "../../integrations/whatsapp/whatsapp.js";
import { rediger, type ParametresRelance, type TypeRelance } from "./modeles.js";

export type Canal = "whatsapp" | "sms";

export interface MessageAEnvoyer {
  type: TypeRelance;
  canal: Canal;
  /** Numéro E.164 */
  destinataire: string;
  parametres: ParametresRelance;
}

export interface Messagerie {
  /** Canaux par lesquels on peut envoyer, dans l'ordre de préférence. */
  canaux: Canal[];
  simulation: boolean;
  envoyer(message: MessageAEnvoyer): Promise<ResultatEnvoi>;
}

export function creerMessagerie(config: ConfigurationRelances, options: { recuperer?: typeof fetch } = {}): Messagerie {
  if (config.simulation) {
    return {
      canaux: ["whatsapp", "sms"],
      simulation: true,
      async envoyer(message) {
        rediger(message.type, message.parametres); // un message impossible à rédiger échoue aussi en simulation
        return { ok: true, identifiant: `simulation-${randomUUID()}` };
      },
    };
  }

  const whatsapp = config.whatsapp ? creerClientWhatsApp(config.whatsapp, options.recuperer) : null;
  return {
    canaux: whatsapp ? ["whatsapp"] : [],
    simulation: false,
    async envoyer(message) {
      if (message.canal === "whatsapp" && whatsapp) {
        return whatsapp.envoyerModele(message.destinataire, rediger(message.type, message.parametres).whatsapp);
      }
      return { ok: false, erreur: `Canal ${message.canal} non configuré`, definitif: false };
    },
  };
}

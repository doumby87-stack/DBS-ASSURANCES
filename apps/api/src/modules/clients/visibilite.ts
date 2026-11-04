// Le client existe-t-il, et l'utilisateur a-t-il le droit de le voir ? Sinon : 404, sans distinguer les deux cas.

import type { Client } from "../../base-de-donnees/connexion.js";
import { erreurs } from "../../commun/erreurs.js";

export async function exigerClientVisible(client: Client, clientId: string): Promise<void> {
  const { rowCount } = await client.query("SELECT 1 FROM app.clients WHERE id = $1", [clientId]);
  if (!rowCount) throw erreurs.introuvable();
}

# Paiement Mobile Money, WhatsApp Business, opérateur SMS

Trois fournisseurs que l'application sait déjà utiliser ; il manque les comptes de l'agence. Pour chacun : ce qu'il faut ouvrir, les questions à poser, et ce qu'il faut remettre au prestataire technique (par le gestionnaire de mots de passe, jamais par e-mail ni WhatsApp).

## Compte marchand Mobile Money

Pour que les clients paient leur prime en ligne depuis l'espace client ([ADR 0012](../architecture/adr/0012-espace-client-et-paiement-en-ligne.md)). **Un compte au nom de la société**, jamais un numéro personnel : c'est la parade contre les faux numéros de paiement « de DBS ».

**Auprès de qui** : un agrégateur de paiement (qui regroupe Orange Money, MTN, Moov, Wave… et parfois la carte bancaire) ou un opérateur en direct. Demander deux ou trois offres.

**Pièces généralement demandées** : extrait RCCM, déclaration fiscale d'existence, pièce d'identité du gérant, relevé d'identité bancaire de la société, justificatif d'adresse. Le site doit montrer les mentions légales et les conditions de paiement.

**Questions à poser** :

1. Quels moyens de paiement sont couverts ? Avec quels frais par transaction, et qui les paie ?
2. Sous quel délai l'argent arrive-t-il sur le compte de la société ?
3. **Vérification d'un paiement** : votre interface de programmation permet-elle de demander l'état d'un paiement par sa référence ? *(L'application ne croit que cette vérification, jamais la page de retour.)*
4. **Notifications** : sont-elles signées (par exemple HMAC avec une clé secrète), et comment vérifier la signature ? Sont-elles renvoyées en cas d'échec ?
5. Existe-t-il un **environnement de test** avec des clés de test ?
6. Remboursement, plafond par transaction, contestations : comment ça marche ?
7. Où les données des paiements sont-elles traitées (pays) ? *(Pour la déclaration à l'ARTCI.)*

**À remettre au prestataire technique** : le nom du prestataire choisi, sa documentation d'intégration, les clés de **test** d'abord, puis celles de production. Il ajoute alors le module de ce prestataire (quelques jours de travail, avec ses tests) : tout le reste du paiement en ligne est déjà fait.

## WhatsApp Business

Pour les relances automatiques et les codes de connexion à l'espace client ([ADR 0007](../architecture/adr/0007-relances-whatsapp-et-sms.md), [modèles de messages](../metier/modeles-de-messages.md)). **Démarche à lancer tôt** : la vérification par Meta peut prendre plusieurs semaines.

1. **Un numéro dédié**, au nom de l'agence, qui n'est utilisé dans aucune application WhatsApp (ni WhatsApp, ni WhatsApp Business sur un téléphone). Un numéro déjà utilisé doit d'abord être supprimé de l'application.
2. **Un portefeuille Meta Business** (business.facebook.com) au nom de la société, créé avec un compte personnel du gérant protégé par un deuxième facteur ; ajouter une seconde personne administratrice.
3. **La vérification de l'entreprise** dans le portefeuille : raison sociale exacte, adresse, téléphone, site internet sur le domaine de l'agence, et un document officiel (extrait RCCM, facture au nom de la société). Le nom doit être identique partout.
4. **Le compte WhatsApp Business** sur le numéro dédié, avec le **nom d'affichage** « DBS-ASSURANCES » (Meta le valide aussi).
5. **Les six modèles de messages** à soumettre, textes et marche à suivre dans [modèles de messages](../metier/modeles-de-messages.md#soumettre-les-modèles-tâche-de-lagence).
6. **L'accord des clients existants** pour les relances, au guichet ou par téléphone, noté sur leur fiche avec sa preuve (back-office) : sans accord, aucune relance ne part.

**À remettre au prestataire technique** : l'accès du prestataire au portefeuille (en tant que partenaire ou utilisateur, pas le mot de passe du gérant). Il crée lui-même l'application Meta, l'utilisateur système et ses jetons, et les range dans les réglages du serveur.

## Opérateur SMS

Pour les clients qui n'ont pas WhatsApp, ou qui préfèrent le SMS. En attendant, ce canal ne fonctionne qu'en simulation.

**Questions à poser** :

1. Êtes-vous agréé pour l'envoi de SMS en Côte d'Ivoire ?
2. Peut-on envoyer avec le nom d'expéditeur « DBS-ASSUR » ? Quelle démarche, quel délai ?
3. Recevons-nous les **accusés de remise** ? Les **réponses** des clients (« STOP ») ?
4. Interface de programmation : documentation, environnement de test, authentification.
5. Prix par SMS, par réseau ; forfaits ; facturation.
6. Où les numéros et les messages sont-ils traités et conservés, et combien de temps ? *(Pour l'ARTCI.)*

**À remettre au prestataire technique** : le nom de l'opérateur choisi, sa documentation, des clés de test.

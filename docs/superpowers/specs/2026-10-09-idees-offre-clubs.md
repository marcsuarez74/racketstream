# Idées — offre clubs et monétisation

- **Date** : 2026-10-09
- **Statut** : idées notées, rien n'est décidé ni lancé. Complète le [business plan store](2026-09-21-store-business-plan.md), qui prévoyait un achat unique : ce modèle est à revoir si l'offre ci-dessous se confirme.

---

## 1. Modèle envisagé

- **Gratuit** : l'app de score (montre), l'activité Garmin, le cardio, le récap.
- **Payant** : la partie stream — portail, clé device, sync, overlay, widget, annonce chat.
- Logique : seul le stream coûte (serveur). La clé device sert déjà de verrou naturel (clé donnée après paiement, coupée en fin d'abonnement ; la montre continue de compter sans sync).
- **Cible principale : les clubs** (budget existant, vraie raison de diffuser : interclubs, tournois, finales, parents absents ; un club = plusieurs terrains d'un coup).

## 2. Fonctionnalités à prévoir

| Idée | Avis de Marc | Notes |
|---|---|---|
| **Espace club multi-terrains** : un compte qui regroupe des canaux « Terrain 1 », « Terrain 2 »… | ⭐ prioritaire (« la feature banger ») | Aujourd'hui : un canal par montre (`devices`). Ajouter une notion de club propriétaire de plusieurs canaux. |
| Logo et couleurs du club sur le bandeau de score | oui | À répercuter partout : overlay, widget SE, renderer VPS (design dupliqué). |
| Noms des joueurs saisis à l'avance pour un tournoi | oui | Étendre `names` : tableau de matchs prévus par terrain. |
| Page publique du club avec tous les matchs en cours | oui | Lecture seule, même logique de « pick » que l'overlay, par terrain. |
| **Scoreur sans montre** : app (ou page web) de score sur téléphone, pour un scoreur externe | oui | Même contrat que la montre : envoi des events à `sync` avec une clé. Une page web mobile (PWA) éviterait les stores iOS/Android. |
| **YouTube** en plus de Twitch | oui | L'overlay vidéo marche déjà (OBS / relais VPS vers n'importe quel RTMP). Reste l'annonce dans le chat YouTube (API YouTube Live, quotas à vérifier). |

## 3. Questions ouvertes

- Paiement : via le portail (Stripe) plutôt que Garmin ; vérifier si les règles du store Connect IQ autorisent un service payant hors store.
- Serveur « maison » : avec un code public, un bricoleur peut héberger sa copie gratuitement. Acceptable, ou passer la partie serveur en privé.
- Administratif : statut (micro-entreprise), conditions de vente, facturation aux clubs (associations).
- Prix : abonnement mensuel par club (au terrain ?), essai gratuit.

## 4. Prochaine étape

Avant tout code : montrer l'overlay en conditions réelles à un ou deux clubs (badminton, padel) et leur demander si ça leur servirait et combien ils paieraient. D'abord finir la phase 9 (beta 0.3.0, rendu padel côté stream).

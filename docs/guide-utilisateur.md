# RacketStream — Guide utilisateur

*Version 1.0 — compatible Garmin Connect IQ. Ce guide est la référence pour la fiche store et la page web d'aide.*

---

## 1. RacketStream, c'est quoi ?

RacketStream transforme ta montre Garmin en **tableau de score pour sports de raquette** (badminton, padel et squash) : un bouton par point, et le score part **tout seul** sur internet. Tes viewers suivent le match en direct :

- dans la **vidéo** (bandeau de score façon retransmission TV),
- dans le **chat** (`!score` ou annonce automatique à chaque point).

Aucun ordinateur, aucune manipulation pendant que tu joues : la montre fait tout, offline d'abord (le score marche même sans réseau — la sync rattrape dès que ça revient).

---

## 2. Ce qu'il te faut

| Élément | Détail |
|---|---|
| Montre Garmin compatible | Voir familles supportées sur la fiche store (v1.0 : epix2 Pro 51 mm, Forerunner 55 — d'autres familles suivent) |
| Garmin Connect Mobile | Installé et connecté à ta montre (c'est le relais internet de la montre) |
| Pour streamer | Un compte Twitch + streameur ou téléphone (l'overlay est un simple lien web) |

Pas besoin de compte ailleurs : le backend est **fourni et gratuit**.

---

## 3. Installation (10 minutes)

### Étape 1 — Installer l'app
1. Ouvre **Garmin Connect Mobile** → ta montre → **Activités & Apps** → **En savoir plus**
2. Cherche **RacketStream** → **Installer**

### Étape 2 — Premier lancement
1. Lance RacketStream sur la montre
2. L'écran affiche **« Configurez RacketStream dans Garmin Connect »** : c'est normal, il faut d'abord enregistrer ta montre (étape 3)

### Étape 3 — Créer ton canal et ta clé
1. Sur ton téléphone, ouvre le **portail RacketStream** (lien sur la fiche store)
2. En haut, **« Créer un canal »** : choisis un nom unique (ex. ton pseudo Twitch — c'est ce qui identifie tes matchs) puis **CRÉER**
3. Ta **clé personnelle** s'affiche — ⚠️ elle n'est montrée **qu'une seule fois** : copie-la tout de suite (le portail pré-remplit ensuite Canal et Clé pour toi)
4. Vérifie/choisis les **noms des joueurs** affichés à l'écran et sur l'overlay, puis **VALIDER**

### Étape 4 — Configurer Garmin Connect
1. GCM → ta montre → **Activités & Apps** → RacketStream → **Réglages**
2. **Backend URL** : pré-remplie avec `https://racket-stream.marc-suarez.fr/functions/v1/sync` (ne la modifie pas sans raison)
3. Colle ta **clé** dans **Device Key** (recopie-la intégralement, sans espace avant/après)
4. **Redémarre ta montre** (obligatoire — Garmin Connect n'envoie les réglages à l'app qu'au redémarrage)

### Étape 5 — Vérifier
Lance un match et marque un point : un **liseré vert** apparaît autour de l'écran (~1-2 s) puis disparaît — c'est la confirmation d'envoi. C'est prêt. 🏸

---

## 4. Utiliser l'app sur la montre

### Démarrer une séance
1. **Choisis le sport** (UP/DOWN puis START) : Badminton, Padel ou Squash
2. **Choisis le format** (UP/DOWN puis START) :
   - Badminton : 3 × 21, 3 × 15, Set unique 21
   - Padel : Star Point, Point en or, Avantages, Super tie-break
   - Squash : PAR 11 en 3 jeux, PAR 11 en 2 jeux, PAR 15 en 3 jeux
3. Écran **Prêt** : attends que la FC s'affiche, puis START. La séance démarre, comme une activité Garmin (chrono, cardio, calories)

L'app retient ton dernier sport et ton dernier format. BACK sur l'écran du sport ferme l'app.

### Pendant le match

| Bouton | Action |
|---|---|
| **START** | point pour toi (en fin de set : passer au set suivant) |
| **BACK** | point pour l'adversaire |
| **UP** | annuler le dernier point |
| **DOWN** | page suivante : score → cardio → effort → stats du match |
| **MENU** (UP appui long) | Reprendre / Pause / Changer de set (badminton, squash) / Terminer |

En **pause** : START relance le chrono, BACK ouvre le menu de l'activité (**Reprendre**, **Enregistrer**, **Supprimer**). Supprimer demande une confirmation (START = oui, BACK = non).

### Fin du match
Un écran **VICTOIRE** ou **DÉFAITE** te propose :
- **Enregistrer l'activité** : la séance part dans Garmin Connect, avec un récap à faire défiler (DOWN) : durée, calories, FC, zones, sets
- **Nouveau match** : on enchaîne dans la même séance
- **Annuler le dernier point** : si le dernier point était une erreur

Si l'app se ferme en plein match, elle propose de **reprendre le match** au prochain lancement (BACK = abandonner).

### Les règles gérées automatiquement
- Badminton : 2 points d'écart, plafond à 30 (21 en 3 × 15), changement de côté annoncé dans le set décisif
- Padel : jeux, tie-break et mode d'égalité choisi (Star Point, point en or, avantages) ; changement de côté annoncé
- Squash : PAR avec 2 points d'écart

### Le liseré de sync (autour du cadre de l'écran, pendant un match)

| Signal | Signification | À faire |
|---|---|---|
| 🟢 Liseré vert bref (~1-2 s) | envoi en cours puis confirmé | rien — c'est le fonctionnement normal |
| Rien | connecté, tout est à jour | rien |
| 🔴 Liseré rouge + code (ex. « sync 401 ») | le serveur a refusé l'envoi ; nouvel essai automatique en arrière-plan | voir les codes ci-dessous |

**Codes affichés en rouge** :
- **401** → ta clé est refusée : recopie-la depuis le portail (sans espace), re-valide les réglages, redémarre la montre
- **404** → Backend URL incomplète : elle doit se terminer par `/functions/v1/sync`
- **t/o** → pas de réseau : téléphone appairé en Bluetooth et GCM actif (non « tué » par l'économiseur de batterie)
- **-104** → aucun relais : la montre n'est **pas appairée à GCM** (ou téléphone injoignable). La montre n'a pas d'accès Internet propre — elle passe obligatoirement par Garmin Connect Mobile. La sync est impossible tant que le couplage n'est pas fait : installe GCM sur le téléphone et appaire la montre ; les points en attente partiront ensuite tout seuls (le score n'est jamais perdu)
- Tout autre code → réessaie plus tard, la reprise est automatique

> ℹ️ **La sync fonctionne par lots** : la montre envoie les points par groupes (≤ 5, toutes les 5 s minimum) — une contrainte du Bluetooth. Si tu marque plusieurs points en rafale, l'overlay les suit par paliers de 5 à 10 s. Dans un vrai match (un échange toutes les 10-30 s), chaque point arrive en 1 à 3 s.

---

## 5. Côté viewers

### L'overlay (bandeau de score dans la vidéo)
Un simple lien web à mettre en browser source (OBS) ou à incruster via ton outil de stream :

```
https://racket-stream-portal.marc-suarez.fr/overlay/?channel=TON_CANAL&name1=TOI&name2=ADVERSAIRE
```

Il suit **automatiquement** ton match actif — rien à toucher entre les matchs. Paramètres : `scale` (taille), `bg=0` (fond transparent).

### Le chat Twitch
- `!score` → le bot affiche le score immédiatement
- **Annonce automatique** : à chaque changement de score, le message s'affiche tout seul dans le chat (~5 s après le point) — aucune action nécessaire

---

## 6. Dépannage (FAQ)

**Le liseré reste rouge.**
→ Lis le code affiché (401 / 404 / t/o / -104 — voir « Le liseré de sync » ci-dessus). Le plus fréquent : **401** = clé mal recopiée ou réglages non re-synchronisés → re-valide les réglages dans GCM **puis redémarre la montre**. La reprise est automatique (backoff jusqu'à 2 min).

**L'overlay ne change pas alors que j'ai marqué.**
→ Latence normale de sync par lots (5-10 s en rafale). Si ça dure > 2 min, vérifie le liseré de sync et le canal dans l'URL de l'overlay.

**J'ai recollé ma clé, toujours rouge 401.**
→ Garmin Connect n'envoie les réglages à la montre qu'à la validation du formulaire **et** au redémarrage : re-valide les Réglages (sans rien changer) puis redémarre la montre. Vérifie aussi que la clé fait bien 64 caractères, sans espace.

**Je ne trouve plus ma clé.**
→ Un canal ne peut pas être recréé (le nom est réservé). Demande une nouvelle clé via la page support — l'ancienne sera invalidée et une nouvelle clé générée pour ton canal.

**Deux matchs s'affichent en même temps ?**
→ Impossible par design : créer un nouveau match **clôture automatiquement** le précédent de ta montre.

**Qui peut voir mes scores ?**
→ N'importe qui avec le lien de ton canal (c'est ce qui permet l'overlay et le `!score`). N'y mets pas d'informations personnelles dans les noms. Voir « Confidentialité » ci-dessous.

---

## 7. Confidentialité

- **Données stockées** : ton canal, les noms que tu choisis, les scores/événements de match, et l'**empreinte** (hash SHA-256) de ta clé — jamais la clé elle-même
- **Aucun compte, aucune donnée personnelle** (pas d'email, pas de nom réel requis)
- **Scores publics par design** : c'est ce qui permet aux viewers de les afficher ; ton canal est consultable par quiconque connaît son nom
- **Suppression** : demande via la page support — les matchs de ton canal sont supprimés, ta clé révoquée
- L'app ne lit ni contacts, ni position, ni santé ; elle n'envoie rien hors de ton action (un point marqué)

---

## 8. Support

- Bugs et questions : [GitHub Issues](https://github.com/marcsuarez74/badminton-score/issues)
- Montre compatible non listée ? Demande — chaque famille d'écran nécessite une validation, ajoutées au fil des demandes.

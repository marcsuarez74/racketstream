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
| Pour streamer | Un compte Twitch ou YouTube + OBS sur un ordinateur, ou l'app gratuite PRISM Live Studio sur un téléphone (l'overlay est un simple lien web) |

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
1. Sur ton téléphone, ouvre le **portail RacketStream** (lien sur la fiche store). Il s'installe comme une app : Safari › Partager › Sur l'écran d'accueil (iPhone), ou menu du navigateur › Installer (Android)
2. Page **Canaux**, carte **« Nouvelle montre »** : choisis un nom unique (ex. ton pseudo Twitch — c'est ce qui identifie tes matchs) puis **Créer le canal**
3. Ta **clé personnelle** s'affiche — ⚠️ elle n'est montrée en entier **qu'une seule fois** : touche **Copier la clé** tout de suite (elle reste mémorisée sur ce téléphone, page Canaux)
4. Page **Match** (le rond au centre de la barre du bas) : choisis Simple / Double / Mixte, tape les **noms des joueurs** puis **Envoyer les noms**. Pendant un match, cette page affiche aussi le score en direct
5. Page **Diffusion** : un aperçu de ce que voient tes spectateurs, et le lien du bandeau à coller dans OBS (avec un ordinateur) ou dans l'app PRISM Live Studio (téléphone seul, voir § 5)

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

**Depuis un téléphone, sans ordinateur** (onglet Diffusion › Téléphone seul du portail) :
1. installe l'app gratuite **PRISM Live Studio** (App Store, Google Play) ;
2. dans PRISM : **Widget › Web**, colle le lien du bandeau, puis étire le cadre sur tout l'écran ;
3. connecte ton compte Twitch ou YouTube dans PRISM et lance le live.

Le téléphone filme, ajoute le bandeau et diffuse lui-même : le serveur RacketStream ne reçoit que le score. Pour un club, un téléphone par terrain, chacun avec le lien de son terrain.

Il suit **automatiquement** ton match actif — rien à toucher entre les matchs :
- un **nouveau match** s'affiche à 0-0 dès son lancement sur la montre ;
- entre deux sets, le score du set qui vient de finir reste affiché ;
- à la fin du match, le **score final** reste affiché 5 minutes (ou jusqu'au match suivant) ;
- en **fin de séance** (Enregistrer) ou en cas d'**abandon**, le bandeau disparaît aussitôt ;
- si l'app est coupée net (batterie, plantage), il disparaît seul au bout de 10 minutes.

Paramètres : `scale` (taille), `bg=0` (fond transparent).

### Le chat Twitch
- `!score` → le bot affiche le score immédiatement
- **Annonce automatique** : à chaque changement de score, le message s'affiche tout seul dans le chat (~5 s après le point) — aucune action nécessaire

---

## 6. Espace club (plusieurs terrains)

Un club peut diffuser plusieurs terrains en même temps. Chaque terrain a **son propre canal**, donc son bandeau de live et **sa propre clé montre**. La **clé du club** sert seulement à gérer : ajouter et renommer des terrains, créer de nouvelles clés. Elle n'envoie jamais de score.

### Créer le club

Dans le portail, ouvre l'onglet **Club** et remplis « Créer un club » :
- le nom du club ;
- un identifiant court (minuscules, chiffres, tirets), qui sert dans les liens ;
- le **code d'invitation** reçu : il ne sert qu'une fois.

La **clé du club** s'affiche **une seule fois**. Note-la : elle permet d'ouvrir le club sur un autre appareil. Le portail la mémorise aussi sur cet appareil.

### Ajouter les terrains

Dans « Ajouter un terrain », donne un nom (« Terrain 1 », « Central »…). La **clé de la montre** de ce terrain s'affiche : colle-la dans la montre du terrain (Garmin Connect › RacketStream › Réglages), comme à l'étape 4 de l'installation.

Touche un terrain pour l'utiliser : le portail affiche alors son score et sa diffusion, sa clé montre et le **lien du bandeau pour OBS**. Les terrains apparaissent aussi dans le menu des canaux, sous le nom du club.

### Ouvrir le club sur un autre appareil

Onglet **Club** › « Club existant » : saisis l'identifiant et la clé du club. Sur cet appareil, les clés des terrains affichent « pas sur cet appareil » : comme un mot de passe, le serveur ne garde pas les clés, il ne peut donc pas les renvoyer. Si une montre a besoin de sa clé, utilise **Nouvelle clé montre**. L'ancienne clé cesse alors de marcher : colle la nouvelle dans la montre du terrain.

### Marquer sans montre (scoreur sur téléphone)

Un terrain n'a pas besoin de montre : un téléphone ou une tablette posé au bord du terrain peut marquer les points (badminton et squash).

Dans la fiche du terrain, bloc **Marquer sans montre** :
- **Ouvrir le scoreur ici** ouvre le scoreur sur l'appareil où tu es ;
- **QR code à coller au poteau** affiche un QR code à imprimer (**Imprimer**) ou à envoyer (**Partager le lien**). Il suffit de le scanner avec l'appareil photo du téléphone : rien à installer.

Dans le scoreur, choisis le sport, le format et les noms (en double, sépare les partenaires par « / », par exemple « Léa / Tom »), puis **Lancer le match**. Touche la zone de l'équipe qui marque. **↶ Annuler** retire le dernier point, **⇅ Côtés** inverse les zones à l'écran et **Fin** arrête le match : le live du terrain se vide. L'écran reste allumé pendant le match.

Sans réseau, le scoreur continue de compter : les points sont envoyés dès que la connexion revient (« ⏳ hors ligne, N en attente » s'affiche en haut).

⚠️ Le QR code contient la clé du terrain : toute personne qui le scanne peut marquer des points sur ce terrain. Ne le donne qu'aux personnes qui marquent. S'il circule trop, utilise **Nouvelle clé montre** : l'ancien QR ne marche plus (le scoreur affiche « Ce QR code n'est plus valable »). Pense à remettre la nouvelle clé dans la montre du terrain s'il y en a une, puis imprime le nouveau QR.

Si un match est déjà en cours sur le terrain au moment du scan (compté par un autre téléphone ou une montre), le scoreur affiche son score et propose :

- **Reprendre ce match** : on continue au même score (relais en cas de batterie à plat, de montre qui lâche ou de changement d'arbitre). L'appareil précédent ne compte plus. **↶ Annuler** ne revient pas avant le score repris. Impossible pour un match de padel compté sur la montre ;
- **Nouveau match** : le match en cours est terminé au lancement et on repart à 0-0 ;
- **Juste regarder le live** : ouvre la page publique du club.

Le téléphone qui comptait jusque-là est prévenu à son point suivant (« Un autre téléphone a pris la main ») : ses points ne partent plus au live, et il peut **Reprendre la main**. Une montre, elle, n'est pas prévenue : arrête-la à la main.

Une montre et un scoreur peuvent servir sur le même terrain : c'est le match lancé le plus récemment qui s'affiche.

### Page publique du club

Dans l'onglet **Club**, la section **Page publique** donne le lien d'une page qui montre **tous les matchs du club en direct**. Elle ne contient aucune clé : elle permet seulement de regarder. Partage-la aux joueurs et aux parents, ou affiche-la sur la TV de la salle. Sur un grand écran, elle passe sur deux colonnes et affiche un QR code pour suivre les scores sur son téléphone.

Comme le bandeau du live, un terrain affiche « Fin du set » entre deux sets et « Terminé » avec le score final pendant 5 minutes après le match. Il repasse « En attente » ensuite, après « Fin », ou si aucun point n'a été marqué depuis 10 minutes.

---

## 7. Dépannage (FAQ)

**Le liseré reste rouge.**
→ Lis le code affiché (401 / 404 / t/o / -104 — voir « Le liseré de sync » ci-dessus). Le plus fréquent : **401** = clé mal recopiée ou réglages non re-synchronisés → re-valide les réglages dans GCM **puis redémarre la montre**. La reprise est automatique (backoff jusqu'à 2 min).

**L'overlay ne change pas alors que j'ai marqué.**
→ Latence normale de sync par lots (5-10 s en rafale). Si ça dure > 2 min, vérifie le liseré de sync et le canal dans l'URL de l'overlay.

**J'ai recollé ma clé, toujours rouge 401.**
→ Garmin Connect n'envoie les réglages à la montre qu'à la validation du formulaire **et** au redémarrage : re-valide les Réglages (sans rien changer) puis redémarre la montre. Vérifie aussi que la clé fait bien 64 caractères, sans espace.

**Je ne trouve plus ma clé.**
→ L'empreinte seule est conservée : personne ne peut retrouver ta clé. Pour un terrain de club, génère une nouvelle clé dans l'onglet Club. Pour un canal perso, écris à l'adresse de contact des [mentions légales](https://racket-stream-portal.marc-suarez.fr/mentions-legales.html) : on supprime le canal et tu peux le recréer avec une nouvelle clé. N'envoie jamais ta clé par e-mail.

**Deux matchs s'affichent en même temps ?**
→ Impossible par design : créer un nouveau match **clôture automatiquement** le précédent de ta montre.

**Qui peut voir mes scores ?**
→ N'importe qui avec le lien de ton canal (c'est ce qui permet l'overlay et le `!score`). N'y mets pas d'informations personnelles dans les noms. Voir « Confidentialité » ci-dessous.

---

## 8. Confidentialité

Le détail est dans la [politique de confidentialité](https://racket-stream-portal.marc-suarez.fr/confidentialite.html) ; les règles d'usage dans les [conditions d'utilisation](https://racket-stream-portal.marc-suarez.fr/cgu.html).

- **Aucun compte** : pas d'e-mail ni de mot de passe. Le serveur garde ton canal, les noms affichés, les points des matchs et l'**empreinte** (SHA-256) de ta clé — jamais la clé elle-même
- **Scores publics par design** : c'est ce qui permet aux viewers de les afficher ; ton canal est consultable par quiconque connaît son nom. N'affiche que des noms que les joueurs acceptent de voir publiés (un prénom ou un surnom suffit), et pour un mineur, avec l'accord de ses parents
- **Conservation** : les matchs sont effacés automatiquement après 12 mois, un canal perso sans match depuis 24 mois aussi
- **Suppression** : écris à l'adresse de contact des [mentions légales](https://racket-stream-portal.marc-suarez.fr/mentions-legales.html) — ton canal (ou ton club), ses matchs et sa clé sont supprimés
- **Aucun cookie** sur le portail ; le lecteur Twitch de la page Diffusion n'est chargé que si tu enregistres ta chaîne
- L'app ne lit ni contacts, ni position, ni santé ; elle n'envoie rien hors de ton action (un point marqué)

---

## 9. Support

- Contact (suppression de données, signalement, accessibilité) : racketstream-contact@marc-suarez.fr
- Bugs et questions : [GitHub Issues](https://github.com/marcsuarez74/badminton-score/issues)
- Montre compatible non listée ? Demande — chaque famille d'écran nécessite une validation, ajoutées au fil des demandes.

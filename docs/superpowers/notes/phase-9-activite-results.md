# Phase 9 — Activité Garmin multi-sport : résultats

Branche `phase-9-activite`. Maquette de référence : « activité Garmin » (écrans sport → format → prêt → séance → récap).

## Livré

- **Moteur** : catalogue `Sports` (badminton, padel, squash ; identifiants persistés stables), `PadelEngine` (jeux, tie-break, Star Point / point en or / avantages, super tie-break), `undoPoint`, stats de match (`MatchStats`) et de séance (`SessionStats` : FC, zones, buckets compactés).
- **Séance Garmin** (`ActivityService`) : `ActivityRecording` avec sport raquette + sous-sport (valeurs brutes, compile en API 3.4), pause/reprise, un tour FIT par set, enregistrement ou suppression ; filet `saveIfActive` à la fermeture de l'app.
- **Écrans** : `Ui.mc` (primitives à l'échelle de la maquette 454 px, choix de police par hauteur), `Pages.mc` (écrans), `MatchView.mc` (machine à états des boutons).
- **Persistance** : préférences v2 `[sport, fmtBad, fmtPadel, fmtSquash]`, migration de la v1.
- **Sync** : `config.sport`, plus les champs padel dans le snapshot (côté montre uniquement, le backend n'est pas encore adapté).

## Vérifications

- Tests : 72/72 sur epix2pro51mm et fr55.
- Simulateur, scénarios scriptés (pilote temporaire, retiré depuis) : badminton (points, pages, menu, undo, changement de set) et padel complet (match → enregistrement → récap 5 pages → retour au choix du sport), sans plantage sur les deux montres.
- Mémoire : epix ~51 Ko / 764 Ko ; **fr55 ~65 Ko / 124 Ko** (marge correcte).

## Constats

- **Watchdog fr55** : `PadelEngine.appendEvent` rejouait tout le journal à chaque point ; en fin de match padel (~150 events), le fr55 dépassait le watchdog. L'ajout est désormais incrémental (`applyEvent` sur l'état courant). Le replay complet reste réservé à `undo` et `restore`. À surveiller aussi pour `ScoreEngine` (journal plus court, pas d'incident constaté).
- Pas de pilotage du simulateur par `osascript` (autorisation d'accessibilité refusée) ; `screencapture` échoue depuis la session. Le contrôle visuel des écrans reste à faire à la main.
- Le preset « 11 points » de l'ancienne app n'existe plus dans la maquette.

## Clôture (2026-10-10)

Phase 9 terminée pour l'instant, fusionnée dans `main`.

- Contrôle visuel des écrans dans le simulateur (dont fr55) : **fait, OK**.
- **Padel côté stream reporté** : stocker `snapshot.padel` (`match_state` ne garde que les colonnes à plat, donc `!score` et les affichages ne voient que les points bruts 0..3), puis le rendu dans l'overlay, le widget SE et le renderer VPS (logique de pick à répercuter partout). Sera traité **avec le tennis**, dans un chantier commun « sports à jeux » (tennis / padel). L'annonce chat déclenchée par la sync gère déjà le padel.
- **Pour plus tard** : FitContributor (champs score dans le FIT), autres familles de montres, décision sur le fr55.

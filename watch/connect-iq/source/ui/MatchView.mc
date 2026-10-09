import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
using Toybox.System;
using Toybox.WatchUi;

// Écrans de l'app (mono-écran + états inline, spec §5).
module MatchScreen {
    const SETUP = 0;          // choix du format au démarrage
    const SCORE = 1;          // écran principal
    const CONFIRM_SET = 2;    // confirmation inline « terminer set ? » (DOWN=OUI BACK=NON)
    const SET_RESULT = 3;     // set terminé auto, en attente « set suivant » (DOWN)
    const MATCH_FINISHED = 4; // match terminé (DOWN = nouveau match)
    const MENU = 5;           // menu inline UP-long (Reprendre / Format / Reset / Quitter)
}

class MatchView extends WatchUi.View {

    // Direction B « Garmin natif » (docs/superpowers/notes/design-b-garmin-natif.html).
    const C_ME = 0x2FE05C;          // vert Garmin — MOI
    const C_GREY = 0x8B939B;        // labels secondaires — LUI, SET, SETS
    const C_DIM = 0x5B6167;         // aides, pastilles vides
    const C_SEP = 0x2A2E32;         // barre séparatrice, badge neutre
    const C_BANNER = 0x123421;      // bandeau set/match gagné
    const C_BANNER_LOSS = 0x2A1111; // bandeau défaite

    var mScreen = MatchScreen.SETUP;
    var mSetupIndex = 2;      // 21 POINTS par défaut
    var mMenuIndex = 0;
    var mEngine = null;
    var mMatchPresetIndex = 2;   // format du match EN COURS (figé au start/restore) —
                                 // distinct de mSetupIndex (sélection à l'écran Setup)
    var mMatchId = "";        // id du match courant (protocole §7.1)
    var mSync;                // service de sync Phase 4a (no-op si non configuré)

    function initialize() {
        View.initialize();
        mSetupIndex = MatchStore.loadPrefs()[1];   // format mémorisé (§5)
        mSync = new SyncService(DeviceId.getOrCreate());   // inconditionnel : aucun trigger null même sans match restauré
        var saved = MatchStore.loadMatch();
        if (saved != null) {
            // Match en cours persisté : reprise directe (§5 Démarrage)
            mMatchPresetIndex = saved["fi"];          // format du match restauré
            mSetupIndex = mMatchPresetIndex;          // présélection Setup cohérente
            if (mMatchPresetIndex < 0 || mMatchPresetIndex > 2) {   // clamp anti-corruption (M-1)
                mMatchPresetIndex = 2;
                mSetupIndex = 2;
            }
            mMatchId = saved["mid"];
            mEngine = new ScoreEngine(MatchPresets.get(mSetupIndex), mMatchId);
            mEngine.restore(saved["base"], saved["events"]);
            mEngine.setLastSequence(saved["ls"]);   // filet D-2 APRÈS restore (undo préalable)
            if (saved["ts"] != null) { mEngine.setStartedAtMs(saved["ts"].toLong()); }
            syncScreen();   // dérive SCORE/SET_RESULT/MATCH_FINISHED + première sauvegarde (§7.2)
        }
        WatchUi.requestUpdate();
    }

    // ---- délégué -> vue (le delegate n'a aucune logique) ----

    function onSelect() as Boolean {
        if (mScreen == MatchScreen.SETUP) {
            startMatch();
            return true;
        }
        if (mScreen == MatchScreen.SCORE) {
            mEngine.pointMe();
            syncScreen();
            return true;
        }
        if (mScreen == MatchScreen.MENU) {
            return menuSelect();
        }
        return true;
    }

    function onBack() as Boolean {
        if (mScreen == MatchScreen.SETUP) {
            if (mEngine != null) {          // match en cours (menu FORMAT) : BACK = annuler
                syncScreen();               // retour SCORE / SET_RESULT selon la phase
                return true;
            }
            return false;                   // pré-match ou match purgé : BACK ferme l'app (CIQ naturel)
        }
        if (mScreen == MatchScreen.SCORE) {
            mEngine.pointOpponent();
            syncScreen();
            return true;    // BACK = point adversaire, ne quitte jamais (spec §3.2)
        }
        if (mScreen == MatchScreen.CONFIRM_SET) {
            mScreen = MatchScreen.SCORE;   // BACK = NON
            WatchUi.requestUpdate();
            return true;
        }
        if (mScreen == MatchScreen.MENU) {
            mScreen = MatchScreen.SCORE;   // défaut, corrigé par syncScreen si phase ≠ PLAYING
            syncScreen();                  // retour à l'écran de la phase (SET_RESULT/MATCH_FINISHED) + save
            return true;
        }
        return true;
    }

    function onUp() as Boolean {
        if (mScreen == MatchScreen.SETUP) {
            mSetupIndex = (mSetupIndex + MatchPresets.count() - 1) % MatchPresets.count();
            WatchUi.requestUpdate();
            return true;
        }
        if (mScreen == MatchScreen.MENU) {
            mMenuIndex = (mMenuIndex + 3) % 4;   // UP : recule dans la liste de 4
            WatchUi.requestUpdate();
            return true;
        }
        if (mScreen == MatchScreen.SCORE || mScreen == MatchScreen.SET_RESULT) {
            mEngine.undo();              // UP = UNDO (§3.2/D7) — depuis SCORE et SET_RESULT
            syncScreen();                // set repris → SCORE ; undo SET_CHANGED → SET_RESULT
            return true;
        }
        return true;
    }

    function onDown() as Boolean {
        if (mScreen == MatchScreen.SETUP) {
            mSetupIndex = (mSetupIndex + 1) % MatchPresets.count();
            WatchUi.requestUpdate();
            return true;
        }
        if (mScreen == MatchScreen.SCORE) {
            mScreen = MatchScreen.CONFIRM_SET;   // DOWN = changement de set -> confirmation inline
            WatchUi.requestUpdate();
            return true;
        }
        if (mScreen == MatchScreen.CONFIRM_SET) {
            mScreen = MatchScreen.SCORE;         // DOWN = OUI : sortir de la confirmation
            mEngine.changeSet();                 // leader crédité, égalité non crédité (§4.4)
            syncScreen();                        // SET_RESULT / MATCH_FINISHED / SCORE selon la phase
            return true;
        }
        if (mScreen == MatchScreen.SET_RESULT) {
            mEngine.changeSet();                 // « set suivant » (SET_FINISHED déjà enregistré)
            syncScreen();
            return true;
        }
        if (mScreen == MatchScreen.MATCH_FINISHED) {
            MatchStore.clearMatch();             // résultat consulté → prochain lancement : Setup (§5)
            mEngine = null;                      // plus de match en cours : ni syncScreen ni persist ne sauvegarderont
            mSync.trigger(null);                 // plus de drain (mEngineRef = null)
            mScreen = MatchScreen.SETUP;         // DOWN = NOUVEAU (format mémorisé)
            WatchUi.requestUpdate();
            return true;
        }
        if (mScreen == MatchScreen.MENU) {
            mMenuIndex = (mMenuIndex + 1) % 4;
            WatchUi.requestUpdate();
            return true;
        }
        return true;
    }

    function onMenuButton() as Boolean {
        // §3.2 : menu inline = seul chemin de sortie → accessible depuis tous
        // les écrans de match (pas SETUP : BACK y ferme l'app naturellement).
        if (mScreen != MatchScreen.SETUP && mScreen != MatchScreen.MENU) {
            mScreen = MatchScreen.MENU;
            mMenuIndex = 0;
            WatchUi.requestUpdate();
            return true;
        }
        return true;
    }

    // ---- transitions ----

    function startMatch() as Void {
        mMatchId = MatchIds.generate();
        mMatchPresetIndex = mSetupIndex;
        
        mEngine = new ScoreEngine(MatchPresets.get(mSetupIndex), mMatchId);
        MatchStore.saveMatch(mEngine, 0, mMatchPresetIndex, 0);   // kill avant 1er point → reprise 0-0
        mSync.trigger(mEngine);             // flush du premier batch (§9.4)
        mScreen = MatchScreen.SCORE;
        WatchUi.requestUpdate();
    }

    // Filet de sauvegarde (App.onStop, §7.2) — chaque mutation sauvegarde déjà.
    function persist() as Void {
        if (mEngine != null) {
            MatchStore.saveMatch(mEngine, 0, mMatchPresetIndex, 0);
        }
    }

    // Après chaque mutation moteur : aligner l'écran sur la phase dérivée.
    function syncScreen() as Void {
        if (mEngine == null) { return; }   // pas de match : rien à dériver ni à sauvegarder
        MatchStore.saveMatch(mEngine, 0, mMatchPresetIndex, 0);   // setValue synchrone, §7.2
        mSync.trigger(mEngine);             // drain après chaque mutation (§7 sync)
        var p = mEngine.getPhase();
        if (p == ScorePhase.MATCH_FINISHED) {
            mScreen = MatchScreen.MATCH_FINISHED;
        } else if (p == ScorePhase.SET_RESULT) {
            mScreen = MatchScreen.SET_RESULT;
        } else if (mScreen != MatchScreen.MENU && mScreen != MatchScreen.CONFIRM_SET) {
            mScreen = MatchScreen.SCORE;
        }
        WatchUi.requestUpdate();
    }

    // Menu inline §5 : Reprendre / Changer de format / Réinitialiser / Quitter.
    // (Labels compacts « FORMAT »/« RESET » : écrans ronds, leçon Phase 1.)
    function menuSelect() as Boolean {
        if (mMenuIndex == 0) {
            mScreen = MatchScreen.SCORE;      // Reprendre (défaut, syncScreen corrige si phase ≠ PLAYING)
            syncScreen();
        } else if (mMenuIndex == 1) {
            mScreen = MatchScreen.SETUP;      // Changer de format (START = nouveau match)
            WatchUi.requestUpdate();
        } else if (mMenuIndex == 2) {
            mEngine.newMatch(mEngine.getConfig(), MatchIds.generate());   // Réinitialiser
            mScreen = MatchScreen.SCORE;   // sortir du menu AVANT syncScreen (garde MENU de syncScreen)
            syncScreen();                  // + sauvegarde du nouveau match
        } else {
            // Quitter = abandon du match : purge de la persistance (sinon la
            // reprise restaurerait le match au prochain lancement), moteur
            // annulé AVANT exit (filet App.onStop->persist() ne re-sauvegarde
            // rien), sync au repos, puis fermeture de l'app.
            MatchStore.clearMatch();
            mEngine = null;
            mSync.trigger(null);
            System.exit();                // dernier bloc, rien après
        }
        return true;
    }

    // ---- rendu ----

    function onUpdate(dc as Dc) as Void {
        // Fond opaque AVANT clear() — sinon les frames s'accumulent (leçon Phase 0).
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        var w = dc.getWidth();
        var h = dc.getHeight();
        switch (mScreen) {
        case MatchScreen.SETUP:
            drawSetup(dc, w, h);
            break;
        case MatchScreen.SCORE:
            drawScore(dc, w, h);
            break;
        case MatchScreen.CONFIRM_SET:
            drawConfirmSet(dc, w, h);
            break;
        case MatchScreen.SET_RESULT:
            drawSetResult(dc, w, h);
            break;
        case MatchScreen.MATCH_FINISHED:
            drawMatchFinished(dc, w, h);
            break;
        case MatchScreen.MENU:
            drawMenu(dc, w, h);
            break;
        }
        // Liseré d'état de sync sur tous les écrans sauf le menu (demande
        // utilisateur : vert pendant l'envoi, invisible une fois connecté,
        // rouge si erreur).
        if (mScreen != MatchScreen.MENU) {
            drawSyncBorder(dc, w, h);
        }
    }

    // Liseré périphérique : SYNC_ST_SEND = vert, SYNC_ST_ERR = rouge, rien
    // sinon (OK ou off). Anneau sur écran rond, 4 bandes sinon. Épaisseur
    // ~h/90 (3 px sur 280, plancher 2). Ne touche jamais au scoring : le
    // réseau reste non-bloquant (spec sync §7).
    function drawSyncBorder(dc as Dc, w as Number, h as Number) as Void {
        var st = mSync.getStatus();
        var color = null;
        if (st == SYNC_ST_SEND) { color = C_ME; }
        else if (st == SYNC_ST_ERR) { color = 0xE5484D; }
        else { return; }
        var t = h / 90;
        if (t < 2) { t = 2; }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        // Code d'erreur affiché en haut-centre : "401", "404", "t/o"…
        // pour distinguer clé refusée / URL / réseau (cf. guide, FAQ).
        if (st == SYNC_ST_ERR) {
            var err = mSync.getLastError();
            dc.drawText(w / 2, h / 12, Graphics.FONT_TINY, "sync " + (err == -1 ? "t/o" : err), Graphics.TEXT_JUSTIFY_CENTER);
        }
        if (System.getDeviceSettings().screenShape == System.SCREEN_SHAPE_ROUND) {
            var r = w / 2 - t / 2 - 1;
            var i = 0;
            for (i = 0; i < t; i += 1) { dc.drawCircle(w / 2, h / 2, r - i); }
        } else {
            dc.fillRectangle(0, 0, w, t);
            dc.fillRectangle(0, h - t, w, t);
            dc.fillRectangle(0, 0, t, h);
            dc.fillRectangle(w - t, 0, t, h);
        }
    }

    // Ligne d'aide du bas : FONT_SMALL si le texte tient, FONT_TINY sinon.
    // Bas du texte à h*7/8 : sur écran ROND, tout ce qui descend plus bas
    // déborde du cercle (corde quasi nulle au bas) — leçon Task 6 simu.
    function drawFooter(dc as Dc, w as Number, h as Number, text as String) as Void {
        var fSmall = dc.getFontHeight(Graphics.FONT_SMALL);
        var y = h * 7 / 8 - fSmall;
        if (dc.getTextWidthInPixels(text, Graphics.FONT_SMALL) > w * 2 / 3) {
            dc.drawText(w / 2, y, Graphics.FONT_TINY, text, Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.drawText(w / 2, y, Graphics.FONT_SMALL, text, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // Gros chiffres (échelle par hauteur) : NUMBER_HOT sur les grands AMOLED,
    // NUMBER_MEDIUM en dessous. (FONT_NUMBER_LARGE du gabarit n'existe pas dans
    // l'API — palier intermédiaire et palier bas fusionnés sur NUMBER_MEDIUM,
    // conformément à l'annotation fr55 de la spec.)
    function bigFont(h as Number) {
        return (h >= 380) ? Graphics.FONT_NUMBER_HOT : Graphics.FONT_NUMBER_MEDIUM;
    }

    // Labels (MOI/LUI, SET, SETS) : SMALL sur les grands écrans, TINY sinon.
    function labelFont(h as Number) {
        return (h >= 380) ? Graphics.FONT_SMALL : Graphics.FONT_TINY;
    }

    // Plus grande police NUMBER dont la hauteur tient dans l'espace disponible.
    function fittedBigFont(dc as Dc, avail as Number) {
        if (dc.getFontHeight(Graphics.FONT_NUMBER_HOT) <= avail) { return Graphics.FONT_NUMBER_HOT; }
        if (dc.getFontHeight(Graphics.FONT_NUMBER_MEDIUM) <= avail) { return Graphics.FONT_NUMBER_MEDIUM; }
        return Graphics.FONT_NUMBER_MILD;
    }

    // Bandeau supérieur plein (coins rognés par le masque rond — voulu) avec
    // texte blanc centré verticalement ; police adaptée à la corde du cercle
    // (demi-corde au carré pour éviter la racine carrée).
    function drawBanner(dc as Dc, w as Number, h as Number, text as String, color as Number) as Void {
        var bannerH = h * 3 / 10;
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(0, 0, w, bannerH);
        var r = h / 2;
        var dy = r - bannerH / 2;
        var halfChord2 = r * r - dy * dy;
        var margin = h / 40;
        var font = Graphics.FONT_MEDIUM;
        var halfW = dc.getTextWidthInPixels(text, font) / 2 + margin;
        if (halfW * halfW > halfChord2) {
            font = Graphics.FONT_SMALL;
            halfW = dc.getTextWidthInPixels(text, font) / 2 + margin;
        }
        if (halfW * halfW > halfChord2) {
            font = Graphics.FONT_TINY;   // repli : léger rognage possible au bas du badge
        }
        var fT = dc.getFontHeight(font);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, bannerH / 2 - fT / 2, font, text, Graphics.TEXT_JUSTIFY_CENTER);
    }

    // Layout commun des écrans à bandeau (SET_RESULT / MATCH_FINISHED) : gros
    // score centré entre le bandeau et la sous-ligne, sous-ligne au-dessus du
    // footer. Retourne [bigFont, bigTop, subTop] — layout du bas vers le haut
    // (les polices NUMBER dépassent la chaîne spec « chiffres à h/2 + subLineY »
    // sur tous les profils : collision prouvée par mesures de polices).
    function bannerBigLayout(dc as Dc, h as Number, footerText as String) as Array {
        var gap = h / 60;
        var fSub = dc.getFontHeight(labelFont(h));
        var fFooter = dc.getFontHeight(Graphics.FONT_SMALL);
        if (dc.getTextWidthInPixels(footerText, Graphics.FONT_SMALL) > dc.getWidth() * 2 / 3) {
            fFooter = dc.getFontHeight(Graphics.FONT_TINY);
        }
        var subTop = h * 7 / 8 - fFooter - gap - fSub;
        var bannerBottom = h * 3 / 10;
        var avail = subTop - gap - bannerBottom - gap;
        var big = fittedBigFont(dc, avail);
        var fBig = dc.getFontHeight(big);
        return [big, bannerBottom + (avail - fBig) / 2, subTop];
    }

    function drawSetup(dc as Dc, w as Number, h as Number) as Void {
        var fSmall = dc.getFontHeight(Graphics.FONT_SMALL);
        var fMedium = dc.getFontHeight(Graphics.FONT_MEDIUM);
        dc.drawText(w / 2, h / 8, Graphics.FONT_SMALL, "FORMAT", Graphics.TEXT_JUSTIFY_CENTER);
        var titleBottom = h / 8 + fSmall;
        var footerTop = h * 7 / 8 - fSmall;          // coherent avec drawFooter
        var zone = footerTop - titleBottom;
        var spacing = 3 * fMedium / 2;
        if (spacing * 2 + fMedium > zone) {
            spacing = (zone - fMedium) / 2;          // resserré : items entre titre et footer
            if (spacing < 1) { spacing = 1; }
        }
        var y = titleBottom + (zone - (spacing * 2 + fMedium)) / 2;
        for (var i = 0; i < MatchPresets.count(); i += 1) {
            var marker = (i == mSetupIndex) ? "> " : "  ";
            dc.setColor((i == mSetupIndex) ? C_ME : C_GREY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, y, Graphics.FONT_MEDIUM, marker + MatchPresets.label(i), Graphics.TEXT_JUSTIFY_CENTER);
            y += spacing;
        }
        drawFooter(dc, w, h, "START = OK");
    }

    // Direction B : label SET, DEUX gros chiffres séparés par une barre (pas de
    // « - » texte), MOI/LUI centrés sous chaque chiffre, pastilles de sets,
    // footer = preset seul. Layout vertical calculé du bas vers le haut (footer
    // → pastilles → labels → chiffres → header) : avec les polices NUMBER, la
    // chaîne spec « chiffres à h/2 + subLineY » se chevauche sur tous les
    // profils (mesures : epix NUM_HOT 160 px, fr55 NUM_MEDIUM 79 px) — la
    // remontée depuis le footer garantit zéro collision dans le cercle.
    function drawScore(dc as Dc, w as Number, h as Number) as Void {
        var big = bigFont(h);
        var fBig = dc.getFontHeight(big);
        var fLab = dc.getFontHeight(labelFont(h));
        var gap = h / 60;

        // Bas de page : footer + pastilles (hauteur du footer dupliquée de
        // drawFooter, qui choisit SMALL/TINY selon la largeur).
        var footerText = MatchPresets.shortLabel(mMatchPresetIndex);
        var fFooter = dc.getFontHeight(Graphics.FONT_SMALL);
        if (dc.getTextWidthInPixels(footerText, Graphics.FONT_SMALL) > w * 2 / 3) {
            fFooter = dc.getFontHeight(Graphics.FONT_TINY);
        }
        var footerTop = h * 7 / 8 - fFooter;
        var r = h / 90;
        if (r < 3) { r = 3; }
        var dotsCenter = footerTop - gap - r;

        // Labels MOI/LUI sous les chiffres.
        var labelsTop = dotsCenter - r - gap - fLab;

        // Gros chiffres + barre séparatrice (hauteur 62 % de la police).
        var sMe = mEngine.getScoreMe() + "";
        var sOpp = mEngine.getScoreOpp() + "";
        var wMe = dc.getTextWidthInPixels(sMe, big);
        var wOpp = dc.getTextWidthInPixels(sOpp, big);
        var sepW = h / 130;
        if (sepW < 2) { sepW = 2; }
        var sepH = fBig * 62 / 100;
        var digitsGap = h / 45;
        var total = wMe + digitsGap + sepW + digitsGap + wOpp;
        var startX = (w - total) / 2;
        var digitsTop = labelsTop - gap - fBig;

        // Header remonté au-dessus des chiffres.
        var headTop = digitsTop - gap - fLab;

        dc.setColor(C_GREY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, headTop, labelFont(h), "SET " + mEngine.getSetNumber(), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(C_ME, Graphics.COLOR_TRANSPARENT);
        dc.drawText(startX, digitsTop, big, sMe, Graphics.TEXT_JUSTIFY_LEFT);
        dc.setColor(C_SEP, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(startX + wMe + digitsGap, digitsTop + (fBig - sepH) / 2, sepW, sepH);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(startX + wMe + digitsGap + sepW + digitsGap, digitsTop, big, sOpp, Graphics.TEXT_JUSTIFY_LEFT);
        dc.setColor(C_ME, Graphics.COLOR_TRANSPARENT);
        dc.drawText(startX + wMe / 2, labelsTop, labelFont(h), "MOI", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(C_GREY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(startX + wMe + digitsGap + sepW + digitsGap + wOpp / 2, labelsTop, labelFont(h), "LUI", Graphics.TEXT_JUSTIFY_CENTER);
        // Pastilles de sets centrées sous chaque chiffre (demande utilisateur) :
        // mes sets sous MOI, les siens sous LUI, espacées d'un rayon.
        drawSetDots(dc, startX + wMe / 2, startX + wMe + digitsGap + sepW + digitsGap + wOpp / 2, dotsCenter, r);
        drawFooter(dc, w, h, footerText);
    }

    // Pastilles de sets : setsToWin pastilles par camp, groupe centré sur le
    // chiffre correspondant (meCx / oppCx), espacement 3r. Les miennes :
    // PLEIN C_ME si gagné, creux C_DIM sinon ; les siennes : PLEIN/creux C_DIM.
    // y = centre de la rangée.
    function drawSetDots(dc as Dc, meCx as Number, oppCx as Number, y as Number, r as Number) as Void {
        var setsToWin = mEngine.getConfig().mSetsToWin;
        var d = 2 * r;
        var spacing = 3 * r;                 // pastilles espacées d'un rayon
        var groupW = (setsToWin - 1) * spacing + d;
        var setsMe = mEngine.getSetsMe();
        var x = meCx - groupW / 2;
        for (var i = 0; i < setsToWin; i += 1) {
            dc.setColor((i < setsMe) ? C_ME : C_DIM, Graphics.COLOR_TRANSPARENT);
            if (i < setsMe) { dc.fillCircle(x + r, y, r); } else { dc.drawCircle(x + r, y, r); }
            x += spacing;
        }
        var setsOpp = mEngine.getSetsOpp();
        x = oppCx - groupW / 2;
        for (var j = 0; j < setsToWin; j += 1) {
            dc.setColor(C_DIM, Graphics.COLOR_TRANSPARENT);
            if (j < setsOpp) { dc.fillCircle(x + r, y, r); } else { dc.drawCircle(x + r, y, r); }
            x += spacing;
        }
    }

    function drawConfirmSet(dc as Dc, w as Number, h as Number) as Void {
        var fSmall = dc.getFontHeight(Graphics.FONT_SMALL);
        var fLarge = dc.getFontHeight(Graphics.FONT_LARGE);
        dc.drawText(w / 2, h / 4, Graphics.FONT_SMALL, "TERMINER SET " + mEngine.getSetNumber() + " ?", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w / 2, h / 2 - fLarge / 2, Graphics.FONT_LARGE,
            mEngine.getScoreMe() + " - " + mEngine.getScoreOpp(), Graphics.TEXT_JUSTIFY_CENTER);
        // Aide sur 2 lignes : le texte complet dépasse la corde du cercle
        // même en FONT_TINY (mesures Task 6). 2 lignes courtes tiennent.
        var y2 = h * 7 / 8 - fSmall;
        dc.setColor(C_GREY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y2, Graphics.FONT_SMALL, "BACK = NON", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(C_ME, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y2 - fSmall, Graphics.FONT_SMALL, "DOWN = OUI", Graphics.TEXT_JUSTIFY_CENTER);
    }

    function drawSetResult(dc as Dc, w as Number, h as Number) as Void {
        var footerText = "DOWN = SET SUIV.";
        drawBanner(dc, w, h, "SET " + mEngine.getSetNumber() + " TERMINE", C_BANNER);
        var layout = bannerBigLayout(dc, h, footerText);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, layout[1], layout[0],
            mEngine.getLastSetScoreMe() + " - " + mEngine.getLastSetScoreOpp(), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(C_GREY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, layout[2], labelFont(h),
            "SETS " + mEngine.getSetsMe() + "-" + mEngine.getSetsOpp(), Graphics.TEXT_JUSTIFY_CENTER);
        drawFooter(dc, w, h, footerText);
    }

    function drawMatchFinished(dc as Dc, w as Number, h as Number) as Void {
        var footerText = "DOWN = NOUVEAU";
        var won = mEngine.getSetsMe() > mEngine.getSetsOpp();
        drawBanner(dc, w, h, "MATCH TERMINE", won ? C_BANNER : C_BANNER_LOSS);
        var layout = bannerBigLayout(dc, h, footerText);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, layout[1], layout[0],
            mEngine.getSetsMe() + " - " + mEngine.getSetsOpp(), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(won ? C_ME : C_GREY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, layout[2], labelFont(h), won ? "MOI GAGNE" : "LUI GAGNE", Graphics.TEXT_JUSTIFY_CENTER);
        drawFooter(dc, w, h, footerText);
    }

    // Direction B : PAS de titre — 4 lignes badge+label dans la bande centrale
    // (h/6 → 5h/6). Largeur des lignes = corde du cercle aux bords extérieurs
    // des lignes extrêmes (haut de la 1re, bas de la dernière), marge h/80 :
    // sur rond, une ligne pleine largeur déborde du cadre en haut et en bas.
    // Ligne sélectionnée : SANS fond — pilule d'accent verte à gauche, label
    // et badge en vert ; autres lignes : label C_GREY, badge contour C_SEP /
    // texte C_DIM. Badge = anneau 2px (fill extérieur + fill intérieur noir) —
    // anneau plus visible que le simple contour 1px de drawRoundedRectangle.
    function drawMenu(dc as Dc, w as Number, h as Number) as Void {
        var items = ["RESUME", "FORMAT", "RESET", "QUITTER"];
        // Petits écrans (rond 208 / semi-octogone 176) : items en SMALL —
        // 4 items MEDIUM débordent de la corde du bas (fr55 : 153px vs corde 140).
        var itemFont = (h < 300) ? Graphics.FONT_SMALL : Graphics.FONT_MEDIUM;
        var fItem = dc.getFontHeight(itemFont);
        var radius = h / 40;
        // Badge compact : texte en XTINY (le TINY fr55 était presque aussi
        // gros que le label), boîte collée au texte (padding fixe 2px).
        var fBadge = dc.getFontHeight(Graphics.FONT_XTINY);
        var bp = 2;
        var badgeW = dc.getTextWidthInPixels("START", Graphics.FONT_XTINY) + 2 * bp;
        var badgeH = fBadge + 2 * bp;
        var vp = h / 80;                     // padding vertical de ligne
        var rowH = (badgeH > fItem ? badgeH : fItem) + 2 * vp;
        var topLimit = h / 6;
        var bottomLimit = h * 5 / 6;
        var zone = bottomLimit - topLimit;
        var spacing = rowH + h / 40;
        if (spacing * 3 + rowH > zone) {
            spacing = (zone - rowH) / 3;     // compression (fr55, epix)
            if (spacing < 1) { spacing = 1; }
        }
        var y = topLimit + (zone - (spacing * 3 + rowH)) / 2;
        // Corde aux bords extérieurs des lignes extrêmes — la plus restrictive
        // (bord haut de la 1re ligne ou bord bas de la dernière, symétrie).
        var r = h / 2;
        var dyT = r - y;
        var dyB = y + spacing * 3 + rowH - r;
        var dy = dyT > dyB ? dyT : dyB;
        var hc = 0;                          // demi-corde (entier)
        if (dy < r) { hc = Math.sqrt(r * r - dy * dy).toNumber(); }
        var inset = h / 80;
        var rowLeft = r - hc + inset;
        var rowRight = r + hc - inset;
        var labelGap = 6;
        var accentW = 4;                     // pilule d'accent de la ligne sélectionnée
        var accentGap = 4;
        for (var i = 0; i < items.size(); i += 1) {
            var sel = (i == mMenuIndex);
            // colonnes alignées : l'accent réserve sa place sur toutes les lignes
            var contentX = rowLeft + accentW + accentGap;
            if (sel) {
                dc.setColor(C_ME, Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(rowLeft, y + (rowH - fItem) / 2, accentW, fItem, accentW / 2);
            }
            // badge touche
            var by = y + (rowH - badgeH) / 2;
            dc.setColor(sel ? C_ME : C_SEP, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(contentX, by, badgeW, badgeH, radius);
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(contentX + 2, by + 2, badgeW - 4, badgeH - 4, radius > 2 ? radius - 2 : 1);
            dc.setColor(sel ? C_ME : C_DIM, Graphics.COLOR_TRANSPARENT);
            dc.drawText(contentX + badgeW / 2, by + (badgeH - fBadge) / 2, Graphics.FONT_XTINY, "START", Graphics.TEXT_JUSTIFY_CENTER);
            // label (repli TINY si la corde manque, puis recul sans passer sous le badge)
            var labelX = contentX + badgeW + labelGap;
            var labelFont = itemFont;
            var labelW = dc.getTextWidthInPixels(items[i], labelFont);
            if (labelX + labelW > rowRight) {
                var tinyW = dc.getTextWidthInPixels(items[i], Graphics.FONT_TINY);
                if (labelX + tinyW <= rowRight) {
                    labelFont = Graphics.FONT_TINY;
                    labelW = tinyW;
                } else {
                    labelX = rowRight - labelW;
                    if (labelX < rowLeft + badgeW + labelGap) { labelX = rowLeft + badgeW + labelGap; }
                }
            }
            dc.setColor(sel ? C_ME : C_GREY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(labelX, y + (rowH - dc.getFontHeight(labelFont)) / 2, labelFont, items[i], Graphics.TEXT_JUSTIFY_LEFT);
            y += spacing;
        }
    }
}

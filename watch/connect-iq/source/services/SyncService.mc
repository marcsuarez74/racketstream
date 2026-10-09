import Toybox.Application.Properties;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// Synchronisation montre → backend (Phase 4a, spec sync §7). Jamais bloquant :
// le scoring ne dépend jamais du réseau. Batchs ≤ 5 events + snapshot, une
// seule requête en vol, ≥ 5 s entre débuts (BLE 400-800 o/s), timeout
// applicatif 30 s (le callback makeWebRequest peut ne jamais être appelé,
// §3.8 de la spec sync), backoff 10 s → 2 min.

// État de sync affiché sur l'écran score (point haut-droite) — noms globaux
// uniques pour éviter toute collision d'espaces de noms Monkey C.
const SYNC_ST_OFF = 0;      // config absente : service inactif
const SYNC_ST_OK = 1;       // dernier échange : ACK reçu
const SYNC_ST_SEND = 2;     // requête en vol
const SYNC_ST_ERR = 3;      // erreur / timeout (backoff en cours)

class SyncService {
    var mCore;
    var mDeviceId;
    var mInFlight = false;
    var mLastAttemptMs = 0l;
    var mLastRttMs = 0;         // aller-retour de la dernière sync réussie (mesure de latence)
    var mBackoffUntilMs = 0l;
    var mErrors = 0;
    var mLastError = 0;
    var mEngineRef = null;      // dernier engine vu (drain / watchdog)
    var mInFlightMatchId = "";  // matchId de la requête en vol (ACK lié au bon match)
    var mTimer;                 // watchdog 30 s OU drain — un seul rôle à la fois
    var mStatus = SYNC_ST_OFF;  // état visible (indicateur écran score)
    var mOpenedId = "";         // match connu du serveur (0-0 envoyé ou point acquitté)
    var mStopEngine = null;     // match arrêté : vider ses points puis envoyer « stop »
    var mStopFrom = 1;          // 1re séquence non acquittée du match arrêté
    var mStoppedId = "";        // dernier match pour lequel l'arrêt a été demandé
    var mInFlightStop = false;  // la requête en vol est l'arrêt

    function initialize(deviceId as String) {
        mCore = new SyncCore();
        mDeviceId = deviceId;
        mTimer = new Timer.Timer();
    }

    function getStatus() as Number {
        return mStatus;
    }

    // Dernier code de réponse non-OK (diagnostic : affiché par le liseré
    // rouge). -1 = timeout applicatif, 0 = aucun.
    function getLastError() as Number {
        return mLastError;
    }

    // Déclencheur : après chaque saveMatch (MatchView.syncScreen / startMatch)
    // et au lancement (flush §9.4). Configuration absente → inactif (graceful).
    function trigger(engine) as Void {
        mEngineRef = engine;
        _pump();
    }

    // Fin de séance ou abandon : les points en attente partent d'abord, puis
    // « stop » → le serveur archive le match et l'overlay se vide aussitôt.
    function stop(engine) as Void {
        if (engine == null || engine.getMatchId().equals(mStoppedId)) { return; }
        mStoppedId = engine.getMatchId();
        mStopEngine = engine;
        mStopFrom = MatchStore.getPendingFrom();
        mEngineRef = null;
        _pump();
    }

    function _pump() as Void {
        var engine = mStopEngine != null ? mStopEngine : mEngineRef;
        if (engine == null) { return; }
        // Config cuisée au build (BackendConfig, fiable sur matériel) sinon
        // Properties (chemin nominal store via GCM). Lecture défensive :
        // GCM peut relâcher le type des properties (FAQ Garmin) → toString().
        var url = BackendConfig.BACKEND_URL;
        var key = BackendConfig.DEVICE_KEY;
        if (url == null || url.equals("")) {
            var pUrl = Properties.getValue("backendUrl");
            if (pUrl != null) { url = pUrl.toString(); }
            // Migration phase 8 : Supabase est arrêté ; une ancienne valeur
            // conservée par GCM après mise à jour pointe vers le VPS.
            if (url != null && url.find("supabase.co") != null) {
                url = "https://racket-stream.marc-suarez.fr/functions/v1/sync";
            }
        }
        if (key == null || key.equals("")) {
            var pKey = Properties.getValue("deviceKey");
            if (pKey != null) { key = pKey.toString(); }
        }
        if (url == null || url.equals("") || key == null || key.equals("")) {
            mStatus = SYNC_ST_OFF;
            return;
        }
        // Tolérance de collage : l'URL de base attendue est
        // https://…/functions/v1/sync (le slug Edge = nom du dossier). On
        // complète selon ce que GCM/settings.xml fournissent : racine →
        // +/functions/v1/sync ; sinon si /functions/v1 → +/sync.
        if (url.find("/functions/v1/sync") == null) {
            if (url.find("/functions/v1") != null) { url = url + "/sync"; }
            else { url = url + "/functions/v1/sync"; }
        }
        var now = System.getTimer();
        if (!mCore.shouldSend(now, mLastAttemptMs, mInFlight, mBackoffUntilMs)) {
            // Point marqué pendant le créneau minimal (ou le backoff) : l'envoyer
            // dès la fin du créneau, sans attendre le point suivant. En vol, la
            // réponse s'en charge (_scheduleDrain) et le timer sert de watchdog.
            if (!mInFlight) { mTimer.stop(); _scheduleDrain(); }
            return;
        }
        if (mStopEngine != null) {
            var pending = mCore.batchSlice(mStopEngine.getEvents(), mStopFrom, 5);
            _send(url, key, mStopEngine, pending, pending.size() == 0);
            return;
        }
        var batch = mCore.batchSlice(engine.getEvents(), MatchStore.getPendingFrom(), 5);
        // Sans point en attente, un match inconnu du serveur est quand même
        // envoyé (0-0) : l'overlay quitte l'ancien score dès le nouveau match.
        if (batch.size() == 0 && mOpenedId.equals(engine.getMatchId())) { return; }
        _send(url, key, engine, batch, false);
    }

    function _send(url as String, key as String, engine, batch as Array, isStop as Boolean) as Void {
        mInFlight = true;
        mInFlightStop = isStop;
        mStatus = SYNC_ST_SEND;
        mInFlightMatchId = engine.getMatchId();
        mLastAttemptMs = System.getTimer();
        var fullUrl = url + "/matches/" + engine.getMatchId() + "/events";
        var body = mCore.buildBody(engine, mDeviceId, batch);
        // Mesure de latence (horloge montre, ms) : le serveur en déduit l'attente
        // du point sur la montre (sentAt - ts) et le trajet (rtt). Ignoré sinon.
        body["sentAt"] = mLastAttemptMs;
        if (mLastRttMs > 0) { body["rtt"] = mLastRttMs; }
        if (isStop) { body["stop"] = true; }
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => { "X-Device-Key" => key, "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        mTimer.stop();
        mTimer.start(method(:_onTimeout), 30000, false);
        Communications.makeWebRequest(fullUrl, body, options, method(:_onResponse));
        var seq = batch.size() > 0 ? (batch[batch.size() - 1] as Array)[2] : 0;
        System.println("[sync] envoi seq<=" + seq + (isStop ? " stop" : "") + " via " + fullUrl);
    }

    function _onResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        mTimer.stop();
        mInFlight = false;
        if (responseCode == 200) {
            mLastRttMs = System.getTimer() - mLastAttemptMs;
            mErrors = 0;
            mBackoffUntilMs = 0l;
            mStatus = SYNC_ST_OK;
            mLastError = 0;
            mOpenedId = mInFlightMatchId;
            var stopping = mStopEngine != null && mStopEngine.getMatchId().equals(mInFlightMatchId);
            if (stopping && mInFlightStop) { mStopEngine = null; }
            if (data != null && data instanceof Dictionary) {
                var ack = (data as Dictionary)["lastAcceptedSequence"];
                if (ack != null && stopping) { mStopFrom = ack + 1; }
                if (ack != null && mEngineRef != null && mEngineRef.getMatchId().equals(mInFlightMatchId)) {
                    MatchStore.ackUntil(ack);
                    System.println("[sync] ack " + ack);
                }
            }
        } else {
            mErrors += 1;
            mLastError = responseCode;
            mBackoffUntilMs = System.getTimer() + mCore.nextBackoffMs(mErrors);
            mStatus = SYNC_ST_ERR;
            // Arrêt impossible (hors ligne) : abandon après 3 échecs, le
            // serveur le masquera de toute façon au bout de 10 min.
            if (mStopEngine != null && mErrors >= 3) { mStopEngine = null; }
            System.println("[sync] erreur " + responseCode + " -> backoff");
        }
        WatchUi.requestUpdate();             // efface le liseré d'envoi dès la réponse
        _scheduleDrain();
    }

    // Le callback peut ne jamais être appelé (GCM endormie) — §3.8.
    function _onTimeout() as Void {
        if (mInFlight) {
            Communications.cancelAllRequests();
            _onResponse(Communications.NETWORK_REQUEST_TIMED_OUT, null);
        }
    }

    // File non vide → re-tenter au prochain créneau (≥ 2 s / backoff).
    function _scheduleDrain() as Void {
        if (!_hasWork()) { return; }
        var now = System.getTimer();
        var next = mLastAttemptMs + 2000l;
        if (mBackoffUntilMs > next) { next = mBackoffUntilMs; }
        var delay = next - now;
        if (delay < 1000l) { delay = 1000l; }
        mTimer.start(method(:_drain), delay, false);
    }

    function _drain() as Void {
        _pump();
    }

    // Reste-t-il à envoyer : arrêt, ouverture d'un match (0-0) ou points ?
    function _hasWork() as Boolean {
        if (mStopEngine != null) { return true; }
        var engine = mEngineRef;
        if (engine == null) { return false; }
        if (!mOpenedId.equals(engine.getMatchId())) { return true; }
        return mCore.batchSlice(engine.getEvents(), MatchStore.getPendingFrom(), 5).size() > 0;
    }
}

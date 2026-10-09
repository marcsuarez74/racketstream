// RacketStream — Custom Widget StreamElements : onglet JS.
// Port de overlay/index.html (lecture publique de l'API VPS /api/score).
// Sonde toutes les 2 s (pas d'EventSource : non garanti dans un Custom Widget
// SE) : score affiché ≤ 2 s après chaque point. Choix du match fait côté
// serveur (actif le plus récent, sinon le plus récent : le final reste affiché).
window.addEventListener("onWidgetLoad", function (obj) {
  const f = obj.detail.fieldData;
  const API = "https://racket-stream.marc-suarez.fr";
  // Anti-fantôme (aligné sur l'overlay et le renderer VPS).
  const STALE_MS = 600 * 1000;

  const CHANNEL = (f.channel || "marc").replace(/[^A-Za-z0-9_-]/g, "");
  const NAME1 = f.name1 || "MOI";
  const NAME2 = f.name2 || "LUI";
  const SCALE = parseFloat(f.scale || 1);
  const SHOW_PANELS = f.bg !== false;

  document.getElementById("n1").textContent = NAME1;
  document.getElementById("n2").textContent = NAME2;
  if (!SHOW_PANELS) {
    const bug = document.getElementById("bug");
    bug.style.background = "transparent";
    bug.style.borderColor = "transparent";
    bug.style.boxShadow = "none";
    document.querySelector(".sep").style.background = "rgba(255, 255, 255, 0.25)";
    document.querySelectorAll(".name, .pts, .setlab").forEach((el) => {
      el.style.textShadow = "0 2px 8px rgba(0, 0, 0, 0.8)";
    });
  }
  if (SCALE !== 1) document.getElementById("wrap").style.setProperty("--scale", SCALE);

  function pips(el, won, setsToWin) {
    const total = Math.max(2, setsToWin);
    el.innerHTML = "";
    for (let i = 0; i < total; i++) {
      const p = document.createElement("div");
      p.className = "pip" + (won > i ? " won" : "");
      p.dataset.won = won > i ? "1" : "0";
      el.appendChild(p);
    }
  }

  function tick(id, value) {
    const el = document.getElementById(id);
    if (el.textContent !== String(value)) {
      el.textContent = value;
      el.classList.remove("tick");
      void el.offsetWidth;                    // relance l'animation
      el.classList.add("tick");
    }
  }

  function render(st) {
    document.getElementById("bug").style.display = "flex";
    document.getElementById("empty").style.display = "none";
    tick("p1", st.score_me);
    tick("p2", st.score_opp);
    const stw = (st.config && st.config.setsToWin) || 2;
    pips(document.getElementById("d1"), st.sets_me, stw);
    pips(document.getElementById("d2"), st.sets_opp, stw);
    document.getElementById("setlab").textContent = "SET " + st.current_set;
  }

  async function pick() {
    let row;
    try {
      const res = await fetch(API + "/api/score?channel=" + encodeURIComponent(CHANNEL), { cache: "no-store" });
      if (!res.ok) return;                     // erreur serveur : on garde l'affichage
      row = await res.json();
    } catch { return; }                        // hors ligne : idem
    const ghost = row && row.status === "active" && Date.now() - row.updated_at > STALE_MS;
    if (row && !ghost) { render(row); return; }
    document.getElementById("bug").style.display = "none";
    document.getElementById("empty").style.display = "block";
  }

  pick();
  setInterval(pick, 2000);
});

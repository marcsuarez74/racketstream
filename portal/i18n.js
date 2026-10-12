// Langue du portail (FR/EN) — script classique, chargé dans le <head> de
// chaque page, avant les scripts de la page.
//
// - Langue : choix mémorisé (localStorage "rs-lang"), sinon celle du
//   navigateur (français si elle commence par « fr », anglais sinon).
// - Textes statiques : le HTML reste en français ; un élément traduit porte
//   data-en="…" (texte), data-en-html="…" (HTML), data-en-aria-label,
//   data-en-placeholder, data-en-title, data-en-content (balise <meta>).
//   Ne jamais mettre data-en sur un élément dont le script de la page
//   réécrit le texte : utiliser I18N.t("fr", "en") dans le script.
// - Blocs longs (pages légales) : <div data-lang="fr"> / <div data-lang="en">,
//   seul celui de la langue courante est affiché.
// - Sélecteur : un élément vide <span data-langsw></span> reçoit les boutons
//   FR | EN ; changer de langue mémorise le choix et recharge la page.
(function () {
  const KEY = "rs-lang";
  const ok = (l) => l === "fr" || l === "en";
  // Priorité : ?lang= dans l'adresse (mémorisé), choix mémorisé, navigateur.
  const q = new URLSearchParams(location.search).get("lang");
  let saved = null;
  try {
    if (ok(q)) localStorage.setItem(KEY, q);
    saved = localStorage.getItem(KEY);
  } catch { /* stockage bloqué */ }
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || "fr";
  const lang = ok(q) ? q : ok(saved) ? saved : (/^fr\b/i.test(nav) ? "fr" : "en");
  const en = lang === "en";
  document.documentElement.lang = lang;

  const ATTRS = ["aria-label", "placeholder", "title", "content"];

  function apply(root) {
    const r = root || document;
    if (en) {
      r.querySelectorAll("[data-en]").forEach((el) => { el.textContent = el.dataset.en; });
      r.querySelectorAll("[data-en-html]").forEach((el) => { el.innerHTML = el.dataset.enHtml; });
      for (const a of ATTRS) {
        r.querySelectorAll("[data-en-" + a + "]").forEach((el) => { el.setAttribute(a, el.getAttribute("data-en-" + a)); });
      }
    }
    r.querySelectorAll("[data-lang]").forEach((el) => { el.hidden = el.dataset.lang !== lang; });
    r.querySelectorAll("[data-langsw]").forEach(mount);
  }

  function set(l) {
    if (l === lang || !ok(l)) return;
    let stored = false;
    try { localStorage.setItem(KEY, l); stored = localStorage.getItem(KEY) === l; } catch { /* stockage bloqué */ }
    const u = new URL(location.href);
    // Sans stockage, la langue passe par l'adresse ; sinon on retire ?lang=
    // pour que le choix mémorisé s'applique.
    if (stored) u.searchParams.delete("lang"); else u.searchParams.set("lang", l);
    if (u.href === location.href) location.reload(); else location.replace(u);
  }

  // Sélecteur FR | EN (maquette « Langue » du canevas) : indicateur dégradé
  // qui glisse sous la langue courante.
  function mount(host) {
    if (host.firstChild) return;
    host.className = (host.className ? host.className + " " : "") + "langsw";
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", en ? "Language" : "Langue");
    host.innerHTML = '<span class="langsw-ind" aria-hidden="true"></span>'
      + '<button type="button" lang="fr" aria-pressed="' + !en + '">FR</button>'
      + '<button type="button" lang="en" aria-pressed="' + en + '">EN</button>';
    if (en) host.classList.add("is-en");
    host.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => set(b.lang)));
  }

  const css = document.createElement("style");
  css.textContent = ".langsw{position:relative;flex-shrink:0;display:inline-grid;grid-template-columns:40px 40px;gap:4px;background:#1A1F26;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)}"
    + ".langsw button{position:relative;z-index:1;min-height:44px;padding:0;border:0;background:transparent;color:#C9D1DA;font:inherit;font-size:15px;font-weight:900;font-style:italic;font-stretch:85%;cursor:pointer;transition:color .25s}"
    + ".langsw button[aria-pressed=true]{color:#04140C}"
    + ".langsw button:focus-visible{outline:2px solid #22D3EE;outline-offset:-2px}"
    + ".langsw-ind{position:absolute;top:0;bottom:0;left:0;width:40px;background:linear-gradient(100deg,#3DD68C,#22D3EE);clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);transition:transform .4s cubic-bezier(.3,1.35,.4,1)}"
    + ".langsw.is-en .langsw-ind{transform:translateX(44px)}"
    + "@media (prefers-reduced-motion:reduce){.langsw-ind,.langsw button{transition:none}}";
  document.head.appendChild(css);

  window.I18N = {
    lang,
    // Texte selon la langue : I18N.t("Copié", "Copied").
    t: (fr, enText) => (en ? enText : fr),
    apply,
    set,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply());
  else apply();
})();

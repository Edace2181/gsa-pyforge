/* Mission 12: phone screen switching between THE FORGE and THE ANVIL.
   Purely a view toggle: it never touches the worker, the editor text, or the console contents. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const body = document.body, ed = $("editor"), con = $("console"), mq = matchMedia("(max-width: 760px)");
  const inAnvil = () => body.classList.contains("anvil-view");
  const mem = { ed: { top: 0, left: 0, s: 0, e: 0 }, con: null };
  const isAnvilState = () => !!(history.state && history.state.pyforge === "anvil");
  if (isAnvilState()) {   // a reload always starts on THE FORGE without discarding unrelated router state
    const state = { ...history.state }; delete state.pyforge;
    history.replaceState(Object.keys(state).length ? state : null, "");
  }

  const atBottom = () => con.scrollHeight - con.clientHeight - con.scrollTop < 4;

  function enter(fresh, fromHistory) {
    if (!mq.matches || inAnvil()) return;
    mem.ed = { top: ed.scrollTop, left: ed.scrollLeft, s: ed.selectionStart, e: ed.selectionEnd };
    ed.blur();
    if (body.classList.contains("v-on")) $("vclose").click();   // close the Code Vault drawer
    body.classList.add("anvil-view");
    window.scrollTo(0, 0);
    con.scrollTop = fresh || !mem.con || mem.con.bottom ? con.scrollHeight : mem.con.top;
    if (!fromHistory && !isAnvilState()) history.pushState({ ...(history.state || {}), pyforge: "anvil" }, "");   // so the iOS back-swipe returns to THE FORGE
    requestAnimationFrame(() => { const i = con.querySelector(".stdin"); (i || $("back")).focus({ preventScroll: true }); });
  }
  function leave() {
    if (!inAnvil()) return;
    mem.con = { top: con.scrollTop, bottom: atBottom() };
    const i = con.querySelector(".stdin"); if (i) i.blur();
    body.classList.remove("anvil-view");
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {   // hidden elements forget their scroll position; put it back
      ed.scrollTop = mem.ed.top; ed.scrollLeft = mem.ed.left;
      try { ed.setSelectionRange(mem.ed.s, mem.ed.e); } catch (_) {}
      ed.focus({ preventScroll: true });
    });
  }
  const back = () => (isAnvilState() ? history.back() : leave());

  $("run").addEventListener("click", () => enter(true));   // a click only fires when FORGE CODE was enabled
  $("toanvil").addEventListener("click", () => enter(false));
  $("back").addEventListener("click", back);
  addEventListener("popstate", () => { if (isAnvilState()) enter(false, true); else leave(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && inAnvil() && !document.querySelector(".mback")) back(); });
  mq.addEventListener("change", (e) => { if (!e.matches) leave(); });

  // An input() prompt appears in the console: make it easy to type, and bring the user to it if they are on THE FORGE.
  const toAnvil = $("toanvil");
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.classList && n.classList.contains("stdin")) {
        n.placeholder = "tap to type…"; n.enterKeyHint = "send";
        if (mq.matches && !inAnvil()) enter(false);
      }
    }
    toAnvil.classList.toggle("attn", !!con.querySelector(".stdin") && !inAnvil());
  }).observe(con, { childList: true });
  new MutationObserver(() => toAnvil.classList.toggle("attn", !!con.querySelector(".stdin") && !inAnvil())).observe(body, { attributes: true, attributeFilter: ["class"] });

  // mirror the Forge status into the Anvil title bar
  const st = $("status"), as = $("astatus"), led = $("led");
  const sync = () => { as.textContent = st.textContent; as.dataset.state = led.dataset.state; };
  new MutationObserver(sync).observe(st, { childList: true, characterData: true, subtree: true }); sync();
})();

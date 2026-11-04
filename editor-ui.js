/* Visual layer only: syntax colors, line numbers, status LED. Does not touch the Python engine. */
(() => {
  const $ = (id) => document.getElementById(id);
  const ta = $("editor"), hlPre = $("hl"), hl = hlPre.querySelector("code"), gut = $("gutter");
  const KW = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
  const BI = new Set("print input int float str len range list dict set tuple bool abs min max sum sorted enumerate zip map filter round type isinstance open".split(" "));
  const RE = /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|[rbfuRBFU]{0,2}"(?:\\.|[^"\\\n])*"?|[rbfuRBFU]{0,2}'(?:\\.|[^'\\\n])*'?)|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/g;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function highlight(src) {
    let out = "", prev = "", m;
    RE.lastIndex = 0;
    while ((m = RE.exec(src))) {
      if (m[1]) out += '<i class="c">' + esc(m[1]) + "</i>";
      else if (m[2]) out += '<i class="s">' + esc(m[2]) + "</i>";
      else if (m[3]) out += '<i class="n">' + m[3] + "</i>";
      else if (m[4]) {
        const w = m[4];
        let c = "";
        if (KW.has(w)) c = "k";
        else if (prev === "def" || prev === "class") c = "d";
        else if (BI.has(w)) c = "b";
        else if (src[RE.lastIndex] === "(") c = "f";
        out += c ? '<i class="' + c + '">' + w + "</i>" : w;
        prev = w;
      } else {
        out += esc(m[5]);
        if (!/\s/.test(m[5])) prev = "";
      }
    }
    return out;
  }

  let lines = 0;
  function sync() {
    const v = ta.value;
    hl.innerHTML = highlight(v) + "\n ";
    const n = v.split("\n").length;
    if (n !== lines) {
      lines = n;
      gut.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
    }
    scroll();
  }
  function scroll() {
    hlPre.scrollTop = gut.scrollTop = ta.scrollTop;
    hlPre.scrollLeft = ta.scrollLeft;
  }

  ta.addEventListener("input", sync);
  ta.addEventListener("scroll", scroll);
  ta.addEventListener("keydown", () => requestAnimationFrame(sync)); // catches the Tab key, which edits without an input event
  sync();

  // Mirror the text app.js writes into #status onto the glowing LED.
  const st = $("status"), led = $("led");
  new MutationObserver(() => {
    const t = st.textContent;
    led.dataset.state = t === "🔥 Forge Ready" ? "ready" : t === "⚒️ Forging Code…" ? "running" : "loading";
  }).observe(st, { childList: true, characterData: true, subtree: true });
})();

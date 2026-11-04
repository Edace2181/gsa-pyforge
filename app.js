const $ = (id) => document.getElementById(id);
const editor = $("editor"), con = $("console"), runBtn = $("run"), stopBtn = $("stop"), clearBtn = $("clear"), status = $("status");
let worker, ctrl, buf;

function print(text, cls) {
  const s = document.createElement("span");
  if (cls) s.className = cls;
  s.textContent = text;
  con.appendChild(s);
  con.scrollTop = con.scrollHeight;
}

function setState(state) {
  runBtn.disabled = state !== "idle";
  stopBtn.disabled = state === "loading";
  status.textContent = { loading: "🔥 Lighting the Forge…", idle: "🔥 Forge Ready", running: "⚒️ Forging Code…" }[state];
}

function askInput(prompt) {
  print(prompt);
  const inp = document.createElement("input");
  inp.className = "stdin";
  inp.autocomplete = "off"; inp.autocapitalize = "off"; inp.spellcheck = false;
  inp.setAttribute("aria-label", "Program input");
  con.appendChild(inp);
  inp.focus();
  inp.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const bytes = new TextEncoder().encode(inp.value).slice(0, buf.length);
    const echo = document.createElement("span");
    echo.textContent = inp.value + "\n";
    inp.replaceWith(echo);
    buf.set(bytes);
    Atomics.store(ctrl, 1, bytes.length);
    Atomics.store(ctrl, 0, 1);
    Atomics.notify(ctrl, 0);
  });
}

function startWorker() {
  if (!self.crossOriginIsolated) {
    print("Setting up the Python console. If this message stays, reload the page once.\n", "err");
    return;
  }
  ctrl = new Int32Array(new SharedArrayBuffer(8));
  buf = new Uint8Array(new SharedArrayBuffer(65536));
  worker = new Worker("pyodide-worker.js");
  setState("loading");
  worker.onmessage = ({ data: m }) => {
    if (m.t === "out") print(m.s);
    else if (m.t === "err") print(m.s.endsWith("\n") ? m.s : m.s + "\n", "err");
    else if (m.t === "input") askInput(m.s);
    else if (m.t === "ready" || m.t === "done") setState("idle");
  };
  worker.postMessage({ t: "init", ctrl: ctrl.buffer, buf: buf.buffer });
}

runBtn.onclick = () => {
  con.textContent = "";
  setState("running");
  worker.postMessage({ t: "run", code: editor.value });
};
stopBtn.onclick = () => {
  worker.terminate();
  print("\n[Stopped]\n", "err");
  startWorker();
};
clearBtn.onclick = () => {
  // Clear THE FORGE (Python editor)
  editor.value = "";

  // Clear THE ANVIL (output console)
  con.textContent = "";

  // Refresh syntax highlighting and line numbers
  editor.dispatchEvent(new Event("input", { bubbles: true }));

  // Place the cursor back in THE FORGE
  editor.focus();
};
con.addEventListener("click", () => { const i = con.querySelector(".stdin"); if (i) i.focus(); });
editor.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  e.preventDefault();
  const { selectionStart: a, selectionEnd: b } = editor;
  editor.setRangeText("    ", a, b, "end");
});

editor.value = 'name = input("What is your name? ")\nprint("Hello,", name)\n';
startWorker();

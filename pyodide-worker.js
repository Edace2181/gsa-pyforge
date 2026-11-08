importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js");

let py, ctrl, buf;

// Called from Python. Blocks THIS worker (not the page) until the page answers.
self.pyInput = (prompt) => {
  Atomics.store(ctrl, 0, 0);
  postMessage({ t: "input", s: prompt });
  Atomics.wait(ctrl, 0, 0);
  const n = Atomics.load(ctrl, 1);
  return new TextDecoder().decode(buf.slice(0, n));
};
self.pyWrite = (kind, s) => postMessage({ t: kind, s });

const SETUP = `
import sys, builtins, js
class _W:
    def __init__(self, k): self.k = k
    def write(self, s):
        js.pyWrite(self.k, s)
        return len(s)
    def flush(self): pass
sys.stdout = _W("out")
sys.stderr = _W("err")
builtins.input = lambda prompt="": js.pyInput(str(prompt))
`;

onmessage = async ({ data: m }) => {
  if (m.t === "init") {
    ctrl = new Int32Array(m.ctrl);
    buf = new Uint8Array(m.buf);
    try {
      py = await loadPyodide();
      py.runPython(SETUP);
      postMessage({ t: "ready" });
    } catch (e) {
      postMessage({ t: "fatal", s: String(e && e.message ? e.message : e) });
    }
  } else if (m.t === "run") {
    const g = py.globals.get("dict")();
    g.set("__name__", "__main__");
    try {
      py.runPython(m.code, { globals: g });
    } catch (e) {
      let msg = String(e.message);
      const i = msg.indexOf('  File "<exec>"');
      if (i >= 0) msg = "Traceback (most recent call last):\n" + msg.slice(i);
      postMessage({ t: "err", s: msg });
    } finally {
      g.destroy();
      postMessage({ t: "done" });
    }
  }
};

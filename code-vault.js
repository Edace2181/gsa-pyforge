/* 📁 CODE VAULT: file manager for GSA PyForge. Separate from Python execution: nothing here ever calls the worker. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const ed = $("editor"), tabsEl = $("tabs"), treeEl = $("tree"), tagEl = $("filetag"), stateEl = $("savestate");
  // Prevent edits made while IndexedDB is opening from being replaced by session restoration.
  ed.readOnly = true; ed.setAttribute("aria-busy", "true");
  const LIM = { file: 1048576, total: 20971520, archive: 26214400, entries: 2000 };
  const S = { nodes: new Map(), tabs: [], active: null, open: new Set(), cur: null, mem: false, loading: false, drafts: new Map(), persisted: false };
  const now = () => Date.now();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "n" + now().toString(36) + Math.random().toString(36).slice(2, 10));
  const mobile = () => matchMedia("(max-width: 760px)").matches;
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const kids = (pid) => [...S.nodes.values()].filter((n) => n.parentId === pid).sort((a, b) => (a.type === b.type ? byName(a, b) : a.type === "folder" ? -1 : 1));
  const tab = (id) => S.tabs.find((t) => t.id === id);
  const curTab = () => tab(S.active);
  const dirty = (t) => t.text !== t.saved;
  const descendants = (id) => { const out = []; (function w(p) { for (const k of kids(p)) { out.push(k); if (k.type === "folder") w(k.id); } })(id); return out; };
  const pathOf = (id) => { const p = []; let n = S.nodes.get(id); while (n) { p.unshift(n.name); n = S.nodes.get(n.parentId); } return p.join("/"); };
  const fileName = (raw) => { const n = raw.trim(); return /\.py$/i.test(n) ? n : n + ".py"; };
  const taken = (pid, name, except) => kids(pid || null).some((n) => n.id !== except && n.name.toLowerCase() === name.toLowerCase());
  const folderOk = (id) => (id && S.nodes.get(id) && S.nodes.get(id).type === "folder" ? id : null);

  function nameError(name, type) {
    if (!name) return "Enter a name.";
    if (name.length > 100) return "Use 100 characters or fewer.";
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return 'Names cannot contain \\ / : * ? " < > |';
    if (/^\.+$/.test(name) || (type === "file" && name.length <= 3)) return "Choose a different name.";
    return "";
  }
  function uniqueName(pid, name, isFile) {
    if (!taken(pid, name)) return name;
    const stem = isFile ? name.slice(0, -3) : name, ext = isFile ? name.slice(-3) : "";
    for (let i = 2; ; i++) { const c = stem + " (" + i + ")" + ext; if (!taken(pid, c)) return c; }
  }
  function nextUntitled() {
    const used = new Set([...S.nodes.values()].map((n) => n.name.toLowerCase()));
    let i = 1; while (used.has("untitled_" + i + ".py")) i++;
    return "Untitled_" + i + ".py";
  }

  /* ---------- small UI helpers: toast + themed dialog (no browser popups) ---------- */
  let tt;
  function toast(msg, bad) {
    const el = $("toast"); el.textContent = msg; el.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(tt); tt = setTimeout(() => (el.className = "toast"), bad ? 7000 : 3200);
  }
  function dlg(o) {
    return new Promise((resolve) => {
      const back = document.createElement("div"); back.className = "mback";
      const box = document.createElement("div"); box.className = "modal"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      const h = document.createElement("h3"); h.textContent = o.title; box.append(h);
      if (o.body) { const p = document.createElement("p"); p.textContent = o.body; box.append(p); }
      let inp, sel;
      if (o.input !== undefined) {
        inp = document.createElement("input"); inp.value = o.input; inp.autocomplete = "off"; inp.autocapitalize = "off"; inp.spellcheck = false;
        inp.setAttribute("aria-label", o.title); box.append(inp);
      }
      if (o.options) {
        sel = document.createElement("select"); sel.setAttribute("aria-label", o.selLabel || "Folder");
        o.options.forEach(([v, l]) => { const op = document.createElement("option"); op.value = v; op.textContent = l; sel.append(op); });
        if (o.sel !== undefined) sel.value = o.sel; box.append(sel);
      }
      const err = document.createElement("div"); err.className = "merr"; err.setAttribute("role", "alert"); box.append(err);
      const row = document.createElement("div"); row.className = "mrow"; box.append(row);
      const prev = document.activeElement;
      const done = (btn) => {
        document.removeEventListener("keydown", onKey, true); back.remove();
        if (prev && prev !== ed && prev.focus) prev.focus();
        resolve({ btn, value: inp ? inp.value : "", sel: sel ? sel.value : null });
      };
      const submit = (btn) => {
        if (btn === "ok" && o.validate) { const e = o.validate(inp ? inp.value : "", sel ? sel.value : null); if (e) { err.textContent = e; return; } }
        done(btn);
      };
      const mk = (label, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "vbtn " + cls; b.textContent = label; b.onclick = fn; row.append(b); return b; };
      mk(o.cancel || "CANCEL", "", () => done(null));
      if (o.extra) mk(o.extra, o.extraDanger ? "danger" : "", () => submit("extra"));
      const ok = mk(o.ok || "OK", o.danger ? "danger" : "go", () => submit("ok"));
      const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); done(null); }
        else if (e.key === "Enter" && e.target === inp) { e.preventDefault(); submit("ok"); }
      };
      document.addEventListener("keydown", onKey, true);
      back.addEventListener("mousedown", (e) => { if (e.target === back) done(null); });
      if (sel) sel.onchange = () => (err.textContent = "");
      if (inp) inp.oninput = () => (err.textContent = "");
      back.append(box); document.body.append(back);
      if (inp) { inp.focus(); inp.select(); } else ok.focus();
    });
  }

  /* ---------- persistence ---------- */
  async function persist(fn) {
    if (S.mem) return true;
    try { await fn(); return true; }
    catch (e) {
      const why = e && e.name === "QuotaExceededError" ? "storage is full" : (e && e.message) || "storage error";
      toast("⚠ Couldn't save to this browser (" + why + "). Your code is still in the editor. Use EXPORT to keep a copy.", true);
      return false;
    }
  }
  let st; const saveSession = () => { clearTimeout(st); st = setTimeout(sess, 250); };
  async function sess() {
    if (S.mem) return;
    try { await VaultDB.setMeta("session", { open: S.tabs.map((t) => t.id), active: S.active, expanded: [...S.open], cur: S.cur, sidebar: document.body.classList.contains("v-on") }); } catch (_) {}
  }
  let dt, draftWarned = false; const draftSoon = () => { clearTimeout(dt); dt = setTimeout(flushDrafts, 300); };
  async function flushDrafts() {
    if (S.mem) return;
    for (const t of S.tabs) {
      try {
        if (dirty(t)) { if (t.dsaved !== t.text) { await VaultDB.putDraft(t.id, t.text); t.dsaved = t.text; } }
        else if (t.dsaved !== undefined) { await VaultDB.delDraft(t.id); t.dsaved = undefined; }
      } catch (_) { if (!draftWarned) { draftWarned = true; toast("⚠ Couldn't store a recovery draft. Press SAVE to keep your work.", true); } }
    }
  }

  /* ---------- rendering ---------- */
  function render() {
    treeEl.replaceChildren();
    if (!S.nodes.size) { const p = document.createElement("p"); p.className = "vempty"; p.textContent = "Your vault is empty. Press ➕ NEW PROGRAM to start."; treeEl.append(p); }
    const walk = (pid, depth) => {
      for (const n of kids(pid)) {
        const row = document.createElement("div"); row.className = "row" + (n.id === S.active ? " on" : "") + (n.type === "folder" && n.id === S.cur ? " cur" : "");
        row.style.setProperty("--d", depth); row.setAttribute("role", "treeitem");
        const main = document.createElement("button"); main.type = "button"; main.className = "rmain";
        const ic = document.createElement("span"); ic.className = "ic";
        if (n.type === "folder") { const o = S.open.has(n.id); ic.textContent = o ? "▾ 📂" : "▸ 📁"; row.setAttribute("aria-expanded", String(o)); } else ic.textContent = "🐍";
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = n.name; main.append(ic, nm);
        if (n.id === S.active) main.setAttribute("aria-current", "true");
        const t = n.type === "file" && tab(n.id);
        if (t && dirty(t)) { const d = document.createElement("span"); d.className = "dot"; d.textContent = "●"; d.title = "Unsaved changes"; main.append(d); }
        main.onclick = () => (n.type === "folder" ? toggle(n.id) : openFile(n.id, true));
        const k = document.createElement("button"); k.type = "button"; k.className = "kebab"; k.textContent = "⋯"; k.setAttribute("aria-label", "Actions for " + n.name);
        k.onclick = (e) => { e.stopPropagation(); showMenu(n, k); };
        row.append(main, k); treeEl.append(row);
        if (n.type === "folder" && S.open.has(n.id)) walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
  }
  function renderTabs() {
    tabsEl.replaceChildren();
    for (const t of S.tabs) {
      const n = S.nodes.get(t.id); if (!n) continue;
      const el = document.createElement("div"); el.className = "tab" + (t.id === S.active ? " on" : ""); el.setAttribute("role", "tab"); el.setAttribute("aria-selected", String(t.id === S.active));
      const b = document.createElement("button"); b.type = "button"; b.className = "tname"; b.textContent = n.name; b.title = pathOf(t.id); b.onclick = () => activate(t.id);
      el.append(b);
      if (dirty(t)) { const d = document.createElement("span"); d.className = "dot"; d.textContent = "●"; d.title = "Unsaved changes"; el.append(d); }
      const x = document.createElement("button"); x.type = "button"; x.className = "tx"; x.textContent = "×"; x.setAttribute("aria-label", "Close " + n.name + " (does not delete the file)"); x.onclick = () => closeTab(t.id);
      el.append(x); tabsEl.append(el);
      if (t.id === S.active) requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
    }
  }
  function refreshState() {
    const t = curTab(), d = !!t && dirty(t);
    if (t && t._d !== d) { t._d = d; renderTabs(); render(); }
    const n = t && S.nodes.get(t.id);
    stateEl.textContent = !t ? "" : d ? "● UNSAVED DRAFT" : "✓ SAVED " + new Date(n.modified).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    stateEl.className = "savestate " + (d ? "dirty" : "ok");
    stateEl.title = d ? "Edits are kept as a recovery draft in this browser. Press SAVE to store them in Code Vault." : "";
    tagEl.textContent = n ? n.name : "no file open";
    ["vsave", "vsaveas", "vrename", "vexport"].forEach((id) => ($(id).disabled = !t));
  }
  function setEditor(text) { S.loading = true; ed.value = text; ed.dispatchEvent(new Event("input", { bubbles: true })); S.loading = false; }

  /* ---------- tabs ---------- */
  function activate(id) {
    const t0 = curTab(); if (t0) t0.text = ed.value;
    S.active = id; const t = curTab();
    ed.readOnly = !t; ed.placeholder = t ? "" : "Open a program from CODE VAULT, or press NEW to start forging.";
    setEditor(t ? t.text : ""); ed.scrollTop = 0;
    if (t) { const n = S.nodes.get(id); S.cur = n.parentId; for (let p = S.nodes.get(n.parentId); p; p = S.nodes.get(p.parentId)) S.open.add(p.id); }
    renderTabs(); render(); refreshState(); saveSession();
  }
  function openFile(id, fromSidebar) {
    const n = S.nodes.get(id); if (!n || n.type !== "file") return;
    if (!tab(id)) { const dr = S.drafts.get(id); S.tabs.push({ id, text: dr !== undefined ? dr : n.content, saved: n.content }); S.drafts.delete(id); }
    activate(id);
    if (fromSidebar && mobile()) setVault(false);
  }
  async function closeTab(id, force) {
    const t = tab(id); if (!t) return true;
    if (id === S.active) t.text = ed.value;
    if (!force && dirty(t)) {
      const r = await dlg({ title: "⚠ Unsaved changes", body: "“" + S.nodes.get(id).name + "” has edits that are not saved to Code Vault. Closing the tab discards them. (Closing a tab never deletes the saved file.)", ok: "💾 SAVE & CLOSE", extra: "DISCARD", extraDanger: true });
      if (!r.btn) return false;
      if (r.btn === "ok" && !(await saveTab(t))) return false;
    }
    const i = S.tabs.indexOf(t); S.tabs.splice(i, 1);
    if (!S.mem) VaultDB.delDraft(id).catch(() => {});
    if (S.active === id) { const nx = S.tabs[i] || S.tabs[i - 1]; S.active = null; activate(nx ? nx.id : null); }
    else { renderTabs(); render(); saveSession(); }
    return true;
  }

  /* ---------- save / save as / rename / move / delete / create ---------- */
  async function saveTab(t) {
    const n = S.nodes.get(t.id); if (t.id === S.active) t.text = ed.value;
    const upd = { ...n, content: t.text, modified: now() };
    if (!(await persist(() => VaultDB.putNodes([upd])))) return false;
    S.nodes.set(n.id, upd); t.saved = t.text; t.dsaved = undefined;
    if (!S.mem) VaultDB.delDraft(n.id).catch(() => {});
    t._d = undefined; render(); renderTabs(); refreshState(); return true;
  }
  async function saveActive() {
    const t = curTab(); if (!t) return;
    if (await saveTab(t)) toast(S.mem ? "Saved for this session only (browser storage is unavailable)." : "💾 Saved " + S.nodes.get(t.id).name);
  }
  function folderOptions(excludeId) {
    const out = [["", "📁 Top level"]], ex = new Set(excludeId ? [excludeId, ...descendants(excludeId).map((d) => d.id)] : []);
    (function w(p, d) { for (const k of kids(p)) if (k.type === "folder" && !ex.has(k.id)) { out.push([k.id, "\u00a0\u00a0".repeat(d) + "📁 " + k.name]); w(k.id, d + 1); } })(null, 0);
    return out;
  }
  async function saveAs() {
    const t = curTab(); if (!t) return; const n = S.nodes.get(t.id);
    const r = await dlg({
      title: "💾 Save As", body: "Creates a new copy. The original keeps its last saved version.", input: uniqueName(n.parentId, n.name.slice(0, -3) + "_copy.py", true),
      options: folderOptions(), sel: n.parentId || "", selLabel: "Save in folder", ok: "💾 SAVE",
      validate: (v, s) => { const nm = fileName(v); return nameError(nm, "file") || (taken(s || null, nm) ? "A file with that name already exists in that folder." : ""); },
    });
    if (!r.btn) return;
    const text = ed.value, nn = { id: uid(), type: "file", name: fileName(r.value), parentId: r.sel || null, content: text, created: now(), modified: now() };
    if (!(await persist(() => VaultDB.putNodes([nn])))) return;
    const oldId = t.id; S.nodes.set(nn.id, nn); t.id = nn.id; t.text = text; t.saved = text; t.dsaved = undefined; S.active = nn.id;
    if (!S.mem) VaultDB.delDraft(oldId).catch(() => {});
    if (nn.parentId) S.open.add(nn.parentId); S.cur = nn.parentId; t._d = undefined;
    render(); renderTabs(); refreshState(); saveSession(); toast("💾 Saved a copy as " + nn.name);
  }
  async function rename(id) {
    const n = S.nodes.get(id), isF = n.type === "file";
    const r = await dlg({
      title: "✏️ Rename " + (isF ? "program" : "folder"), input: n.name, ok: "RENAME",
      validate: (v) => { const nm = isF ? fileName(v) : v.trim(); return nameError(nm, n.type) || (taken(n.parentId, nm, id) ? "That name is already used in this folder." : ""); },
    });
    if (!r.btn) return;
    const nm = isF ? fileName(r.value) : r.value.trim(); if (nm === n.name) return;
    const u = { ...n, name: nm, modified: now() };   // open tabs follow the internal id, so unsaved edits are never lost by a rename
    if (!(await persist(() => VaultDB.putNodes([u])))) return;
    S.nodes.set(id, u); render(); renderTabs(); refreshState();
  }
  async function move(id) {
    const n = S.nodes.get(id);
    const r = await dlg({
      title: "📂 Move “" + n.name + "”", options: folderOptions(n.type === "folder" ? id : null), sel: n.parentId || "", selLabel: "Move to folder", ok: "MOVE",
      validate: (_, s) => ((s || null) === n.parentId ? "It is already in that folder." : taken(s || null, n.name) ? "An item with that name already exists there." : ""),
    });
    if (!r.btn) return;
    const u = { ...n, parentId: r.sel || null, modified: now() };
    if (!(await persist(() => VaultDB.putNodes([u])))) return;
    S.nodes.set(id, u); if (u.parentId) S.open.add(u.parentId); render(); renderTabs(); refreshState(); saveSession();
  }
  async function remove(id) {
    const n = S.nodes.get(id); let victims = [n], msg = "";
    if (n.type === "folder") {
      const d = descendants(id), files = d.filter((x) => x.type === "file").length, subs = d.length - files; victims = [n, ...d];
      if (d.length) msg = "The folder “" + n.name + "” contains " + files + " file" + (files === 1 ? "" : "s") + " and " + subs + " subfolder" + (subs === 1 ? "" : "s") + ". Deleting it permanently removes everything inside it from Code Vault.";
    } else msg = "Delete “" + n.name + "” from Code Vault? This can't be undone.";
    const lost = victims.filter((v) => v.type === "file").map((v) => tab(v.id)).filter((t) => t && dirty(t)).length;
    if (lost && msg) msg += " " + lost + " open tab" + (lost === 1 ? "" : "s") + " with unsaved edits will be lost too.";
    if (msg) { const r = await dlg({ title: "🗑 Delete?", body: msg, ok: "DELETE", danger: true }); if (!r.btn) return; }
    const ids = victims.map((v) => v.id);
    if (!(await persist(() => VaultDB.deleteNodes(ids)))) return;
    ids.forEach((i) => { S.nodes.delete(i); S.open.delete(i); });
    if (S.cur && !S.nodes.has(S.cur)) S.cur = null;
    for (const i of ids) if (tab(i)) await closeTab(i, true);
    render(); saveSession(); toast("🗑 Deleted " + n.name);
  }
  async function newProgram(pid) {
    pid = folderOk(pid === undefined ? S.cur : pid);
    const n = { id: uid(), type: "file", name: nextUntitled(), parentId: pid, content: "", created: now(), modified: now() };
    if (!(await persist(() => VaultDB.putNodes([n])))) return;
    S.nodes.set(n.id, n); if (pid) S.open.add(pid);
    openFile(n.id); if (mobile()) setVault(false); else ed.focus();
  }
  async function newFolder(pid) {
    pid = folderOk(pid === undefined ? S.cur : pid);
    const r = await dlg({ title: "📁 New folder", input: uniqueName(pid, "New Folder", false), ok: "CREATE", validate: (v) => nameError(v.trim(), "folder") || (taken(pid, v.trim()) ? "That name is already used here." : "") });
    if (!r.btn) return;
    const n = { id: uid(), type: "folder", name: r.value.trim(), parentId: pid, created: now(), modified: now() };
    if (!(await persist(() => VaultDB.putNodes([n])))) return;
    S.nodes.set(n.id, n); if (pid) S.open.add(pid); S.open.add(n.id); S.cur = n.id; render(); saveSession();
  }
  function toggle(id) { S.open.has(id) ? S.open.delete(id) : S.open.add(id); S.cur = id; render(); saveSession(); }

  /* ---------- import / export ---------- */
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const stamp = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  function exportPy() { const t = curTab(); if (!t) return; download(new Blob([ed.value], { type: "text/x-python;charset=utf-8" }), S.nodes.get(t.id).name); toast("📤 Exported " + S.nodes.get(t.id).name); }
  function exportVault() {
    if (!S.nodes.size) return toast("Nothing to export yet.", true);
    const enc = new TextEncoder(), entries = [];
    (function w(p) { for (const k of kids(p)) { const path = pathOf(k.id); if (k.type === "folder") { entries.push({ path: path + "/", data: null }); w(k.id); } else entries.push({ path, data: enc.encode(k.content) }); } })(null);
    download(ZipLite.build(entries), "GSA-PyForge-Vault-" + stamp() + ".zip");
    const nd = S.tabs.filter(dirty).length;
    toast("📦 Vault exported." + (nd ? " " + nd + " tab" + (nd === 1 ? " has" : "s have") + " unsaved edits, which are not included." : ""));
  }
  const decodeText = (u8, label) => {
    let s; try { s = new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (_) { throw new Error(label + " is not valid UTF-8 text"); }
    if (s.includes("\u0000")) throw new Error(label + " does not look like a text file");
    return s.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");   // the editor stores LF; Python treats CRLF and LF the same
  };
  async function importPy(f) {
    if (!/\.py$/i.test(f.name)) return toast("⚠ Only .py files can be imported here.", true);
    if (f.size > LIM.file) return toast("⚠ That file is larger than 1 MB.", true);
    let text; try { text = decodeText(new Uint8Array(await f.arrayBuffer()), "That file"); } catch (e) { return toast("⚠ " + e.message + ".", true); }
    let name = f.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_"); if (name.length > 100) name = name.slice(0, 97) + ".py";
    if (nameError(name, "file")) name = "Imported.py";
    const pid = folderOk(S.cur);
    if (taken(pid, name)) {
      const r = await dlg({ title: "📥 Name already used", body: "“" + name + "” already exists here. Nothing will be overwritten. Import it as “" + uniqueName(pid, name, true) + "” instead?", ok: "KEEP BOTH" });
      if (!r.btn) return; name = uniqueName(pid, name, true);
    }
    const n = { id: uid(), type: "file", name, parentId: pid, content: text, created: now(), modified: now() };
    if (!(await persist(() => VaultDB.putNodes([n])))) return;
    S.nodes.set(n.id, n); if (pid) S.open.add(pid); openFile(n.id); toast("📥 Imported " + name + ". It has not been run.");
  }
  async function planZip(buf) {
    const entries = ZipLite.list(buf, LIM), folders = new Set(), files = []; let skipped = 0, total = 0;
    for (const e of entries) {
      if (e.path.startsWith("__MACOSX/")) { skipped++; continue; }
      const segs = ZipLite.safePath(e.path);
      for (const s of segs) if (nameError(s, "folder")) throw new Error('"' + s.slice(0, 40) + '" is not a valid name');
      if (e.dir) { for (let i = 1; i <= segs.length; i++) folders.add(segs.slice(0, i).join("/")); continue; }
      if (!/\.py$/i.test(e.path)) { skipped++; continue; }
      total += e.usize; if (total > LIM.total) throw new Error("the archive's contents are too large");
      for (let i = 1; i < segs.length; i++) folders.add(segs.slice(0, i).join("/"));
      files.push({ segs, text: decodeText(await ZipLite.extract(buf, e, LIM), '"' + segs[segs.length - 1].slice(0, 40) + '"') });
    }
    if (!files.length && !folders.size) throw new Error("it contains no Python files");
    return { folders, files, skipped };
  }
  async function importZip(f) {
    let plan; try { plan = await planZip(await f.arrayBuffer()); } catch (e) { return toast("⚠ Archive rejected: " + e.message + ".", true); }
    const r = await dlg({
      title: "📦 Import Code Vault", body: "Found " + plan.files.length + " Python file" + (plan.files.length === 1 ? "" : "s") + " in " + plan.folders.size + " folder" + (plan.folders.size === 1 ? "" : "s") + (plan.skipped ? " (" + plan.skipped + " non-Python entr" + (plan.skipped === 1 ? "y" : "ies") + " skipped)" : "") +
        ". Nothing is run or overwritten: names that already exist get “(2)” added.",
      ok: "INTO NEW FOLDER", extra: "TOP LEVEL",
    });
    if (!r.btn) return;
    const made = [], put = (n) => { S.nodes.set(n.id, n); made.push(n); return n; }; let renamed = 0;
    let base = null;
    if (r.btn === "ok") base = put({ id: uid(), type: "folder", name: uniqueName(null, "Imported " + stamp(), false), parentId: null, created: now(), modified: now() }).id;
    const ensure = (parent, seg) => {
      const hit = kids(parent).find((k) => k.type === "folder" && k.name.toLowerCase() === seg.toLowerCase());
      return hit ? hit.id : put({ id: uid(), type: "folder", name: uniqueName(parent, seg, false), parentId: parent, created: now(), modified: now() }).id;
    };
    for (const p of [...plan.folders].sort()) { let par = base; for (const s of p.split("/")) par = ensure(par, s); }
    for (const fl of plan.files) {
      let par = base; for (const s of fl.segs.slice(0, -1)) par = ensure(par, s);
      const want = fl.segs[fl.segs.length - 1], name = uniqueName(par, want, true); if (name !== want) renamed++;
      put({ id: uid(), type: "file", name, parentId: par, content: fl.text, created: now(), modified: now() });
    }
    if (!(await persist(() => VaultDB.putNodes(made)))) { made.forEach((n) => S.nodes.delete(n.id)); return; }
    if (base) S.open.add(base); render(); saveSession();
    toast("📦 Imported " + plan.files.length + " file" + (plan.files.length === 1 ? "" : "s") + (renamed ? " (" + renamed + " renamed to avoid overwriting)" : "") + ". None were run.");
  }

  /* ---------- row menu + drawer ---------- */
  function showMenu(n, anchor) {
    const m = $("menu"); m.replaceChildren();
    const items = n.type === "folder" ? [["➕ New program here", () => newProgram(n.id)], ["📁 New folder here", () => newFolder(n.id)]] : [];
    items.push(["✏️ Rename", () => rename(n.id)], ["📂 Move to…", () => move(n.id)], ["🗑 Delete", () => remove(n.id), true]);
    for (const [label, fn, danger] of items) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; if (danger) b.className = "danger"; b.onclick = () => { m.hidden = true; fn(); }; m.append(b); }
    m.hidden = false; const r = anchor.getBoundingClientRect();
    m.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8)) + "px";
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
    m.firstChild.focus();
  }
  function setVault(on) { document.body.classList.toggle("v-on", on); $("vtoggle").setAttribute("aria-expanded", String(on)); saveSession(); }
  function updateNote() {
    $("vnote").textContent = "Saved in this browser only. EXPORT to back up or move devices; localhost and your published site keep separate vaults. " + (S.persisted ? "Persistent storage granted." : "The browser may clear storage if the device runs low on space.");
  }

  /* ---------- wiring ---------- */
  function onEdit() { if (S.loading) return; const t = curTab(); if (t && t.text !== ed.value) { t.text = ed.value; refreshState(); draftSoon(); } }
  ed.addEventListener("input", onEdit);
  ed.addEventListener("keydown", () => requestAnimationFrame(onEdit));   // Tab key edits without an input event
  $("vtoggle").onclick = () => setVault(!document.body.classList.contains("v-on"));
  $("vclose").onclick = () => setVault(false); $("vback").onclick = () => setVault(false);
  $("vnewprog").onclick = () => newProgram(); $("vnew").onclick = () => newProgram(); $("vnewfolder").onclick = () => newFolder();
  $("vsave").onclick = saveActive; $("vsaveas").onclick = saveAs; $("vrename").onclick = () => curTab() && rename(S.active);
  $("vexport").onclick = exportPy; $("vexpzip").onclick = exportVault;
  $("vimport").onclick = () => $("pyfile").click(); $("vimpzip").onclick = () => $("zipfile").click();
  $("pyfile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importPy(f); };
  $("zipfile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importZip(f); };
  document.addEventListener("click", (e) => { if (!e.target.closest("#menu, .kebab")) $("menu").hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $("menu").hidden = true; if (mobile() && document.body.classList.contains("v-on") && !document.querySelector(".mback")) setVault(false); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveActive(); }
  });
  addEventListener("beforeunload", (e) => { const t = curTab(); if (t) t.text = ed.value; if (S.tabs.some(dirty)) { flushDrafts(); e.preventDefault(); e.returnValue = ""; } });
  addEventListener("pagehide", () => flushDrafts());
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushDrafts(); });
  if (window.visualViewport) {   // keep the layout above the on-screen keyboard (iOS)
    const fit = () => { if (visualViewport.scale <= 1.01) { document.documentElement.style.setProperty("--vvh", visualViewport.height + "px"); window.scrollTo(0, 0); } };
    visualViewport.addEventListener("resize", fit); fit();
  }

  async function init() {
    const warn = (msg) => { S.mem = true; const w = $("vwarn"); w.hidden = false; w.textContent = "⚠ " + msg + " You can still code and use EXPORT, but nothing will be remembered after you close this page."; };
    let sessData = null;
    try { await VaultDB.open(); } catch (e) { warn("Browser storage is unavailable (" + e.message + ")"); }
    if (!S.mem) {
      try {
        for (const n of await VaultDB.all()) S.nodes.set(n.id, n);
        for (const d of await VaultDB.drafts()) S.drafts.set(d.id, d.text);
        sessData = await VaultDB.getMeta("session");
      } catch (e) { warn("Couldn't read saved programs (" + e.message + ")"); }
    }
    if (sessData && sessData.expanded) sessData.expanded.forEach((id) => S.nodes.has(id) && S.open.add(id));
    S.cur = folderOk(sessData && sessData.cur);
    if (!S.nodes.size && !sessData) {   // first launch: keep the starter program from app.js as Untitled_1.py
      const n = { id: uid(), type: "file", name: "Untitled_1.py", parentId: null, content: ed.value, created: now(), modified: now() };
      if (await persist(() => VaultDB.putNodes([n]))) { S.nodes.set(n.id, n); S.tabs.push({ id: n.id, text: n.content, saved: n.content }); S.active = n.id; }
    }
    let recovered = 0;
    const want = new Set([...(sessData ? sessData.open : []), ...S.drafts.keys()]);
    for (const id of want) {
      const n = S.nodes.get(id); if (!n || n.type !== "file" || tab(id)) continue;
      const dr = S.drafts.get(id); S.drafts.delete(id);
      if (dr !== undefined && dr !== n.content) { recovered++; S.tabs.push({ id, text: dr, saved: n.content, dsaved: dr }); }
      else { if (dr !== undefined && !S.mem) VaultDB.delDraft(id).catch(() => {}); S.tabs.push({ id, text: n.content, saved: n.content }); }
    }
    const first = S.tabs.some((t) => t.id === S.active) ? S.active : S.tabs.some((t) => sessData && t.id === sessData.active) ? sessData.active : S.tabs.length ? S.tabs[0].id : null;
    S.active = null; activate(first);
    setVault(sessData ? !!sessData.sidebar && !mobile() : !mobile());
    updateNote(); VaultDB.persist().then((ok) => { S.persisted = ok; updateNote(); });
    if (recovered) toast("Recovered unsaved edits in " + recovered + " program" + (recovered === 1 ? "" : "s") + ". They are drafts until you press SAVE.");
    document.body.classList.add("vault-ready");
    ed.removeAttribute("aria-busy");
  }
  init();
})();

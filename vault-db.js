/* Code Vault storage layer: IndexedDB only. No network, no accounts.
   Database "gsa-pyforge-vault" v1, three object stores (see README-CODE-VAULT.md):
     nodes  {id, type:"file"|"folder", name, parentId|null, content (files), created, modified}
     drafts {id, text, ts}            recovery copies of unsaved edits, keyed by file id
     meta   {key, value}              session info (open tabs, expanded folders, sidebar state)  */
window.VaultDB = (() => {
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("IndexedDB is not available in this browser."));
      let req;
      try { req = indexedDB.open("gsa-pyforge-vault", 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("nodes", { keyPath: "id" });
        d.createObjectStore("drafts", { keyPath: "id" });
        d.createObjectStore("meta", { keyPath: "key" });
      };
      req.onsuccess = () => { db = req.result; resolve(); };
      req.onerror = () => reject(req.error || new Error("Could not open browser storage."));
      req.onblocked = () => reject(new Error("Browser storage is blocked by another open tab."));
    });
  }

  // Runs `work` inside one transaction; resolves when the transaction has fully committed.
  function run(stores, mode, work) {
    return new Promise((resolve, reject) => {
      let tx, out;
      try { tx = db.transaction(stores, mode); } catch (e) { return reject(e); }
      tx.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error("Storage transaction failed."));
      try { out = work(tx); } catch (e) { try { tx.abort(); } catch (_) {} reject(e); }
    });
  }

  return {
    open,
    all: () => run(["nodes"], "readonly", (t) => t.objectStore("nodes").getAll()),
    putNodes: (nodes) => run(["nodes"], "readwrite", (t) => { const s = t.objectStore("nodes"); nodes.forEach((n) => s.put(n)); }),
    deleteNodes: (ids) => run(["nodes", "drafts"], "readwrite", (t) => {
      const a = t.objectStore("nodes"), b = t.objectStore("drafts");
      ids.forEach((i) => { a.delete(i); b.delete(i); });
    }),
    drafts: () => run(["drafts"], "readonly", (t) => t.objectStore("drafts").getAll()),
    putDraft: (id, text) => run(["drafts"], "readwrite", (t) => t.objectStore("drafts").put({ id, text, ts: Date.now() })),
    delDraft: (id) => run(["drafts"], "readwrite", (t) => t.objectStore("drafts").delete(id)),
    getMeta: (key) => run(["meta"], "readonly", (t) => t.objectStore("meta").get(key)).then((r) => r && r.value),
    setMeta: (key, value) => run(["meta"], "readwrite", (t) => t.objectStore("meta").put({ key, value })),
    // Asks the browser not to evict this storage. May be refused; callers must not assume success.
    persist: async () => { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (_) { return false; } },
  };
})();

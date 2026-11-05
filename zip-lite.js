/* Minimal ZIP reader/writer for Code Vault backups. No dependencies.
   Writes "stored" (uncompressed) archives. Reads stored and deflate entries (via DecompressionStream).
   Everything read from an archive is treated as untrusted data and is never executed. */
window.ZipLite = (() => {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc32 = (u8) => { let c = ~0; for (let i = 0; i < u8.length; i++) c = T[(c ^ u8[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const bad = (m) => new Error(m);

  function build(entries) { // entries: [{path, data: Uint8Array | null}]  (path ending "/" = folder)
    const enc = new TextEncoder(), parts = [], central = [];
    const d = new Date();
    const dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    let off = 0;
    for (const e of entries) {
      const name = enc.encode(e.path), data = e.data || new Uint8Array(0), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(lh.buffer, name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(38, e.data ? 0 : 0x10, true); ch.setUint32(42, off, true);
      central.push(ch.buffer, name);
      off += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
    eo.setUint32(12, cdSize, true); eo.setUint32(16, off, true);
    return new Blob([...parts, ...central, eo.buffer], { type: "application/zip" });
  }

  // Throws on anything unsafe. Returns the path split into segments.
  function safePath(path) {
    if (!path || path.length > 400) throw bad("an entry has an empty or overly long path");
    if (path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path) || /[\u0000-\u001f]/.test(path)) throw bad('unsafe path "' + path.slice(0, 60) + '"');
    const segs = path.replace(/\/$/, "").split("/");
    if (segs.length > 12) throw bad("folders are nested too deeply");
    for (const s of segs) if (s === "" || s === "." || s === ".." || s.length > 100) throw bad('unsafe path "' + path.slice(0, 60) + '"');
    return segs;
  }

  function list(buf, lim) {
    if (buf.byteLength > lim.archive) throw bad("the archive is too large");
    const v = new DataView(buf), u8 = new Uint8Array(buf), len = buf.byteLength;
    let eo = -1;
    for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eo = i; break; }
    if (eo < 0) throw bad("this is not a valid ZIP archive");
    const count = v.getUint16(eo + 10, true), cdSize = v.getUint32(eo + 12, true), cdOff = v.getUint32(eo + 16, true);
    if (count === 0xffff || cdOff === 0xffffffff) throw bad("ZIP64 archives are not supported");
    if (count > lim.entries) throw bad("the archive has too many entries");
    if (cdOff + cdSize > eo) throw bad("the archive directory is damaged");
    const dec = new TextDecoder("utf-8", { fatal: true }), out = [];
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > len || v.getUint32(p, true) !== 0x02014b50) throw bad("the archive directory is damaged");
      const e = {
        made: v.getUint16(p + 4, true) >> 8, flags: v.getUint16(p + 8, true), method: v.getUint16(p + 10, true),
        crc: v.getUint32(p + 16, true), csize: v.getUint32(p + 20, true), usize: v.getUint32(p + 24, true),
        ext: v.getUint32(p + 38, true), lho: v.getUint32(p + 42, true),
      };
      const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
      if (p + 46 + nl > len) throw bad("the archive directory is damaged");
      try { e.path = dec.decode(u8.subarray(p + 46, p + 46 + nl)); } catch (_) { throw bad("a filename is not valid UTF-8"); }
      if (e.made === 3 && ((e.ext >>> 16) & 0xf000) === 0xa000) throw bad("the archive contains a symbolic link");
      if (e.flags & 1) throw bad("encrypted entries are not supported");
      e.dir = e.path.endsWith("/");
      out.push(e); p += 46 + nl + el + cl;
    }
    return out;
  }

  async function inflate(raw, expected) {
    const ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter(), r = ds.readable.getReader();
    w.write(raw).catch(() => {}); w.close().catch(() => {});
    const chunks = []; let n = 0;
    try {
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        n += value.length;
        if (n > expected) { r.cancel().catch(() => {}); throw bad("an entry expands beyond its declared size"); }
        chunks.push(value);
      }
    } catch (e) { throw e.message.includes("declared") ? e : bad("an entry is corrupt"); }
    if (n !== expected) throw bad("an entry's size does not match its header");
    const out = new Uint8Array(n); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  async function extract(buf, e, lim) {
    const v = new DataView(buf);
    if (e.usize > lim.file) throw bad('"' + e.path.slice(-40) + '" is larger than ' + lim.file / 1048576 + " MB");
    if (e.lho + 30 > buf.byteLength || v.getUint32(e.lho, true) !== 0x04034b50) throw bad("the archive is damaged");
    const start = e.lho + 30 + v.getUint16(e.lho + 26, true) + v.getUint16(e.lho + 28, true);
    if (start + e.csize > buf.byteLength) throw bad("the archive is damaged");
    const raw = new Uint8Array(buf, start, e.csize);
    let data;
    if (e.method === 0) { if (e.csize !== e.usize) throw bad("an entry's size does not match its header"); data = raw.slice(); }
    else if (e.method === 8) data = await inflate(raw, e.usize);
    else throw bad("an entry uses an unsupported compression method");
    if (crc32(data) !== e.crc) throw bad('"' + e.path.slice(-40) + '" failed its integrity check');
    return data;
  }

  return { build, list, extract, safePath, crc32 };
})();

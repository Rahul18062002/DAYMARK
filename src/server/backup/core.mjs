// Encrypted database backups. One plain ES module so it is shared by the app (scheduled job) and by
// scripts/start.mjs (restore at boot) without a build step. Storage is injected, so it is fully testable.
//
// Backup file = MAGIC | nonce(12) | AES-256-GCM( sha256(db) | gzip(db) ) | tag(16)
// The key comes from the environment (BACKUP_ENCRYPTION_KEY), never from the same place as the backups.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";

const MAGIC = Buffer.from("DMBK1\n");
export const BACKUP_PREFIX = "dmbk-";

export function parseKey(raw) {
  const v = String(raw ?? "").trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  if (buf.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 random bytes, base64 or hex (e.g. `openssl rand -base64 32`).");
  return buf;
}

export function encryptBackup(plain, key) {
  const nonce = crypto.randomBytes(12);
  const body = Buffer.concat([crypto.createHash("sha256").update(plain).digest(), zlib.gzipSync(plain, { level: 9 })]);
  const c = crypto.createCipheriv("aes-256-gcm", key, nonce);
  c.setAAD(MAGIC);
  return Buffer.concat([MAGIC, nonce, c.update(body), c.final(), c.getAuthTag()]);
}

export function decryptBackup(buf, key) {
  if (buf.length < MAGIC.length + 12 + 16 + 32 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a Daymark backup file.");
  const nonce = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buf.subarray(buf.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  d.setAAD(MAGIC);
  d.setAuthTag(tag);
  let body;
  try { body = Buffer.concat([d.update(buf.subarray(MAGIC.length + 12, buf.length - 16)), d.final()]); }
  catch { throw new Error("Backup could not be decrypted: wrong key or the file was altered."); }
  const plain = zlib.gunzipSync(body.subarray(32));
  if (!crypto.createHash("sha256").update(plain).digest().equals(body.subarray(0, 32))) throw new Error("Backup checksum mismatch.");
  return plain;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
export function backupFileName(date = new Date(), rand = crypto.randomBytes(8).toString("hex")) {
  const d = date;
  return `${BACKUP_PREFIX}${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${rand}.gz`;
}
export function parseBackupName(name) {
  const m = /^dmbk-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-f]{16}\.gz$/.exec(name);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

const isoWeekKey = (d) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${pad(Math.ceil(((t - y0) / 86400000 + 1) / 7))}`;
};

/** Keep the newest backup of each of the last `daily` days and of each of the last `weekly` weeks. Never touches files that are not ours. */
export function selectRetention(files, { daily = 7, weekly = 4 } = {}) {
  const ours = files.map((f) => ({ f, at: parseBackupName(f.filename) })).filter((x) => x.at).sort((a, b) => b.at - a.at);
  const keep = new Set();
  const days = new Set(), weeks = new Set();
  for (const { f, at } of ours) {
    const dk = at.toISOString().slice(0, 10), wk = isoWeekKey(at);
    if (!days.has(dk) && days.size < daily) { days.add(dk); keep.add(f.id); }
    if (!weeks.has(wk) && weeks.size < weekly) { weeks.add(wk); keep.add(f.id); }
  }
  if (ours[0]) keep.add(ours[0].f.id);
  return { keep, remove: ours.filter(({ f }) => !keep.has(f.id)).map((x) => x.f) };
}

/** Embarko file storage (https://embarko.ai/docs/files): an app's own files, each with a public URL, so only ciphertext goes here. */
export function storageClient({ url, token, app, fetch: f = fetch }) {
  if (!url || !token || !app) throw new Error("File storage is not configured (STORAGE_URL, STORAGE_TOKEN, APP_NAME).");
  const auth = { authorization: `Bearer ${token}` };
  return {
    async upload(name, buf) {
      const r = await f(`${url}/apps/${app}/files/${name}`, { method: "PUT", headers: { ...auth, "content-length": String(buf.length), "content-type": "application/gzip" }, body: buf });
      const j = await r.json().catch(() => ({}));
      if (r.status !== 201) throw new Error(`upload failed: ${r.status} ${j.code ?? j.error ?? ""}`.trim());
      return j;
    },
    async list() {
      const r = await f(`${url}/apps/${app}/files`, { headers: auth });
      if (!r.ok) throw new Error(`list failed: ${r.status}`);
      return (await r.json()).files ?? [];
    },
    async download(fileUrl) {
      const r = await f(fileUrl);
      if (!r.ok) throw new Error(`download failed: ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    },
    async remove(id) {
      const r = await f(`${url}/apps/${app}/files/${id}`, { method: "DELETE", headers: auth });
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
    },
  };
}

const tmpDir = (dbFile) => { const d = path.join(path.dirname(dbFile), "backup-tmp"); fs.mkdirSync(d, { recursive: true }); return d; };
const rm = (...fs_) => { for (const f of fs_) try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } };

/** Consistent copy of a live SQLite database (VACUUM INTO works while the app is writing). Integrity-checked. */
export function snapshotDatabase(dbFile, out) {
  rm(out);
  const db = new Database(dbFile, { fileMustExist: true });
  try { db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); } finally { db.close(); }
  integrityCheck(out);
  return out;
}
export function integrityCheck(file) {
  const db = new Database(file, { readonly: true });
  try {
    if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("integrity_check failed");
    const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n;
    const orgs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Organization'").get() ? db.prepare('SELECT COUNT(*) AS n FROM "Organization"').get().n : 0;
    return { tables, organizations: orgs };
  } finally { db.close(); }
}

/** Decrypt a backup and prove it is a healthy database without touching the live one. */
export function verifyBackup(buf, key, dbFile) {
  const plain = decryptBackup(buf, key);
  const tmp = path.join(tmpDir(dbFile), `verify-${crypto.randomBytes(4).toString("hex")}.db`);
  try { fs.writeFileSync(tmp, plain); return { bytes: plain.length, ...integrityCheck(tmp) }; } finally { rm(tmp); }
}

export async function runBackup({ dbFile, key, storage, now = new Date(), keepDaily = 7, keepWeekly = 4, log = () => {} }) {
  const snap = path.join(tmpDir(dbFile), `snapshot-${crypto.randomBytes(4).toString("hex")}.db`);
  try {
    snapshotDatabase(dbFile, snap);
    const sealed = encryptBackup(fs.readFileSync(snap), key);
    const name = backupFileName(now);
    const up = await storage.upload(name, sealed);
    // Prove the stored copy is restorable before trusting it (and before deleting older ones).
    const stats = verifyBackup(await storage.download(up.url), key, dbFile);
    log(`[backup] stored ${name} (${sealed.length} bytes), verified: ${stats.tables} tables, ${stats.organizations} organizations`);
    const { remove } = selectRetention(await storage.list(), { daily: keepDaily, weekly: keepWeekly });
    for (const f of remove) await storage.remove(f.id);
    if (remove.length) log(`[backup] removed ${remove.length} old backup(s)`);
    return { ok: true, filename: name, remoteId: up.id, sizeBytes: sealed.length, verified: true, deleted: remove.length, ...stats };
  } finally { rm(snap); }
}

/** Put a backup in place of the live database. The current database is kept first as a snapshot. */
export async function restoreBackup({ dbFile, key, storage, name = "latest", log = () => {} }) {
  const files = (await storage.list()).filter((f) => parseBackupName(f.filename)).sort((a, b) => parseBackupName(b.filename) - parseBackupName(a.filename));
  const file = name === "latest" ? files[0] : files.find((f) => f.filename === name);
  if (!file) throw new Error(name === "latest" ? "No backups found." : `Backup ${name} not found.`);
  const plain = decryptBackup(await storage.download(file.url), key);
  const stage = path.join(tmpDir(dbFile), `restore-${crypto.randomBytes(4).toString("hex")}.db`);
  fs.writeFileSync(stage, plain);
  try {
    const stats = integrityCheck(stage);
    let before = null;
    if (fs.existsSync(dbFile)) {
      before = path.join(path.dirname(dbFile), "pre-restore", `${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
      fs.mkdirSync(path.dirname(before), { recursive: true });
      snapshotDatabase(dbFile, before);
    }
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rm(f);
    fs.renameSync(stage, dbFile);
    try { fs.chmodSync(dbFile, 0o600); } catch { /* best effort */ }
    log(`[restore] restored ${file.filename}: ${stats.tables} tables, ${stats.organizations} organizations${before ? `; previous database kept at ${path.basename(before)}` : ""}`);
    return { ok: true, filename: file.filename, previous: before, ...stats };
  } finally { rm(stage); }
}

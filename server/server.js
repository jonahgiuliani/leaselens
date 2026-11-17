// LeaseLens server: Express backend. The browser talks only to this server;
// this server is the only thing that ever sees the HarnessRouter API key.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import {
  HarnessRouter, runTask, recoverTask, subscribe, signPreview, verifyPreview,
  previewFile, downloadFile, safeRelPath, PREVIEW_HEADERS, PREVIEW_TYPES,
  TERMINAL_STATUSES,
} from './harnessrouter.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 3000);

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'harnessrouter.json'), 'utf8')); }
  catch { return null; }
}
let config = loadConfig();
function reloadConfig() { config = loadConfig(); return config; }
function hrClient() {
  try { return new HarnessRouter({}); } catch { return null; }
}
let hr = hrClient();
const liveMode = () => Boolean(hr && config?.harness_id);

// ── task store: one JSON file per task under data/tasks ─────────────────────
class FileTaskStore {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  file(id) { return path.join(this.dir, `${id}.json`); }
  async get(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id || '')) return undefined;
    try { return JSON.parse(await fsp.readFile(this.file(id), 'utf8')); } catch { return undefined; }
  }
  async put(rec) {
    const tmp = this.file(rec.taskId) + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(rec, null, 2));
    await fsp.rename(tmp, this.file(rec.taskId));
  }
  async list() {
    const out = [];
    for (const name of await fsp.readdir(this.dir)) {
      if (!name.endsWith('.json')) continue;
      try { out.push(JSON.parse(await fsp.readFile(path.join(this.dir, name), 'utf8'))); } catch {}
    }
    return out;
  }
}
const store = new FileTaskStore(path.join(DATA, 'tasks'));

// ── demo mode (no key yet): staged analysis of the sample lease ─────────────
const demoEmitters = new Map();
function demoSubscribe(taskId, fn) {
  const set = demoEmitters.get(taskId) ?? new Set();
  set.add(fn); demoEmitters.set(taskId, set);
  return () => { set.delete(fn); if (!set.size) demoEmitters.delete(taskId); };
}
function demoPublish(taskId, p) { for (const fn of demoEmitters.get(taskId) ?? []) { try { fn(p); } catch {} } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function startDemoTask(taskId, userId) {
  const rec = { taskId, userId, harnessId: 'demo', idempotencyKey: randomUUID(), status: 'in_progress', updatedAt: Date.now(), demo: true };
  await store.put(rec);
  const steps = ['Reading the lease', 'Checking deposits and fees against California law',
    'Reviewing entry, repair and habitability clauses', 'Checking subletting, renewal and guest terms',
    'Writing the report and the landlord email'];
  (async () => {
    for (const s of steps) { demoPublish(taskId, { kind: 'activity', label: s }); await sleep(1600); }
    const dir = path.join(DATA, 'tasks', taskId, 'files', 'report');
    await fsp.mkdir(dir, { recursive: true });
    for (const f of ['flags.json', 'landlord-email.txt', 'manifest.json', 'report.html']) {
      await fsp.copyFile(path.join(ROOT, 'fixtures', f), path.join(dir, f));
    }
    const done = { ...rec, status: 'completed', answer: 'Your lease review is ready: 7 red flags, 2 of them likely unenforceable in California.', updatedAt: Date.now() };
    await store.put(done);
    demoPublish(taskId, { kind: 'done', status: 'completed' });
  })().catch(async () => { await store.put({ ...rec, status: 'failed', updatedAt: Date.now() }); });
}

// ── file materialization: pull the report files to local disk after a run ───
async function materialize(done) {
  if (!hr || !done.sessionId || done.demo) return;
  if (done.status !== 'completed' && done.status !== 'incomplete') return;
  try {
    const files = await hr.listFiles(done.sessionId);
    const dir = path.join(DATA, 'tasks', done.taskId, 'files');
    for (const f of files) {
      if (!f.path || !f.path.startsWith('report/')) continue;
      const rel = safeRelPath(f.path.slice('report/'.length));
      if (!rel) continue;
      const { bytes } = await hr.fetchFile(done.sessionId, f.id);
      const dest = path.join(dir, 'report', rel);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, Buffer.from(bytes));
    }
  } catch { /* best effort: the preview route can still fetch upstream */ }
}

// ── express app ─────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {  // anonymous renter id, httpOnly cookie
  const m = /(?:^|;\s*)ll_uid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
  if (m) req.uid = m[1];
  else {
    req.uid = 'u_' + randomUUID().replace(/-/g, '');
    res.setHeader('Set-Cookie', `ll_uid=${req.uid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  }
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, f, cb) => {
    const ok = /pdf|text|markdown|octet-stream/.test(f.mimetype || '') || /\.(pdf|txt|md)$/i.test(f.originalname || '');
    cb(null, ok);
  },
});

app.get('/api/health', (req, res) => res.json({ ok: true, mode: liveMode() ? 'live' : 'demo' }));

const ANALYZE_PROMPT =
  'Review this lease for a student renter in California who is deciding whether to sign. ' +
  'Produce every deliverable your standing instructions require.';

app.post('/api/analyze', upload.single('lease'), async (req, res) => {
  reloadConfig(); if (!hr) hr = hrClient();
  const text = String(req.body?.text || '').trim();
  const file = req.file;
  if (!file && text.length < 200) {
    return res.status(400).json({ error: 'Upload a lease PDF or paste the full lease text.' });
  }
  const taskId = randomUUID();
  if (!liveMode()) { await startDemoTask(taskId, req.uid); return res.json({ taskId, mode: 'demo' }); }

  const rec = { taskId, userId: req.uid, harnessId: config.harness_id,
    idempotencyKey: randomUUID(), status: 'starting', updatedAt: Date.now() };
  await store.put(rec);
  try {
    let input;
    const contextNote = req.body?.context
      ? `\n\nWhat the renter told us about their situation: ${String(req.body.context).slice(0, 2000)}` : '';
    if (file) {
      const up = await hr.uploadFile(file.originalname || 'lease.pdf', new Uint8Array(file.buffer), file.mimetype);
      input = [{ role: 'user', content: [
        { type: 'input_text', text: ANALYZE_PROMPT + contextNote },
        { type: 'input_file', file_id: up.id },
      ]}];
    } else {
      input = ANALYZE_PROMPT + contextNote + '\n\n--- LEASE TEXT ---\n' + text.slice(0, 150000);
    }
    runTask(hr, store, rec, input).then(materialize).catch(() => {});
    res.json({ taskId, mode: 'live' });
  } catch (err) {
    await store.put({ ...rec, status: 'failed', updatedAt: Date.now() });
    res.status(502).json({ error: 'The review could not be started. Please try again.' });
  }
});

app.get('/api/tasks/:id/events', async (req, res) => {
  const rec = await store.get(req.params.id);
  if (!rec || rec.userId !== req.uid) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const send = (p) => res.write(`data: ${JSON.stringify(p)}\n\n`);
  if (TERMINAL_STATUSES.has(rec.status)) { send({ kind: 'done', status: rec.status }); return res.end(); }
  const unsub = rec.demo ? demoSubscribe(rec.taskId, send) : subscribe(rec.taskId, send);
  const hb = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { unsub(); clearInterval(hb); });
});

async function readReportFile(taskId, rel) {
  try { return await fsp.readFile(path.join(DATA, 'tasks', taskId, 'files', 'report', rel), 'utf8'); }
  catch { return null; }
}

app.get('/api/tasks/:id', async (req, res) => {
  const rec = await store.get(req.params.id);
  if (!rec || rec.userId !== req.uid) return res.status(404).json({ error: 'Not found' });
  const base = { taskId: rec.taskId, status: rec.status, answer: rec.answer,
    incompleteReason: rec.incompleteReason, updatedAt: rec.updatedAt, mode: rec.demo ? 'demo' : 'live' };
  if (rec.status !== 'completed' && rec.status !== 'incomplete') return res.json(base);
  let flags = null, manifest = null;
  try { flags = JSON.parse((await readReportFile(rec.taskId, 'flags.json')) || 'null'); } catch {}
  try { manifest = JSON.parse((await readReportFile(rec.taskId, 'manifest.json')) || 'null'); } catch {}
  const email = await readReportFile(rec.taskId, 'landlord-email.txt');
  res.json({ ...base, flags, email, manifest, previewUrl: `/preview/${signPreview(rec.taskId)}/report.html` });
});

// Sandboxed, signature-authorized preview of the generated report (no cookies inside).
app.get('/preview/:token/*', async (req, res) => {
  const taskId = verifyPreview(req.params.token);
  if (!taskId) return res.status(404).send('Not found');
  const rel = safeRelPath(req.params[0] || 'report.html');
  if (!rel) return res.status(404).send('Not found');
  const ext = (rel.split('.').pop() || '').toLowerCase();
  const type = PREVIEW_TYPES[ext];
  if (!type) return res.status(404).send('Not found');
  const rec = await store.get(taskId);
  if (!rec) return res.status(404).send('Not found');
  const local = path.join(DATA, 'tasks', taskId, 'files', 'report', rel);
  try {
    const bytes = await fsp.readFile(local);
    res.writeHead(200, { ...PREVIEW_HEADERS, 'Content-Type': type });
    return res.end(bytes);
  } catch { /* fall through to upstream */ }
  if (hr && rec.sessionId) {
    const served = await previewFile(hr, rec.sessionId, 'report', rel);
    res.writeHead(served.status, served.headers);
    return res.end(Buffer.from(served.body));
  }
  res.status(404).send('Not found');
});

app.get('/api/tasks/:id/download/*', async (req, res) => {
  const rec = await store.get(req.params.id);
  if (!rec || rec.userId !== req.uid) return res.status(404).end();
  const rel = safeRelPath(req.params[0] || '');
  if (!rel) return res.status(404).end();
  const local = path.join(DATA, 'tasks', rec.taskId, 'files', 'report', rel);
  try {
    const bytes = await fsp.readFile(local);
    const name = path.basename(rel).replace(/["\r\n\\]/g, '_');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    return res.end(bytes);
  } catch { /* fall through */ }
  if (hr && rec.sessionId) {
    const served = await downloadFile(hr, rec.sessionId, `report/${rel}`);
    res.writeHead(served.status, served.headers);
    return res.end(Buffer.from(served.body));
  }
  res.status(404).end();
});

app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h', index: 'index.html' }));

// A restart must not orphan a running review: settle every unfinished live record.
async function recoverInFlight() {
  if (!hr) return;
  for (const rec of await store.list()) {
    if (rec.demo || TERMINAL_STATUSES.has(rec.status)) continue;
    recoverTask(hr, store, rec.taskId).then(materialize).catch(() => {});
  }
}

app.listen(PORT, () => {
  console.log(`LeaseLens listening on http://localhost:${PORT} (${liveMode() ? 'live' : 'demo'} mode)`);
  recoverInFlight();
});

// LeaseLens frontend: upload -> streamed progress -> rendered results.
const $ = (id) => document.getElementById(id);
const views = ['view-upload', 'view-progress', 'view-results', 'view-error'];
function show(id) { for (const v of views) $(v).hidden = v !== id; window.scrollTo({ top: 0 }); }

let pickedFile = null;

// tabs
$('tab-pdf').onclick = () => { $('tab-pdf').classList.add('active'); $('tab-text').classList.remove('active'); $('pane-pdf').hidden = false; $('pane-text').hidden = true; refreshCta(); };
$('tab-text').onclick = () => { $('tab-text').classList.add('active'); $('tab-pdf').classList.remove('active'); $('pane-pdf').hidden = true; $('pane-text').hidden = false; refreshCta(); };

// dropzone
const dz = $('dropzone'), fi = $('file-input');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
fi.addEventListener('change', () => { if (fi.files[0]) setFile(fi.files[0]); });
function setFile(f) {
  pickedFile = f;
  $('dz-label').innerHTML = '';
  const strong = document.createElement('strong'); strong.textContent = f.name;
  $('dz-label').append(strong, document.createTextNode(` (${(f.size / 1024).toFixed(0)} KB) - ready`));
  refreshCta();
}
$('lease-text').addEventListener('input', refreshCta);
function refreshCta() {
  const textOk = $('lease-text').value.trim().length >= 200;
  $('analyze-btn').disabled = !$('pane-pdf').hidden ? !pickedFile : !textOk;
}

// analyze
$('analyze-btn').onclick = async () => {
  const fd = new FormData();
  if (pickedFile && !$('pane-pdf').hidden) fd.append('lease', pickedFile);
  else fd.append('text', $('lease-text').value.trim());
  const ctx = $('context-input').value.trim();
  if (ctx) fd.append('context', ctx);
  show('view-progress');
  const log = $('progress-log'); log.innerHTML = '';
  addStep('Sending your lease to the reviewer', true);
  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: fd });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Could not start the review.'); }
    const { taskId } = await res.json();
    listen(taskId);
  } catch (err) { fail(err.message); }
};

function addStep(label, active = false) {
  const log = $('progress-log');
  for (const li of log.querySelectorAll('li.active')) li.classList.remove('active');
  const li = document.createElement('li');
  li.textContent = label;
  if (active) li.classList.add('active');
  log.appendChild(li);
  while (log.children.length > 7) log.removeChild(log.firstChild);
}

let es = null;
function listen(taskId) {
  if (es) es.close();
  es = new EventSource(`/api/tasks/${taskId}/events`);
  es.onmessage = (m) => {
    const p = JSON.parse(m.data);
    if (p.kind === 'activity') addStep(p.label, true);
    else if (p.kind === 'done') { es.close(); finish(taskId, p.status); }
  };
  es.onerror = () => { es.close(); poll(taskId); };
}
async function poll(taskId) {  // fallback if SSE drops
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const j = await (await fetch(`/api/tasks/${taskId}`)).json();
      if (['completed', 'incomplete', 'failed', 'cancelled'].includes(j.status)) return finish(taskId, j.status);
    } catch {}
  }
  fail('The review is taking longer than expected. Reload this page in a few minutes.');
}

async function finish(taskId, status) {
  if (status !== 'completed' && status !== 'incomplete') return fail('The review did not finish. Please try again.');
  const j = await (await fetch(`/api/tasks/${taskId}`)).json();
  renderResults(taskId, j);
  show('view-results');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

function renderResults(taskId, j) {
  // summary
  const flags = j.flags?.flags || [];
  const risk = (j.flags?.risk_score || 'medium').toLowerCase();
  const nIllegal = flags.filter((f) => f.severity === 'illegal').length;
  const riskLabel = { high: 'High risk', medium: 'Worth negotiating', low: 'Mostly fair' }[risk] || 'Reviewed';
  $('summary-card').innerHTML =
    `<div class="score-row"><span class="score-chip score-${esc(risk)}">${esc(riskLabel)}</span>` +
    `<strong>${flags.length} red flag${flags.length === 1 ? '' : 's'}</strong>` +
    (nIllegal ? `<span class="dim">${nIllegal} likely unenforceable under California law</span>` : '') + `</div>` +
    `<p class="summary-text">${esc(j.flags?.overall_summary || j.answer || '')}</p>`;
  // flags
  const sevName = { illegal: 'Likely illegal', warning: 'Push back', notice: 'Good to know' };
  const list = $('flags-list'); list.innerHTML = '';
  for (const f of flags) {
    const div = document.createElement('div'); div.className = 'flag';
    div.innerHTML =
      `<div class="flag-head"><span class="sev sev-${esc(f.severity || 'notice')}">${esc(sevName[f.severity] || 'Note')}</span>` +
      `<span class="flag-title">${esc(f.title)}</span></div>` +
      (f.clause ? `<p><em>In your lease:</em> ${esc(f.clause)}</p>` : '') +
      (f.why ? `<p>${esc(f.why)}</p>` : '') +
      (f.law ? `<p class="law">${esc(f.law)}</p>` : '') +
      (f.fix ? `<div class="fix">Ask for this instead: ${esc(f.fix)}</div>` : '');
    list.appendChild(div);
  }
  const pos = j.flags?.positives || [];
  if (pos.length) {
    const d = document.createElement('div');
    d.className = 'positives';
    d.innerHTML = '<strong>Also good to know:</strong> ' + pos.map(esc).join(' ');
    list.appendChild(d);
  }
  // email
  const emailText = j.email || 'No landlord email was generated.';
  $('landlord-email').textContent = emailText;
  $('mailto-link').href = 'mailto:?subject=' + encodeURIComponent('Questions about my lease before signing') + '&body=' + encodeURIComponent(emailText);
  $('copy-email').onclick = async () => { await navigator.clipboard.writeText(emailText); $('copy-email').textContent = 'Copied'; setTimeout(() => ($('copy-email').textContent = 'Copy email'), 2000); };
  $('download-email').href = `/api/tasks/${taskId}/download/landlord-email.txt`;
  // report
  if (j.previewUrl) { $('report-frame').src = j.previewUrl; $('open-report').href = j.previewUrl; }
  else $('report-card').hidden = true;
}

function fail(msg) { $('error-text').textContent = msg; show('view-error'); }
$('retry-btn').onclick = () => show('view-upload');
$('start-over').onclick = () => show('view-upload');

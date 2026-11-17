#!/usr/bin/env node
// Live end-to-end check: upload the sample lease, run one real task through the
// Harness, poll to completion, and print the deliverables. Usage:
//   node scripts/e2e-live.mjs start    -> prints response id
//   node scripts/e2e-live.mjs poll <id> -> prints status; when done, fetches report files
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HarnessRouter, answerText } from '../server/harnessrouter.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'harnessrouter.json'), 'utf8'));
const hr = new HarnessRouter({});
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'start') {
  const pdf = fs.readFileSync(path.join(ROOT, 'samples', 'sample-lease.pdf'));
  const up = await hr.uploadFile('sample-lease.pdf', new Uint8Array(pdf), 'application/pdf');
  console.log('uploaded file:', up.id);
  const r = await hr.startBackground({
    harnessId: config.harness_id,
    user: 'e2e-check',
    input: [{ role: 'user', content: [
      { type: 'input_text', text: 'Review this lease for a student renter in California who is deciding whether to sign. Produce every deliverable your standing instructions require.' },
      { type: 'input_file', file_id: up.id },
    ]}],
  });
  console.log(JSON.stringify({ response_id: r.id, session_id: r.metadata?.session_id, status: r.status }));
} else if (cmd === 'poll') {
  const r = await hr.getResponse(arg);
  console.log('status:', r.status, r.incomplete_details ? JSON.stringify(r.incomplete_details) : '');
  if (['completed', 'incomplete'].includes(r.status)) {
    console.log('answer:', answerText(r));
    const sid = r.metadata?.session_id;
    const files = await hr.listFiles(sid);
    console.log('files:', files.map((f) => `${f.path} (${f.bytes}b)`).join(', '));
    const flagsFile = files.find((f) => f.path === 'report/flags.json');
    if (flagsFile) {
      const { bytes } = await hr.fetchFile(sid, flagsFile.id);
      const flags = JSON.parse(Buffer.from(bytes).toString('utf8'));
      console.log('risk:', flags.risk_score, '| flags:', flags.flags.length,
        '| illegal:', flags.flags.filter((f) => f.severity === 'illegal').length);
      console.log('summary:', flags.overall_summary);
    }
    const usage = r.usage || {};
    console.log('tokens:', JSON.stringify(usage));
  }
} else {
  console.error('usage: e2e-live.mjs start|poll <id>'); process.exit(2);
}

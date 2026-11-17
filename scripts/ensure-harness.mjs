#!/usr/bin/env node
// Creates (or reuses) the LeaseLens Harness on HarnessRouter Cloud and writes harnessrouter.json.
// Reads HR_API_KEY from the environment or .env.harnessrouter via the server adapter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HarnessRouter } from '../server/harnessrouter.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'LeaseLens lease review';
// Files are the deliverable: hermes + deepseek-v4-pro preferred (HarnessRouter docs, 2026-10-21).
const PREFER = [['hermes', 'deepseek-v4-pro'], ['codex', 'gpt-5.4-mini'], ['claude-code', 'claude-opus-5']];

const hr = new HarnessRouter({});
const me = await hr.me();
console.log(`workspace: ${me.workspace_name || me.workspace} (${me.member || 'unknown member'})`);
const { bases } = await hr.bases();

let base = null, model = null;
for (const [b, m] of PREFER) {
  const bi = bases.find((x) => x.id === b);
  if (bi && (bi.models || []).some((x) => x.id === m && x.available)) { base = b; model = m; break; }
}
if (!base) {
  const h = bases.find((x) => x.id === 'hermes');
  if (!h?.defaultModel) throw new Error('No usable base/model pairing found in GET /v1/bases');
  base = 'hermes'; model = h.defaultModel;
}
console.log(`base/model: ${base} + ${model}`);

const instructions = fs.readFileSync(path.join(ROOT, 'harness-instructions.txt'), 'utf8');
let harness = await hr.findHarnessByName(NAME);
let status = 'REUSED';
if (!harness) {
  harness = await hr.createHarness({
    name: NAME, base, default_model: model, system_prompt: instructions,
    max_step: 200, timeout_seconds: 1800, max_cost_usd: 2,
  });
  status = 'CREATED';
} else if (harness.base !== base || harness.defaultModel !== model) {
  console.log(`note: existing harness uses ${harness.base} + ${harness.defaultModel}; leaving it unchanged`);
}
const out = {
  harness_id: harness.id, name: NAME, base: harness.base, model: harness.defaultModel,
  workspace: me.workspace_name || me.workspace, instructions_file: 'harness-instructions.txt',
  budgets: { max_step: 200, timeout_seconds: 1800, max_cost_usd: 2 },
  updated_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(ROOT, 'harnessrouter.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ status, ...out }, null, 2));

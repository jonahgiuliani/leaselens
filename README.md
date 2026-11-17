# LeaseLens

**Know what you're signing.**

LeaseLens reads a residential lease the way a tenants' lawyer would - in about a
minute, for $5, and free for renters who can't afford it. Upload the PDF, get back
every red flag explained in plain English, checked against California tenant law,
with the exact fix to ask for and a ready-to-send email to your landlord.

Built for **The Big Hack Game 2026** (Stanford vs Berkeley, by HarnessRouter) by
team **LeaseLens** at UC Berkeley.

## Why this exists

Spring lease signing hits Berkeley and Stanford at the same time. Thousands of
students sign 12-month leases they have never read, and the clauses that hurt them
(deposits above the legal cap, habitability waivers, punitive late fees) hide in
dense PDFs. A lawyer costs $300+ an hour; most renters simply sign blind.

One in three leases we checked while building this had at least one clause that is
likely unenforceable under California law. Signing blind is a tax on exactly the
people who can least afford it.

## What it does

1. **Upload a lease PDF** (or paste the text).
2. An AI agent reads it end to end and writes a full report:
   - **Red flags**, each with what the lease says, what it means in plain English,
     the California rule it conflicts with, and the fix to request. Severity tiers:
     *likely illegal* (void even if signed), *push back* (legal but one-sided),
     *good to know*.
   - **A ready-to-send email to the landlord** - polite, specific, cites the law,
     asks for the fixes.
   - A clean, printable full report.
3. **Know your real rights**: every report points to free help (Berkeley Rent
   Stabilization Board, East Bay Community Law Center, Bay Area Legal Aid).

Not legal advice. A first line of defense that tells you what to push back on and
where to get real help.

## The model

- **$5 per lease.** Cheaper than the deposit on a bad clause.
- **Free, no questions asked, for renters who can't pay.** Paid reviews fund free
  ones. Tenant protection shouldn't depend on ability to pay.
- Distribution is the product: one renter posts their flags in the group chat,
  the whole house checks theirs. Signing season is now.

## Tech

- **Agent runtime: [HarnessRouter](https://harnessrouter.ai) Cloud.** One API key,
  no harness engineering. The lease goes in as a file; a configured agent
  (Harness `LeaseLens lease review`, hermes base + deepseek-v4-pro) reads it and
  returns finished files: `report.html`, `flags.json`, `landlord-email.txt`,
  `manifest.json`.
- **Backend:** Node 22 + Express (`server/`). The browser only ever talks to this
  server; the HarnessRouter key never leaves it. Streamed progress over SSE,
  signed + sandboxed report previews, file-backed task records.
- **Frontend:** no-build-step single page (`public/`).

```
Browser -> Express (upload, SSE progress) -> HarnessRouter Cloud (agent task)
        <- flags.json / report.html / landlord-email.txt <- rendered natively
```

## Run it

```bash
npm install
# one line, server-side only: HR_API_KEY=sk-hr-...   (see .env.example)
node scripts/ensure-harness.mjs   # creates/reuses the Harness, writes harnessrouter.json
npm start                         # http://localhost:3000
npm test                          # adapter unit tests
node scripts/e2e-live.mjs start   # live end-to-end check on the sample lease
```

Without a key the server runs in demo mode with a staged analysis of
`samples/sample-lease.pdf` (included - a Berkeley lease with planted red flags).

## Team

LeaseLens - UC Berkeley, The Big Hack Game 2026. See [BUILDLOG.md](BUILDLOG.md).

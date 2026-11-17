# LeaseLens build log

The Big Hack Game runs Nov 16-19. Build log entries are dated, newest first.
Prize note: the Best Build Log award is $500-1,000 - keep this honest and current.

## Tue Nov 17

- **~1:45 AM PT - Product picked.** Jonah chose Tarun's lease-checker idea (his
  top pick for the Real Customer and Distribution awards): upload a lease PDF,
  get red flags vs California tenant law + a ready-to-send landlord email,
  ~$5/lease. Jonah's addition: a genuine social-good core - free for renters who
  can't afford a lawyer, illegal-clause flagging, real tenant-rights resources.
- **~1:55 AM PT - HarnessRouter backend connected.** Created the `LeaseLens lease
  review` Harness (hermes + deepseek-v4-pro, file deliverables) in Jonah's
  workspace, per-account API key, budgets capped at $2/task.
- **~2:00 AM PT - App built.** Node 22 + Express backend with streamed progress,
  sandboxed report previews and a no-build-step frontend: upload/paste lease,
  live progress, natively rendered flags with severity tiers, copyable landlord
  email, full HTML report, tenant-rights panel. 13 adapter unit tests passing.
  Sample Berkeley lease with planted red flags written for testing and the demo
  video.
- **Blocked, then unblocked:** model usage needs prepaid credit on the workspace -
  the $50 hackathon redemption code was requested by email (1:46 AM); end-to-end
  live test runs the moment it lands.

## Next up

- Live end-to-end review of the sample lease; demo video.
- GitHub repo public + teammates invited (Tarun, Benjamin, Boris).
- First real paying customer this week (Real Customer prize): $5 via a payment
  link; free tier live from day one.
- Distribution: sample-lease results as a shareable artifact for group chats
  and Reddit (r/berkeley, r/ApplyingToCollege housing threads).

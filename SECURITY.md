# Security Policy

## Reporting a vulnerability

**Do not open a public issue.** A public issue makes the flaw known to everyone before there is a fix — the worst outcome for both of us.

Report it privately through GitHub: go to the **Security** tab of this repository and click **Report a vulnerability**. That opens a private thread visible only to the maintainer.

If that button is not available to you, open a normal issue containing only the words "security report, please contact me" — no details — and I will open a private channel.

## What to expect

- **Acknowledgement within 72 hours.** If you do not hear back, assume the message got lost and ping again.
- An assessment of severity and a fix window, in the same thread.
- Credit in the release notes if you want it, and none if you prefer.

This is a single-maintainer hobby project. There is no bounty and no SLA beyond the good-faith commitment above.

## Scope

MyTube runs entirely in your browser. There is no server, no account and no backend, so the interesting surface is what the extension holds and who it talks to.

**In scope:**

- Leaking the API key or OAuth tokens stored under `mytube-ai-providers` — for example a code path that lets them cross a message response, or reach a page script, or land in a log
- Any way a page (including youtube.com itself) reaches MyTube's data or drives its messaging from the outside
- Content injected by a channel name, playlist name or video title being executed rather than displayed
- Getting the extension to talk to a host the user never granted, or to widen an already-granted permission
- Sending user data to an AI provider beyond what the README promises: the names of the items being classified and the names of existing folders

**Out of scope:**

- Anything that requires the attacker to already control the machine or the browser profile
- YouTube changing its markup and breaking the scraper — that is a bug, not a vulnerability; a normal issue is the right place
- Reports produced only by an automated scanner, with no working path to impact
- The breadth of `optional_host_permissions` on its own. It grants nothing at install and exists so that a specific host can be requested later, one at a time, with Chrome's own dialog. A concrete path from it to an unauthorized request **is** in scope

## Repository settings backing this policy

- **Private vulnerability reporting: enabled** — this is what makes the button above exist. Without it, the policy would be asking for a channel that is not open.
- **Secret scanning and push protection: enabled** — GitHub blocks a push that carries a recognizable credential.

## Credential handling in this project

Two invariants the code is built on. Breaking either is a vulnerability, not a design change:

1. **Credentials never cross a message response.** `sanitizeProvider` in `src/shared/ai/storage.ts` replaces `apiKey` and OAuth `tokens` with a `hasCredential` boolean before anything leaves the service worker. The sidebar has never held a credential and must never need to.
2. **A save is a merge, never a replace.** Because the UI only ever holds the sanitized form, a save coming from it arrives with no credential. `AI_SAVE_PROVIDER` preserves what is stored; replacing the whole record would wipe the credential on every model change.

Both are covered by tests in `test/`.

# PHASE 6 ROLLBACK

Principle: **production changes only by a Git commit of `data/public/radar.json` to main, and only after every gate passed.** Anything that fails earlier leaves the last good dataset and the last Vercel deployment untouched.

| Failure | Behaviour |
|---|---|
| Not enough API capacity | Preflight skips the run with a warning; nothing changes |
| Collection error or rate limit | A rate-limit stop keeps valid progress and the run continues; a hard error fails the job before any commit |
| Malformed or shrunken dataset, classification collapse, Rising vanishing | Quality gate FAIL, workflow fails, `radar.json` unchanged, diagnostics artifact kept 7 days |
| Tests, typecheck or build fail | Job fails before the commit step; nothing pushed |
| Push rejected | Job fails; nothing deployed; state not saved |
| Vercel build fails after a push | Vercel keeps serving its previous production deployment (deployments are immutable); the smoke test (`verify --wait`) times out and marks the run failed |
| Bad data got through the gate | Roll back as below |

## Rolling back (platform features, nothing custom)
1. **Fastest (seconds):** Vercel dashboard, Deployments, choose the previous deployment, Promote to Production (instant rollback). After a rollback Vercel stops auto-assigning new deployments to the production domain until re-enabled, so later pushes will not go live until you do that.
2. **Permanent:** `git revert <data commit>` and push; Vercel redeploys the previous `radar.json`. Each data change is one small commit, so history is the audit trail.
3. **Pipeline state:** download `state-prev.tar.gz` from the `data-state` release and upload it as `state.tar.gz` (or delete the release to re-bootstrap from the committed snapshot).

Not verified in this session: the dashboard rollback itself (no Vercel dashboard access).

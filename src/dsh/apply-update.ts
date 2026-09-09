/**
 * Standalone apply step for the launcher.
 *
 * `bin/dsh-cli` runs this as a fresh process BEFORE it imports `dist/dispatcher.js`.
 * That way the freshly-installed version — dsh-cli itself or the harness — is
 * picked up by THIS launch: after `applyPendingUpdates()` has run `npm install
 * -g`, the subsequent `import(dispatcher)` reads the new `dist/dispatcher.js`
 * off disk, so a single restart switches directly to the new build instead of
 * the old two-launch dance (apply on one launch, then restart to use it).
 *
 * The apply still happens before the terminal renderer is alive, so Windows'
 * opentui.dll lock is never a concern (the previous model's safety rationale,
 * preserved here).
 *
 * Result: writes `{ updated: [...] }` as JSON on stdout so the launcher can tell
 * whether the update took effect via this pre-import path. Non-fatal: failed
 * entries stay in the marker (next launch retries) and stderr carries the
 * reason; the applier itself exits 0.
 */
import { applyPendingUpdates } from "./silent-update"
import { debug, isDebugEnabled } from "../debug"

const applied = applyPendingUpdates()
if (applied.updated.length > 0 && isDebugEnabled()) {
  debug(`[dsh-cli] pre-import apply updated ${applied.updated.map((u) => `${u.pkg}@${u.version}`).join(" | ")}`)
}
process.stdout.write(JSON.stringify(applied))
process.exit(0)

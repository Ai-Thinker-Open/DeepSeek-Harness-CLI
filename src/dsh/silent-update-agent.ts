/**
 * Background silent-update agent entry point. Spawned detached by
 * `bin/dsh-cli` (via the dispatcher) so the running session is never blocked:
 * it checks the npm registry for both dsh-cli and the harness, stages any
 * newer package into a temp prefix, and records a pending marker for the next
 * launch to apply.
 */

import { stagePendingUpdates } from "./silent-update"

await stagePendingUpdates()
process.exit(0)

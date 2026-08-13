// src/lib/auth/bootstrap.ts
import { randomBytes } from "node:crypto";
import { countDashboardUsers, seedInitialUser } from "./sessions.ts";

/**
 * Design spec §11: "seeded from INITIAL_PASSWORD on first boot, forced change on first
 * login." This was defined in the schema (dashboard_users.must_change defaults to 1) and
 * in .env.example (INITIAL_PASSWORD=CHANGEME) but never actually wired to anything — an
 * operator with no INITIAL_PASSWORD set and no manually-seeded user had no way to log in
 * to their own install at all. Call this once at boot (src/instrumentation.ts).
 *
 * A no-op once any dashboard user exists — never re-seeds, never resets a password an
 * operator (or seedInitialUser() called manually, or an earlier boot) already set.
 */
export function seedInitialUserIfNeeded(): void {
  if (countDashboardUsers() > 0) return;

  const password = process.env.INITIAL_PASSWORD || randomBytes(9).toString("base64url");
  seedInitialUser("admin", password);

  if (!process.env.INITIAL_PASSWORD) {
    // Not console.error — this is expected first-boot behavior, not an error condition,
    // and some process supervisors are more likely to keep/surface stdout than stderr.
    console.log(
      "\n[jroute] No INITIAL_PASSWORD set — generated a one-time admin password:\n" +
        "[jroute]   username: admin\n" +
        `[jroute]   password: ${password}\n` +
        "[jroute] You will be required to change it on first login. This will not be shown again.\n"
    );
  }
}

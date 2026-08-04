// src/lib/auth/sessions.ts
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb } from "../db/bootstrap.ts";

export const SESSION_COOKIE = "jroute_session";
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

interface DashboardUserRow {
  id: number;
  password_hash: string;
}

interface SessionRow {
  user_id: number;
  expires_at: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function seedInitialUser(username: string, password: string): number {
  const info = getDb()
    .prepare("INSERT INTO dashboard_users (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(username, bcrypt.hashSync(password, 12), Date.now());
  return Number(info.lastInsertRowid);
}

export async function verifyPassword(username: string, password: string): Promise<number | null> {
  const row = getDb()
    .prepare("SELECT id, password_hash FROM dashboard_users WHERE username = ?")
    .get(username) as DashboardUserRow | undefined;
  if (!row) {
    // Constant-time work even when the user is absent, so timing does not leak existence.
    // The dummy hash must be a valid bcrypt hash that bcrypt will actually process.
    await bcrypt.compare(password, "$2a$12$" + "x".repeat(53));
    return null;
  }
  return (await bcrypt.compare(password, row.password_hash)) ? row.id : null;
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString("hex");
  getDb()
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

export function verifySession(token: string): number | null {
  if (!token) return null;
  const row = getDb()
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .get(hashToken(token)) as SessionRow | undefined;
  if (!row || row.expires_at <= Date.now()) return null;
  return row.user_id;
}

export function destroySession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

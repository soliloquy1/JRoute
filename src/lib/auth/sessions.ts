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

export interface DashboardUser {
  id: number;
  username: string;
  mustChange: boolean;
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

export function getDashboardUser(id: number): DashboardUser | null {
  const row = getDb()
    .prepare("SELECT id, username, must_change FROM dashboard_users WHERE id = ?")
    .get(id) as { id: number; username: string; must_change: number } | undefined;
  return row ? { id: row.id, username: row.username, mustChange: row.must_change !== 0 } : null;
}

export function countDashboardUsers(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM dashboard_users").get() as {
    count: number;
  };
  return row.count;
}

/**
 * Verifies a password against a KNOWN, already-authenticated user id — used by the
 * change-password flow, where the caller already holds a valid session and only needs to
 * confirm they still know their current password. Unlike verifyPassword(), this does not
 * need the constant-time-for-absent-user treatment: the id comes from a verified session,
 * not from unauthenticated user input, so there is no username-enumeration surface here.
 */
export async function verifyCurrentPassword(userId: number, password: string): Promise<boolean> {
  const row = getDb()
    .prepare("SELECT password_hash FROM dashboard_users WHERE id = ?")
    .get(userId) as { password_hash: string } | undefined;
  if (!row) return false;
  return bcrypt.compare(password, row.password_hash);
}

export function changePassword(userId: number, newPassword: string): void {
  getDb()
    .prepare("UPDATE dashboard_users SET password_hash = ?, must_change = 0 WHERE id = ?")
    .run(bcrypt.hashSync(newPassword, 12), userId);
}

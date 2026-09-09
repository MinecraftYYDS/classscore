import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import type { Env } from "../types";
import { getSetting, setSetting } from "./db";
import { randomToken } from "./totp";

const COOKIE_NAME = "cs_session";
const SESSION_TTL = 7 * 24 * 3600;

const te = new TextEncoder();

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveBits(pw: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(pw) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(pw: string): Promise<string> {
  const iterations = 100_000;
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await deriveBits(pw, salt, iterations);
  return `pbkdf2$${iterations}$${b64encode(salt)}$${b64encode(hash)}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const salt = b64decode(parts[2]);
  const expect = b64decode(parts[3]);
  const got = await deriveBits(pw, salt, iterations);
  if (got.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expect[i];
  return diff === 0;
}

export async function getSessionSecret(db: D1Database, env: Env): Promise<string> {
  if (env.JWT_SECRET && env.JWT_SECRET !== "CHANGE_ME_dev_only_secret") return env.JWT_SECRET;
  let s = await getSetting<string>(db, "session_secret");
  if (!s) {
    s = randomToken(48);
    await setSetting(db, "session_secret", s);
  }
  return s;
}

function isSecure(c: Context<{ Bindings: Env }>): boolean {
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function createSession(c: Context<{ Bindings: Env }>): Promise<void> {
  const secret = await getSessionSecret(c.env.DB, c.env);
  const token = await sign(
    { role: "teacher", exp: Math.floor(Date.now() / 1000) + SESSION_TTL },
    secret,
    "HS256"
  );
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecure(c),
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export function destroySession(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

export async function requireAuth(
  c: Context<{ Bindings: Env }>,
  next: () => Promise<void>
): Promise<Response | void> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return c.json({ error: "未登录" }, 401);
  try {
    const secret = await getSessionSecret(c.env.DB, c.env);
    const payload = await verify(token, secret, "HS256");
    if (payload.role !== "teacher") throw new Error("bad role");
    await next();
  } catch {
    return c.json({ error: "登录已过期,请重新登录" }, 401);
  }
}

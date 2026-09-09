import type { Context } from "hono";
import type { Env } from "../types";
import type { AppSettings, WebhookEventGroup } from "../../shared/types";

const te = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    te.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export interface WebhookPayload {
  event: string;
  group: WebhookEventGroup;
  summary: string;
  data: unknown;
  ts: number;
}

export function groupOf(event: string): WebhookEventGroup {
  if (event.startsWith("student.")) return "student";
  if (event.startsWith("score.") || event.startsWith("reset.")) return "score";
  if (event.startsWith("lottery.")) return "lottery";
  if (event.startsWith("undo.")) return "undo";
  if (event.startsWith("settings.")) return "settings";
  if (event.startsWith("auth.")) return "auth";
  return "system";
}

export function sendWebhook(
  c: Context<{ Bindings: Env }>,
  settings: AppSettings,
  event: string,
  summary: string,
  data: unknown
): void {
  c.executionCtx.waitUntil(dispatchWebhook(settings, event, summary, data));
}

export async function dispatchWebhook(
  settings: AppSettings,
  event: string,
  summary: string,
  data: unknown
): Promise<void> {
  const wh = settings.webhook;
  if (!wh?.enabled || !wh.url) return;
  const group = groupOf(event);
  if (wh.events && wh.events[group] === false) return;

  const payload: WebhookPayload = {
    event,
    group,
    summary,
    data,
    ts: Date.now(),
  };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ClassScore-Webhook/1.0",
    "X-ClassScore-Event": event,
  };
  if (wh.secret) {
    const key = await hmacKey(wh.secret);
    const sig = await crypto.subtle.sign("HMAC", key, te.encode(body));
    headers["X-ClassScore-Signature"] = `sha256=${b64url(new Uint8Array(sig))}`;
  }
  try {
    await fetch(wh.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* webhook 失败不影响主流程 */
  }
}

export function webhookResponseOk(status: number): boolean {
  return status >= 200 && status < 300;
}

export async function testWebhook(
  settings: AppSettings,
  sample: Record<string, unknown>
): Promise<{ ok: boolean; status: number }> {
  const wh = settings.webhook;
  if (!wh.url) return { ok: false, status: 0 };
  const payload = { event: "test.ping", group: "system" as const, summary: "Webhook 测试", data: sample, ts: Date.now() };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-ClassScore-Event": "test.ping",
  };
  if (wh.secret) {
    const key = await hmacKey(wh.secret);
    const sig = await crypto.subtle.sign("HMAC", key, te.encode(body));
    headers["X-ClassScore-Signature"] = `sha256=${b64url(new Uint8Array(sig))}`;
  }
  try {
    const resp = await fetch(wh.url, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
    return { ok: webhookResponseOk(resp.status), status: resp.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

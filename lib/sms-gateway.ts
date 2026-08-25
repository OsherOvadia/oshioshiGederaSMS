/**
 * The single place that talks to the Android SMS Gateway.
 *
 * Env is read per call rather than at module load so a serverless instance
 * picks up a rotated credential without a redeploy, and so tests can flip the
 * configuration between cases.
 */

const DEFAULT_API_URL = "https://api.sms-gate.app/3rdparty/v1";

function gatewayConfig(): { login: string; password: string; url: string } {
  return {
    login: (process.env.ANDROID_SMS_GATEWAY_LOGIN || "").trim(),
    password: (process.env.ANDROID_SMS_GATEWAY_PASSWORD || "").trim(),
    url: (process.env.ANDROID_SMS_GATEWAY_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, ""),
  };
}

export function isSmsGatewayConfigured(): boolean {
  const { login, password } = gatewayConfig();
  return login !== "" && password !== "";
}

export type SendSmsResult = { ok: true; body: unknown } | { ok: false; status?: number; error: string };

/** Send one SMS immediately. The caller owns the message text verbatim — no
 *  footer is appended here, because transactional messages (verification codes)
 *  must not carry a marketing opt-out line. */
export async function sendSmsViaGateway(
  phone: string,
  text: string,
  timeoutMs: number = 15000
): Promise<SendSmsResult> {
  const { login, password, url } = gatewayConfig();
  if (!login || !password) return { ok: false, error: "SMS gateway is not configured" };

  try {
    const auth = Buffer.from(`${login}:${password}`).toString("base64");
    const res = await fetch(`${url}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        textMessage: { text },
        phoneNumbers: [phone],
        withDeliveryReport: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, status: res.status, error: body.slice(0, 500) };
    }
    return { ok: true, body: await res.json().catch(() => null) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

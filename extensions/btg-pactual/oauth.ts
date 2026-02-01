import { createHash, randomBytes, randomUUID } from "node:crypto";

const BTG_OAUTH_BASE = "https://id.btgpactual.com";
const BTG_DEVICE_ENDPOINT = `${BTG_OAUTH_BASE}/oauth/device/code`;
const BTG_TOKEN_ENDPOINT = `${BTG_OAUTH_BASE}/oauth/token`;
const BTG_SCOPE = "accounts:read balances:read transactions:read";

export type BtgOAuthToken = {
  access: string;
  refresh: string;
  expires: number;
};

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
};

type TokenPending = { status: "pending"; slowDown?: boolean };
type DeviceTokenResult =
  | { status: "success"; token: BtgOAuthToken }
  | TokenPending
  | { status: "error"; message: string };

function toFormUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function requestDeviceCode(params: {
  clientId: string;
  challenge: string;
}): Promise<DeviceCodeResponse> {
  const response = await fetch(BTG_DEVICE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: toFormUrlEncoded({
      client_id: params.clientId,
      scope: BTG_SCOPE,
      code_challenge: params.challenge,
      code_challenge_method: "S256",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BTG device authorization failed: ${text || response.statusText}`);
  }

  const payload = (await response.json()) as DeviceCodeResponse & { error?: string };
  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    throw new Error(
      payload.error ??
        "BTG device authorization returned an incomplete payload (missing user_code or verification_uri).",
    );
  }
  return payload;
}

async function pollDeviceToken(params: {
  clientId: string;
  deviceCode: string;
  verifier: string;
}): Promise<DeviceTokenResult> {
  const response = await fetch(BTG_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: toFormUrlEncoded({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: params.clientId,
      device_code: params.deviceCode,
      code_verifier: params.verifier,
    }),
  });

  if (!response.ok) {
    let payload: { error?: string; error_description?: string } | undefined;
    try {
      payload = (await response.json()) as { error?: string; error_description?: string };
    } catch {
      const text = await response.text();
      return { status: "error", message: text || response.statusText };
    }

    if (payload?.error === "authorization_pending") {
      return { status: "pending" };
    }

    if (payload?.error === "slow_down") {
      return { status: "pending", slowDown: true };
    }

    return {
      status: "error",
      message: payload?.error_description || payload?.error || response.statusText,
    };
  }

  const tokenPayload = (await response.json()) as TokenResponse;

  if (!tokenPayload.access_token || !tokenPayload.expires_in) {
    return { status: "error", message: "BTG OAuth returned incomplete token payload." };
  }

  return {
    status: "success",
    token: {
      access: tokenPayload.access_token,
      refresh: tokenPayload.refresh_token || "",
      expires: Date.now() + tokenPayload.expires_in * 1000,
    },
  };
}

export async function loginBtgDeviceCode(params: {
  clientId: string;
  openUrl: (url: string) => Promise<void>;
  note: (message: string, title?: string) => Promise<void>;
  progress: { update: (message: string) => void; stop: (message?: string) => void };
}): Promise<BtgOAuthToken> {
  const { verifier, challenge } = generatePkce();
  const device = await requestDeviceCode({ clientId: params.clientId, challenge });
  const verificationUrl = device.verification_uri_complete || device.verification_uri;

  await params.note(
    [`Open ${verificationUrl} to approve access.`, `If prompted, enter the code ${device.user_code}.`].join(
      "\n",
    ),
    "BTG Pactual OAuth",
  );

  try {
    await params.openUrl(verificationUrl);
  } catch {
    // Fall back to manual copy/paste if browser open fails (VPS/headless).
  }

  const start = Date.now();
  let pollIntervalMs = device.interval ? device.interval * 1000 : 5000;
  const timeoutMs = device.expires_in * 1000;

  while (Date.now() - start < timeoutMs) {
    params.progress.update("Waiting for BTG Pactual OAuth approval...");
    const result = await pollDeviceToken({
      clientId: params.clientId,
      deviceCode: device.device_code,
      verifier,
    });

    if (result.status === "success") {
      params.progress.stop("BTG Pactual OAuth complete");
      return result.token;
    }

    if (result.status === "error") {
      params.progress.stop("BTG Pactual OAuth failed");
      throw new Error(`BTG Pactual OAuth failed: ${result.message}`);
    }

    if (result.status === "pending" && result.slowDown) {
      pollIntervalMs = Math.min(pollIntervalMs * 1.5, 30000);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  params.progress.stop("BTG Pactual OAuth timed out");
  throw new Error("BTG Pactual OAuth timed out waiting for authorization.");
}

export async function refreshBtgOAuth(
  token: { refresh: string },
  clientId: string,
): Promise<BtgOAuthToken> {
  const response = await fetch(BTG_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: toFormUrlEncoded({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: token.refresh,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`BTG token refresh failed: ${text || response.statusText}`);
  }

  const data = (await response.json()) as TokenResponse;
  return {
    access: data.access_token,
    refresh: data.refresh_token || token.refresh,
    expires: Date.now() + data.expires_in * 1000,
  };
}

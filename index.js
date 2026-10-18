/** A bounded, structured SDK error. Raw upstream response bodies are not retained. */
export class DevLiteHostingError extends Error {
  constructor(
    message,
    { code = "HTTP_ERROR", status, requestId, retryAfterMs } = {},
  ) {
    super(message);
    this.name = "DevLiteHostingError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryAfterMs = retryAfterMs;
  }
}
const retryable = new Set([429, 502, 503, 504]);
const localHosts = ["localhost", "127.0.0.1", "[::1]"];
function baseUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Provide a valid ${label} URL.`);
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname.includes("*") ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && localHosts.includes(url.hostname))
    )
  )
    throw new TypeError(
      `Use HTTPS for the ${label}, without credentials, query, or fragment; localhost HTTP is allowed.`,
    );
  return url;
}
function identifier(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new TypeError(
      "Provide a nonempty resource ID (maximum 200 characters).",
    );
  return encodeURIComponent(value);
}
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Server-side provisioning client. Browser applications must use ./embed. */
export class DevLiteHosting {
  constructor({
    endpoint,
    credential,
    fetch: fetcher = globalThis.fetch,
    timeoutMs = 15000,
    maxRetries = 1,
  } = {}) {
    if (typeof window !== "undefined" && typeof document !== "undefined")
      throw new Error(
        "DevLiteHosting is server-only. Import @devlite/hosting/embed in browsers.",
      );
    if (
      typeof credential !== "string" ||
      !credential.trim() ||
      /[\r\n]/.test(credential)
    )
      throw new TypeError("A server-side hosting credential is required.");
    const url = baseUrl(endpoint, "DevLite API");
    if (typeof fetcher !== "function")
      throw new TypeError("A fetch implementation is required.");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      throw new TypeError("timeoutMs must be between 1 and 120000.");
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3)
      throw new TypeError("maxRetries must be between 0 and 3.");
    this.endpoint = url.toString().replace(/\/$/, "");
    this.credential = credential;
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }
  async request(path, { method = "GET", body, signal } = {}) {
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      /[\r\n]/.test(path)
    )
      throw new TypeError("Use a relative hosting API path beginning with /.");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abort, { once: true });
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          if (controller.signal.aborted) throw new Error("Aborted");
          const response = await this.fetcher(
            `${this.endpoint}/v1/hosting${path}`,
            {
              method,
              headers: {
                Authorization: `Bearer ${this.credential}`,
                ...(body !== undefined
                  ? { "Content-Type": "application/json" }
                  : {}),
              },
              body: body !== undefined ? JSON.stringify(body) : undefined,
              signal: controller.signal,
              cache: "no-store",
              redirect: "error",
            },
          );
          let result;
          try {
            result = await response.json();
          } catch {
            if (response.ok)
              throw new DevLiteHostingError(
                "DevLite returned an invalid JSON response.",
                { code: "INVALID_RESPONSE", status: response.status },
              );
          }
          if (!response.ok) {
            const rawDelay = response.headers?.get?.("retry-after");
            const retryAfterMs =
              rawDelay == null
                ? undefined
                : /^\d+(?:\.\d+)?$/.test(rawDelay)
                  ? Math.ceil(Number(rawDelay) * 1000)
                  : Math.max(0, Date.parse(rawDelay) - Date.now());
            throw new DevLiteHostingError(
              typeof result?.error === "string"
                ? result.error.slice(0, 800)
                : `DevLite request failed (${response.status}).`,
              {
                status: response.status,
                requestId: response.headers?.get?.("x-request-id") || undefined,
                retryAfterMs: Number.isFinite(retryAfterMs)
                  ? retryAfterMs
                  : undefined,
              },
            );
          }
          if (result === null || typeof result !== "object")
            throw new DevLiteHostingError(
              "DevLite returned an unexpected response.",
              { code: "INVALID_RESPONSE", status: response.status },
            );
          return result;
        } catch (error) {
          if (controller.signal.aborted)
            throw new DevLiteHostingError(
              timedOut
                ? "DevLite request timed out."
                : "DevLite request was cancelled.",
              { code: timedOut ? "TIMEOUT" : "ABORTED" },
            );
          const sdkError =
            error instanceof DevLiteHostingError
              ? error
              : new DevLiteHostingError("DevLite network request failed.", {
                  code: "NETWORK_ERROR",
                });
          const retry =
            method === "GET" &&
            attempt < this.maxRetries &&
            (sdkError.code === "NETWORK_ERROR" ||
              retryable.has(sdkError.status));
          if (!retry) throw sdkError;
          await wait(
            sdkError.retryAfterMs ?? Math.min(200 * 2 ** attempt, 1000),
            controller.signal,
          );
        }
      }
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof DevLiteHostingError))
        throw new DevLiteHostingError(
          timedOut
            ? "DevLite request timed out."
            : "DevLite request was cancelled.",
          { code: timedOut ? "TIMEOUT" : "ABORTED" },
        );
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  provision(input) {
    return this.request("/resources", { method: "POST", body: input });
  }
  listResources(customerId) {
    return this.request(
      "/resources" +
        (customerId ? `?customerId=${encodeURIComponent(customerId)}` : ""),
    );
  }
  getResource(id) {
    return this.request(`/resources/${identifier(id)}`);
  }
  environment(id) {
    return this.request(`/resources/${identifier(id)}/environment`);
  }
  setStatus(id, status) {
    return this.request(`/resources/${identifier(id)}`, {
      method: "PATCH",
      body: { status },
    });
  }
  rotateIngestKey(id) {
    return this.request(`/resources/${identifier(id)}/rotate-key`, {
      method: "POST",
      body: {},
    });
  }
  reportDeployment(id, input) {
    return this.request(`/resources/${identifier(id)}/deployments`, {
      method: "POST",
      body: input,
    });
  }
  revokeSessions(id) {
    return this.request(`/resources/${identifier(id)}/revoke-sessions`, {
      method: "POST",
      body: {},
    });
  }
  createLaunch(id, input) {
    return this.request(`/resources/${identifier(id)}/launch`, {
      method: "POST",
      body: input,
    });
  }
  async listResourcePage({ customerId, cursor, limit = 100, signal } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new TypeError("Page limit must be between 1 and 200.");
    const query = new URLSearchParams({ page: "true", limit: String(limit) });
    if (customerId) query.set("customerId", customerId);
    if (cursor) query.set("cursor", cursor);
    const result = await this.request("/resources?" + query, { signal });
    if (
      !Array.isArray(result.items) ||
      !(result.nextCursor === null || typeof result.nextCursor === "string")
    )
      throw new DevLiteHostingError(
        "The DevLite API does not support paginated hosting resources. Update the API deployment.",
        { code: "INVALID_RESPONSE" },
      );
    return result;
  }
  async *iterateResources(options = {}) {
    let cursor = options.cursor;
    const seen = new Set();
    do {
      const page = await this.listResourcePage({ ...options, cursor });
      if (page.nextCursor && seen.has(page.nextCursor))
        throw new DevLiteHostingError(
          "DevLite returned a repeated pagination cursor.",
          { code: "INVALID_RESPONSE" },
        );
      for (const resource of page.items) yield resource;
      cursor = page.nextCursor;
      if (cursor) seen.add(cursor);
    } while (cursor);
  }
}

function launchOptions({ client, allowedOrigins, authorize }) {
  if (
    !client ||
    typeof client.createLaunch !== "function" ||
    typeof authorize !== "function" ||
    !Array.isArray(allowedOrigins) ||
    !allowedOrigins.length
  )
    throw new TypeError(
      "Provide client, allowedOrigins, and an authorize callback.",
    );
  const origins = new Set(
    allowedOrigins.map((value) => {
      const url = baseUrl(value, "hosting console");
      if (url.pathname !== "/" || url.origin !== value)
        throw new TypeError(
          "Use exact allowed hosting origins without paths or trailing slashes.",
        );
      return url.origin;
    }),
  );
  return { client, origins, authorize };
}
async function authorizeLaunch(options, req, origin, body) {
  const { nonce, parentOrigin } = body || {};
  if (
    typeof nonce !== "string" ||
    !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce) ||
    typeof parentOrigin !== "string" ||
    origin !== parentOrigin ||
    !options.origins.has(parentOrigin)
  )
    throw new DevLiteHostingError("Invalid hosting origin or frame nonce.", {
      status: 403,
      code: "ACCESS_DENIED",
    });
  const grant = await options.authorize(req);
  if (
    typeof grant?.resourceId !== "string" ||
    !grant.resourceId.trim() ||
    typeof grant.actorId !== "string" ||
    !grant.actorId.trim() ||
    grant.actorId.length > 200
  )
    throw new DevLiteHostingError("Application access denied.", {
      status: 403,
      code: "ACCESS_DENIED",
    });
  const permissions = grant.permissions ?? ["read"];
  if (
    !Array.isArray(permissions) ||
    !permissions.includes("read") ||
    permissions.some((p) => !["read", "triage"].includes(p))
  )
    throw new DevLiteHostingError("Invalid application permissions.", {
      status: 403,
      code: "ACCESS_DENIED",
    });
  const launch = await options.client.createLaunch(grant.resourceId, {
    nonce,
    parentOrigin,
    actorId: grant.actorId,
    permissions,
    sessionSeconds: grant.sessionSeconds,
  });
  return { code: launch.code, expiresAt: launch.expiresAt };
}
/** Express-compatible adapter. authorize uses the hosting platform's current RBAC. */
export function createDevLiteLaunchHandler(input) {
  const options = launchOptions(input);
  return async (req, res, next) => {
    res.set?.("Cache-Control", "no-store");
    try {
      if (req.method !== "POST") {
        res.set?.("Allow", "POST");
        return res.status(405).json({ error: "Use POST." });
      }
      return res.json(
        await authorizeLaunch(options, req, req.headers.origin, req.body),
      );
    } catch (error) {
      if (next) return next(error);
      return res.status(error.status || 502).json({
        error:
          error.status === 403 ? error.message : "Could not authorize DevLite.",
      });
    }
  };
}
/** Web-standard Request/Response adapter, suitable for Next.js route handlers. */
export function createDevLiteLaunchRoute(input) {
  const options = launchOptions(input);
  return async (request) => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    if (request.method !== "POST")
      return new Response(JSON.stringify({ error: "Use POST." }), {
        status: 405,
        headers: { ...headers, Allow: "POST" },
      });
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Provide a JSON object." }), {
        status: 400,
        headers,
      });
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return new Response(JSON.stringify({ error: "Provide a JSON object." }), {
        status: 400,
        headers,
      });
    try {
      return new Response(
        JSON.stringify(
          await authorizeLaunch(
            options,
            request,
            request.headers.get("origin"),
            body,
          ),
        ),
        { headers },
      );
    } catch (error) {
      return new Response(
        JSON.stringify({
          error:
            error.status === 403
              ? error.message
              : "Could not authorize DevLite.",
        }),
        { status: error.status || 502, headers },
      );
    }
  };
}

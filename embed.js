/** Browser helper. createLaunch calls YOUR authenticated backend, never the provider API. */
export function mountDevLite({
  container,
  providerId,
  dashboardUrl,
  createLaunch,
  onError = () => {},
  onReady = () => {},
  onStatusChange = () => {},
  theme = "system",
  height = 720,
  minHeight = 480,
  maxHeight = 1600,
  timeoutMs = 30000,
  title = "DevLite observability",
} = {}) {
  if (typeof window === "undefined" || typeof document === "undefined")
    throw new Error(
      "mountDevLite requires a browser. Mount it after your component is rendered.",
    );
  if (
    !container ||
    typeof container.appendChild !== "function" ||
    typeof createLaunch !== "function" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      providerId || "",
    )
  )
    throw new TypeError(
      "Provide a container, provider ID, and createLaunch callback.",
    );
  if ([onError, onReady, onStatusChange].some((fn) => typeof fn !== "function"))
    throw new TypeError("Embed callbacks must be functions.");
  if (!["light", "dark", "system"].includes(theme))
    throw new TypeError("Theme must be light, dark, or system.");
  if (
    ![height, minHeight, maxHeight].every(Number.isInteger) ||
    minHeight < 240 ||
    maxHeight > 2400 ||
    minHeight > height ||
    height > maxHeight
  )
    throw new TypeError(
      "Use integer frame heights with 240 <= minHeight <= height <= maxHeight <= 2400.",
    );
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw new TypeError("timeoutMs must be between 1 and 120000.");
  let base;
  try {
    base = new URL(dashboardUrl);
  } catch {
    throw new TypeError("Provide a valid DevLite dashboard URL.");
  }
  if (
    base.pathname !== "/" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.hostname.includes("*") ||
    !(
      base.protocol === "https:" ||
      (base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
    )
  )
    throw new TypeError(
      "Use HTTPS for the dashboard without credentials, query, or fragment; localhost HTTP is allowed.",
    );
  const url = new URL(`/embed/hosting/${providerId}`, base);
  url.searchParams.set("origin", window.location.origin);
  url.searchParams.set("theme", theme);
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.style.cssText = `display:block;width:100%;height:${height}px;border:0;border-radius:12px;`;
  let disposed = false,
    revision = 0,
    timer,
    controller,
    nonce = null,
    authorizationSent = false,
    status = "loading";
  const change = (next) => {
    status = next;
    onStatusChange(next);
  };
  const clear = () => {
    clearTimeout(timer);
    controller?.abort();
    controller = null;
  };
  const fail = (error) => {
    if (disposed) return;
    if (nonce && status === "authorizing")
      frame.contentWindow?.postMessage(
        { type: "devlite:authorization-error", providerId, nonce },
        url.origin,
      );
    clear();
    revision++;
    authorizationSent = false;
    change("error");
    onError(
      error instanceof Error ? error : new Error("DevLite could not connect."),
    );
  };
  const watch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        fail(
          new Error(
            "DevLite connection timed out. Check the dashboard URL, platform authorization, allowed origin, and frame-src policy.",
          ),
        ),
      timeoutMs,
    );
  };
  const listener = async (event) => {
    if (
      disposed ||
      event.origin !== url.origin ||
      event.source !== frame.contentWindow ||
      event.data?.providerId !== providerId
    )
      return;
    if (
      event.data.type === "devlite:resize" &&
      Number.isFinite(event.data.height)
    ) {
      frame.style.height = `${Math.max(minHeight, Math.min(maxHeight, event.data.height))}px`;
      return;
    }
    if (event.data.type === "devlite:connected") {
      if (
        !authorizationSent ||
        (event.data.nonce !== undefined && event.data.nonce !== nonce) ||
        status !== "authorizing"
      )
        return;
      clear();
      authorizationSent = false;
      change("connected");
      onReady();
      return;
    }
    if (event.data.type === "devlite:error") {
      fail(
        new Error(
          String(
            event.data.message || "Embedded DevLite could not connect.",
          ).slice(0, 500),
        ),
      );
      return;
    }
    if (
      event.data.type !== "devlite:ready" ||
      typeof event.data.nonce !== "string" ||
      !/^[a-zA-Z0-9_-]{16,128}$/.test(event.data.nonce) ||
      event.data.nonce === nonce
    )
      return;
    clear();
    nonce = event.data.nonce;
    authorizationSent = false;
    controller = new AbortController();
    const signal = controller.signal,
      current = ++revision;
    change("authorizing");
    watch();
    try {
      const launch = await createLaunch({
        nonce,
        parentOrigin: window.location.origin,
        signal,
      });
      if (disposed || revision !== current) return;
      if (
        typeof launch?.code !== "string" ||
        !/^[a-zA-Z0-9_-]{43}$/.test(launch.code)
      )
        throw new Error("Hosting backend did not return a valid launch code.");
      authorizationSent = true;
      frame.contentWindow?.postMessage(
        { type: "devlite:authorize", providerId, nonce, code: launch.code },
        url.origin,
      );
    } catch (error) {
      if (!disposed && revision === current) {
        fail(error);
      }
    }
  };
  window.addEventListener("message", listener);
  frame.src = url.toString();
  container.appendChild(frame);
  change("loading");
  watch();
  return {
    iframe: frame,
    get status() {
      return status;
    },
    reload() {
      if (disposed) throw new Error("This DevLite embed has been destroyed.");
      clear();
      revision++;
      nonce = null;
      authorizationSent = false;
      change("loading");
      watch();
      frame.src = url.toString();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      revision++;
      clear();
      window.removeEventListener("message", listener);
      frame.remove();
      change("destroyed");
    },
  };
}

import { mountDevLite } from "@devlite/hosting/embed";

/** Returns a handle; call destroy() when unmounting or signing out. */
export function mountMonitoring({
  container,
  providerId,
  dashboardUrl,
  launchPath,
  onError,
  onReady,
}) {
  const endpoint = new URL(launchPath, window.location.origin);
  if (endpoint.origin !== window.location.origin)
    throw new Error(
      "Use your console’s same-origin authenticated launch route.",
    );
  return mountDevLite({
    container,
    providerId,
    dashboardUrl,
    onError,
    onReady,
    createLaunch: async ({ nonce, parentOrigin, signal }) => {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce, parentOrigin }),
      });
      if (!response.ok)
        throw new Error(
          `Your platform could not authorize monitoring (${response.status}).`,
        );
      return response.json();
    },
  });
}

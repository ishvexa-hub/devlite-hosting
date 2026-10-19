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
  return mountDevLite({
    container,
    providerId,
    dashboardUrl,
    launchUrl: launchPath,
    onError,
    onReady,
  });
}

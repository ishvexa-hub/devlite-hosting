import { createDevLiteHostingIntegration } from "@devlite/hosting";

// Call once on your server. All callbacks use YOUR platform's current RBAC.
export function createMonitoring({ endpoint, credential, consoleOrigin, authenticate,
  findApplicationVisibleTo, mergeSecrets, saveMonitoringResource }) {
  return createDevLiteHostingIntegration({
    endpoint, credential, allowedOrigins: [consoleOrigin],
    authorize: async request => {
      const user = await authenticate(request);
      if (!user) return null;
      const id = new URL(request.url).searchParams.get("applicationId");
      if (!id) return null;
      const app = await findApplicationVisibleTo(user.id, id);
      return app?.devliteResourceId ? { resourceId: app.devliteResourceId, actorId: user.id } : null;
    },
    applyEnvironment: async ({application, resource, environmentVariables}) => {
      await mergeSecrets(application.externalResourceId, environmentVariables);
      await saveMonitoringResource(application.externalResourceId, resource.id);
    },
  });
}
// In a Next.js route: export const POST = monitoring.launchRoute;
// After checking monitoring-toggle permissions: await monitoring.enable(application);
// In the browser: mountDevLite({container, providerId, dashboardUrl,
//   launchUrl: `/api/monitoring/launch?applicationId=${encodeURIComponent(app.id)}`});

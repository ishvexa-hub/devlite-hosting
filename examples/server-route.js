import { createDevLiteLaunchRoute } from "@devlite/hosting";

/**
 * Use the returned handler as an App Router POST export or any Web Request route.
 * All callbacks run on your server and must use your platform's current RBAC.
 */
export function createMonitoringRoute({
  client,
  allowedOrigins,
  authenticate,
  findApplicationVisibleTo,
  canTriage = () => false,
}) {
  return createDevLiteLaunchRoute({
    client,
    allowedOrigins,
    authorize: async (request) => {
      const user = await authenticate(request);
      if (!user) return null;
      const applicationId = new URL(request.url).searchParams.get(
        "applicationId",
      );
      if (!applicationId) return null;
      const application = await findApplicationVisibleTo(
        user.id,
        applicationId,
      );
      if (!application?.devliteResourceId) return null;
      return {
        resourceId: application.devliteResourceId,
        actorId: user.id,
        permissions: (await canTriage(user, application))
          ? ["read", "triage"]
          : ["read"],
      };
    },
  });
}

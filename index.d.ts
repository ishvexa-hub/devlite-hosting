export type Resource = {
  id: string;
  projectId: string;
  customerId: string;
  externalResourceId: string;
  name: string;
  service: string;
  environment: string;
  status: "active" | "suspended" | "disconnected";
  createdAt: string;
};
export type EnvironmentVariables = {
  DEVLITE_API_KEY: string;
  DEVLITE_ENDPOINT: string;
  DEVLITE_SERVICE_NAME: string;
  DEVLITE_ENVIRONMENT: string;
};
export type LaunchInput = {
  parentOrigin: string;
  nonce: string;
  actorId: string;
  permissions?: ("read" | "triage")[];
  sessionSeconds?: number;
};
export type Launch = { code: string; expiresAt: string; embedUrl: string };
export class DevLiteHosting {
  constructor(options: {
    endpoint: string;
    credential: string;
    fetch?: typeof fetch;
    timeoutMs?: number;
    maxRetries?: number;
  });
  request<T = unknown>(
    path: string,
    options?: {
      method?: "GET" | "POST" | "PATCH";
      body?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<T>;
  listResourcePage(options?: ResourcePageOptions): Promise<ResourcePage>;
  iterateResources(
    options?: ResourcePageOptions,
  ): AsyncGenerator<Resource, void, unknown>;
  provision(input: {
    customerId: string;
    externalResourceId: string;
    name: string;
    service?: string;
    environment?: string;
  }): Promise<
    Resource & { created: boolean; environmentVariables: EnvironmentVariables }
  >;
  listResources(customerId?: string): Promise<Resource[]>;
  getResource(id: string): Promise<Resource>;
  environment(id: string): Promise<{
    resource: Resource;
    environmentVariables: EnvironmentVariables;
  }>;
  setStatus(id: string, status: Resource["status"]): Promise<Resource>;
  rotateIngestKey(id: string): Promise<{
    resource: Resource;
    environmentVariables: EnvironmentVariables;
  }>;
  reportDeployment(
    id: string,
    input: { version: string; commitSha?: string; notes?: string },
  ): Promise<{ accepted: number; resourceId: string }>;
  revokeSessions(id: string): Promise<{ revoked: boolean; resourceId: string }>;
  createLaunch(id: string, input: LaunchInput): Promise<Launch>;
}
export function createDevLiteLaunchHandler(options: {
  client: DevLiteHosting;
  allowedOrigins: string[];
  authorize: (req: any) => Promise<{
    resourceId: string;
    actorId: string;
    permissions?: ("read" | "triage")[];
    sessionSeconds?: number;
  } | null>;
}): (req: any, res: any, next?: (error: unknown) => void) => Promise<unknown>;

export class DevLiteHostingError extends Error {
  readonly code:
    | "HTTP_ERROR"
    | "NETWORK_ERROR"
    | "INVALID_RESPONSE"
    | "TIMEOUT"
    | "ABORTED"
    | "ACCESS_DENIED";
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  constructor(
    message: string,
    options?: {
      code?: DevLiteHostingError["code"];
      status?: number;
      requestId?: string;
      retryAfterMs?: number;
    },
  );
}
export type ResourcePage = { items: Resource[]; nextCursor: string | null };
export type ResourcePageOptions = {
  customerId?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
};
export type LaunchGrant = {
  resourceId: string;
  actorId: string;
  permissions?: ("read" | "triage")[];
  sessionSeconds?: number;
};
/** Adapts Web Request/Response servers, including Next.js App Router. */
export function createDevLiteLaunchRoute<R extends Request = Request>(options: {
  client: DevLiteHosting;
  allowedOrigins: string[];
  authorize: (request: R) => Promise<LaunchGrant | null>;
}): (request: R) => Promise<Response>;

# DevLite for hosting platforms

[Source repository](https://github.com/ishvexa-hub/devlite-hosting) · [Integration documentation](https://devlite.ishvexa.rw/docs#hosting) · [Issues](https://github.com/ishvexa-hub/devlite-hosting/issues)

The standalone source for `@devlite/hosting`. The SDK has no runtime dependencies, supports Node.js 18+, and separates the server provisioning client from its browser embed entry point.

A hosting platform can provision DevLite per customer application and embed observability in its existing dashboard. Customers use their hosting account; no separate DevLite account or third-party cookie is needed for the embedded view.

This is a generic provider integration. Vendor-specific marketplace registration, app approval, build-layer installation and production deployment are separate platform work.

## 1. Register the provider

In DevLite, open **Configuration → Hosting integrations**. Register the platform name and exact dashboard origins, for example `https://console.example.com`. HTTPS is required except on localhost. Wildcards, credentials, query strings and URL paths are rejected.

Save the displayed `dlhp_…` credential as `DEVLITE_HOSTING_CREDENTIAL` **on your backend only**. It controls resources belonging to this provider. It is not an SDK ingest key or a customer session. DevLite stores its hash and shows it once. Rotation invalidates the old credential and all existing launch codes/embedded sessions.

The DevLite API must run with PostgreSQL and these public URL settings:

```text
BASE_URL=https://YOUR_DEVLITE_API
FRONTEND_URL=https://YOUR_DEVLITE_DASHBOARD
```

The dashboard uses `NEXT_PUBLIC_INGEST_API_URL=https://YOUR_DEVLITE_API`. `FRONTEND_URL` must match the browser-facing dashboard origin. In production the provider APIs return a configuration error until it is set.

## 2. Install and provision

Install directly from the source repository:

```bash
npm install git+https://github.com/ishvexa-hub/devlite-hosting.git
```

The installed package is named `@devlite/hosting`. Pin a reviewed commit in production (`git+https://github.com/ishvexa-hub/devlite-hosting.git#COMMIT_SHA`) or install a tarball generated with `npm pack`. Registry publication is separate; this guide does not assume an npm release exists.

```js
// Your hosting backend; never import this credential-bearing client in a browser.
import { DevLiteHosting } from '@devlite/hosting';

const devlite = new DevLiteHosting({
  endpoint: process.env.DEVLITE_API_URL,
  credential: process.env.DEVLITE_HOSTING_CREDENTIAL,
});

const resource = await devlite.provision({
  customerId: account.id,                    // from your trusted hosting account
  externalResourceId: installation.id,        // stable across retries of this installation
  name: application.name,
  service: application.slug,
  environment: 'production',
});

// Persist resource.id against the installation in YOUR database.
await saveInstallationResource(installation.id, resource.id);
// Use your platform's encrypted runtime environment/secret manager.
await injectApplicationEnvironment(application.id, resource.environmentVariables);
```

The `(provider, customerId, externalResourceId)` tuple is idempotent, including concurrent retries. Separate customers get separate DevLite projects even if they use the same external application ID. A repeat provision request returns the original resource/configuration and does not rename it or silently resume it. Backend responses containing environment variables are secrets; do not forward them to the dashboard or log the response object.

Injected variables are `DEVLITE_API_KEY`, `DEVLITE_ENDPOINT`, `DEVLITE_SERVICE_NAME`, and `DEVLITE_ENVIRONMENT`. SDK initialization still needs to run in the application. The source SDKs honor `DEVLITE_ENDPOINT`; explicit SDK configuration takes precedence. Publish the updated SDK versions before relying on this behavior in external applications using older releases.

Node hosts can install `@devlite/nodejs` and append this opt-in preload to the application's existing `NODE_OPTIONS`:

```text
--require @devlite/nodejs/register
```

The preload initializes only when `DEVLITE_API_KEY` exists. Do not replace other `NODE_OPTIONS` flags. Alternatively call `devlite.init()` from application startup. For Next.js use `DevLite.register()` in `instrumentation.ts`. Python, Go, Java and .NET applications still need their normal DevLite initialization/framework middleware. A hosting integration cannot instrument a runtime where the SDK has not been installed or initialized.

## 3. Launch using your current hosting permissions

Your backend must authenticate the hosting user and resolve the application through your own RBAC on **every launch and refresh**. Do not authorize an arbitrary resource ID or permissions supplied by the browser. The adapter below rejects unexpected request origins before requesting a launch code.

```js
import { createDevLiteLaunchHandler } from '@devlite/hosting';

app.post('/api/apps/:appId/devlite/launch', requireHostingLogin,
  createDevLiteLaunchHandler({
    client: devlite,
    allowedOrigins: ['https://console.example.com'],
    authorize: async req => {
      // Your existing authorization: verifies this user can access this app.
      const app = await findApplicationVisibleTo(req.user, req.params.appId);
      if (!app?.devliteResourceId) return null;
      return {
        resourceId: app.devliteResourceId,
        actorId: req.user.id,
        permissions: canManageIncidents(req.user, app) ? ['read', 'triage'] : ['read'],
        sessionSeconds: 900,
      };
    },
  })
);
```

`requireHostingLogin`, `findApplicationVisibleTo`, `canManageIncidents`, secret injection and installation persistence are integration points with your hosting platform, not functions supplied by DevLite. Use your normal JSON parser and authentication/CSRF handling. A Next.js or non-Express backend can call `devlite.createLaunch(resourceId, {parentOrigin, nonce, actorId, permissions})` directly after the same checks.

A launch code expires after **60 seconds**, is single-use, and binds the provider, resource, actor, exact parent origin, frame-generated nonce, permissions, and current revocation generations. Read-only is the default. `triage` additionally permits marking that resource's issues open/resolved/ignored. Embedded tokens cannot call account administration, provisioning, SDK-key retrieval or the regular DevLite APIs.

## 4. Embed in the hosting dashboard

```js
// Browser bundle: no provider credential here.
import { mountDevLite } from '@devlite/hosting/embed';

const embedded = mountDevLite({
  container: document.querySelector('#devlite'),
  providerId: 'YOUR_PROVIDER_ID',
  dashboardUrl: 'https://YOUR_DEVLITE_DASHBOARD',
  theme: 'system', // or light / dark
  createLaunch: async ({ nonce, parentOrigin }) => {
    const response = await fetch(`/api/apps/${applicationId}/devlite/launch`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({nonce, parentOrigin}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Application access denied');
    return response.json();
  },
  onReady: () => console.log('DevLite connected'),
  onError: error => showIntegrationError(error.message),
});

// On app navigation, logout or unmount:
embedded.destroy();
```

For React, call `mountDevLite` in an effect and return `embedded.destroy` from its cleanup. Recreate the instance when the selected application changes. The helper creates a sandboxed iframe, verifies message origin **and frame source**, and responds only to that frame's current nonce. Codes are exchanged via exact-origin `postMessage`; neither provider credentials nor session tokens are put in URLs. Session tokens live only in iframe memory, with credential-omitting fetches and no cookies/localStorage/sessionStorage. Sessions default to 15 minutes (allowed 60–1800 seconds); refresh requests a new launch through your authorization route 30 seconds before expiration.

DevLite's frame policy is set server-side to the selected approved parent origin. Unapproved, disabled, missing or unavailable integrations fail closed. The regular DevLite application keeps its framing prohibition. Any upstream CDN/reverse proxy must preserve the embed CSP and must not add a blanket `X-Frame-Options: DENY` to `/embed/hosting/*`. The embedded page does not read the native DevLite account session, and omits analytics scripts and service-worker registration. Your own dashboard CSP must also allow the DevLite dashboard in `frame-src`, and its backend must allow authenticated launch requests from the console origin.

The embedded UI includes 24-hour traffic/HTTP failure-rate/p95 metrics, telemetry connection state, grouped errors, stack/source context, linked traces, release comparisons, and configured business workflows. Counts and comparisons retain their normal coverage/sample warnings. The optional triage permission enables issue status changes. Full account settings, workflow configuration, integrations and administration remain in the native DevLite dashboard for the integration owner.

## 5. Deployments and lifecycle

```js
// At application deployment, inject the same version into the SDK's runtime.
await injectApplicationEnvironment(application.id, {DEVLITE_RELEASE: commit.sha});
await devlite.reportDeployment(resource.id, {version: commit.sha, commitSha: commit.sha});

await devlite.setStatus(resource.id, 'suspended');   // block ingest + embed, keep data
await devlite.setStatus(resource.id, 'active');      // explicit resume; request fresh sessions
await devlite.revokeSessions(resource.id);          // invalidate all frame sessions/codes for this app
const rotated = await devlite.rotateIngestKey(resource.id);
await injectApplicationEnvironment(application.id, rotated.environmentVariables);
await devlite.setStatus(resource.id, 'disconnected'); // terminal installation, rotates key, keeps retained data
```

Call `revokeSessions` when hosting application access changes and you need revocation before token expiry. It revokes all viewers for that resource; authorized users can immediately reauthorize. Destroying the iframe on logout discards its in-memory token but does not invalidate a token already copied elsewhere; server revocation or expiry handles that case.

Suspension/disable/revocation are checked in PostgreSQL on each request. Hosted ingest-key resolution bypasses normal key caches so another API replica cannot keep accepting a suspended resource. Provider disable blocks all its managed ingest keys and embedded sessions. Changing allowed origins also revokes existing sessions. Resuming a resource does not revive old embedded sessions.

Use suspension for a reversible toggle. Disconnect is terminal for that installation and does not purge diagnostic history. A reinstall uses a new installation/external resource ID. Data follows the project's normal retention; account owners can still manage it in native DevLite. Provider records are disabled rather than deleted.

## HTTP API

Provider setup uses a normal DevLite user session. Provider operations use `Authorization: Bearer dlhp_…`. Embedded data uses the exchanged `dlhe_…` token. Responses use `Cache-Control: no-store`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/v1/hosting/providers` | List own providers / register |
| PATCH | `/v1/hosting/providers/:id` | Update origins or enable/disable |
| POST | `/v1/hosting/providers/:id/rotate` | Rotate server credential; revoke sessions |
| GET | `/v1/hosting/providers/:id/resources` | Owner's resource inventory |
| GET | `/v1/hosting/providers/:id/public` | Non-secret frame configuration |
| POST / GET | `/v1/hosting/resources` | Idempotent provision / inventory (latest 200; optional customerId filter) |
| GET / PATCH | `/v1/hosting/resources/:id` | Metadata / lifecycle status |
| GET | `/v1/hosting/resources/:id/environment` | Backend-only ingest configuration |
| POST | `/v1/hosting/resources/:id/rotate-key` | Rotate application ingest secret |
| POST | `/v1/hosting/resources/:id/deployments` | Queue a deployment through normal ingest |
| POST | `/v1/hosting/resources/:id/launch` | Create a frame-bound launch code |
| POST | `/v1/hosting/resources/:id/revoke-sessions` | Revoke all codes/sessions for this application |
| POST | `/v1/hosting/embed/exchange` | Atomic single-use exchange from DevLite's dashboard origin |
| GET | `/v1/hosting/embed/data/overview` | Resource-scoped metrics and connection state |
| GET | `/v1/hosting/embed/data/issues` | Up to 50 open issues |
| GET / PATCH | `/v1/hosting/embed/data/issues/:fingerprint` | Evidence / optional triage |
| GET | `/v1/hosting/embed/data/traces/:traceId` | Up to 100 curated trace events |
| GET | `/v1/hosting/embed/data/releases` | Latest ten release comparisons |
| GET | `/v1/hosting/embed/data/workflows` | Configured workflow reliability |

Persist resource IDs when provisioning and use direct resource endpoints for reconciliation. Lists are bounded and do not expose server or ingest credentials. Expired launch/session rows are removed by the API's scheduled housekeeping after a one-day grace period; expiry is enforced independently on every request.

## Reliability and integration controls

```js
import { DevLiteHosting, DevLiteHostingError } from '@devlite/hosting';
const client = new DevLiteHosting({
  endpoint: process.env.DEVLITE_API_URL,
  credential: process.env.DEVLITE_HOSTING_CREDENTIAL,
  timeoutMs: 15_000,
  maxRetries: 1,
});
try {
  const environment = await client.environment(resourceId);
  // Securely inject environment.environmentVariables into the application.
} catch (error) {
  if (error instanceof DevLiteHostingError) {
    // Record code/status/requestId; never log provider or ingest credentials.
    console.error(error.code, error.status, error.requestId);
  }
}
```

GET requests can retry network errors and HTTP 429/502/503/504. `Retry-After` is respected within the overall request deadline, including waits and response parsing. POST/PATCH operations are never retried automatically; a lost response can still mean the server completed an operation. Reconcile through resource lookup before retrying lifecycle actions. `maxRetries` accepts 0–3. Errors expose `code`, optional `status`, `requestId`, and `retryAfterMs`; malformed/HTML responses become bounded SDK errors instead of JSON parser exceptions. `client.request(path, {signal})` and inventory methods accept caller cancellation.

### Inventory without a 200-resource ceiling

```js
for await (const resource of client.iterateResources({customerId: account.id, limit: 100})) {
  await reconcileInstallation(resource);
}
// Or store page.nextCursor for a user-driven list:
const page = await client.listResourcePage({customerId: account.id, limit: 50});
```

Pagination requires an updated DevLite API. Cursors retain provider and customer scope and use creation time plus resource ID for a stable order. This is a live inventory rather than a snapshot: new resources created during traversal may appear on the next fresh traversal. The legacy `listResources(customerId)` still returns at most 200 resources for older integrations. Use saved resource IDs for direct reconciliation.

### Web-standard servers and Next.js

`createDevLiteLaunchRoute({client, allowedOrigins, authorize})` returns `(Request) => Promise<Response>`. Export it as `POST` in a Next.js App Router route or use it in another Web Request server. The `authorize(request)` callback must authenticate the hosting user and load the application through current server-side permissions on **every call**. It returns `{resourceId, actorId, permissions, sessionSeconds}` or `null`. Browser-provided resource IDs or permission arrays never determine the grant.

See [the server route factory](examples/server-route.js) and [the browser integration](examples/browser.js). Supply your platform's existing authentication and resource-authorization callbacks. Preserve your normal session and CSRF protections. Provider credentials remain exclusively in server code.

### Embed lifecycle

```js
const view = mountDevLite({
  container, providerId, dashboardUrl,
  height: 800, minHeight: 480, maxHeight: 1600,
  timeoutMs: 30_000,
  onStatusChange(status) { updateConnectionIndicator(status); },
  onError(error) { showConnectionError(error.message); },
  createLaunch: async ({nonce, parentOrigin, signal}) => {
    const response = await fetch('/api/monitoring/launch?applicationId=' + encodeURIComponent(application.id), {
      method: 'POST', credentials: 'same-origin', signal,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({nonce, parentOrigin}),
    });
    if (!response.ok) throw new Error('Your platform could not authorize monitoring.');
    return response.json();
  },
});
view.reload();  // Fresh frame and RBAC handshake after a user requests retry.
view.destroy(); // Call on unmount and logout; safe to call more than once.
```

States are `loading`, `authorizing`, `connected`, `error`, and `destroyed`. The watchdog remains active while the backend creates a launch code and until the iframe confirms connection. Duplicate ready messages are ignored, and stale asynchronous results cannot authorize a reloaded or destroyed frame. Forward the callback's `signal` to your fetch to cancel pending work. Reload discards the frame's token and rechecks authorization; revoke server sessions when access changes to invalidate previously issued tokens immediately. Optional nonce echoes from newer dashboards are checked; older dashboards remain compatible.

## Development and validation

```bash
git clone https://github.com/ishvexa-hub/devlite-hosting.git
cd devlite-hosting
npm ci --ignore-scripts
npm test
npm run check
npm pack --dry-run
```

Tests cover request retries and deadlines, cancellation, malformed responses, pagination, current server authorization, forged origins, iframe source binding, reload, duplicate messages, timeouts, and cleanup. CI checks Node.js 18, 20, 22, and 24. The DevLite API and dashboard live in the [application repository](https://github.com/Ishimwe-Kevin/devlite-app); its PostgreSQL/HTTP acceptance tests additionally cover provisioning, isolation, one-use exchange, revocation, expiry, and lifecycle changes. Real hosting-platform registration and deployment require acceptance testing in that platform.

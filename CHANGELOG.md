# Changelog

## 0.2.0

- Standalone source repository: https://github.com/ishvexa-hub/devlite-hosting.
- Typed request errors, overall deadlines, cancellation, and bounded retries for safe GET requests. State-changing requests are not retried automatically.
- Web-standard launch route adapter for Next.js and other Request/Response servers, alongside the Express adapter.
- Paginated resource inventory and async iteration. Requires a DevLite API deployment with the paginated hosting endpoint.
- Embed status callbacks, adjustable frame dimensions, explicit reload, and cancellation on timeout or destroy.
- Duplicate readiness messages no longer create extra launch codes. The connection deadline remains active through authorization; late launch codes are ignored.
- Added declarations, examples, package checks, and CI.

## 0.1.0

Initial provider client, Express launch adapter, and browser embed helper maintained in the DevLite application repository.

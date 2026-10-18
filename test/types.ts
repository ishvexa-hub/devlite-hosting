import {
  DevLiteHosting,
  DevLiteHostingError,
  createDevLiteLaunchRoute,
  createDevLiteLaunchHandler,
  type ResourcePage,
} from "../index.js";
import { mountDevLite, type EmbedStatus } from "../embed.js";
const client = new DevLiteHosting({
  endpoint: "https://api.example.test",
  credential: "server-only",
  maxRetries: 2,
});
const page: Promise<ResourcePage> = client.listResourcePage({
  limit: 50,
  signal: new AbortController().signal,
});
void page;
async function inventory() {
  for await (const resource of client.iterateResources({
    customerId: "customer",
  })) {
    const name: string = resource.name;
    void name;
  }
}
void inventory;
const route = createDevLiteLaunchRoute({
  client,
  allowedOrigins: ["https://console.example.test"],
  authorize: async (request: Request) => {
    void request;
    return { resourceId: "id", actorId: "trusted-user", permissions: ["read"] };
  },
});
const result: Promise<Response> = route(
  new Request("https://console.example.test/launch"),
);
void result;
createDevLiteLaunchHandler({
  client,
  allowedOrigins: ["https://console.example.test"],
  authorize: async () => ({ resourceId: "id", actorId: "user" }),
});
function browser(container: HTMLElement) {
  const embed = mountDevLite({
    container,
    providerId: "11111111-1111-4111-8111-111111111111",
    dashboardUrl: "https://dashboard.example.test",
    height: 800,
    onStatusChange(status: EmbedStatus) {
      void status;
    },
    createLaunch: async ({ signal }) => {
      const response = await fetch("/launch", { method: "POST", signal });
      return response.json() as Promise<{ code: string }>;
    },
  });
  embed.reload();
  const status: EmbedStatus = embed.status;
  void status;
  embed.destroy();
}
void browser;
const error = new DevLiteHostingError("Failure", { code: "TIMEOUT" });
const code: string = error.code;
void code;
client.createLaunch("id", {
  parentOrigin: "https://console.example.test",
  nonce: "nonce",
  actorId: "user",
  // @ts-expect-error Unsupported permission must not be granted through the SDK.
  permissions: ["admin"],
});

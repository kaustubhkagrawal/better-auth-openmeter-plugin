import { describe, expect, it, vi } from "vitest";
import {
  apiKeyAdapter,
  openmeterApiKeyAdapter,
} from "../src/adapters/api-key";

function makeClient() {
  return {
    events: {
      ingest: vi.fn().mockResolvedValue(undefined),
    },
    customers: {
      entitlements: {
        create: vi.fn().mockResolvedValue({ id: "ent_123" }),
      },
    },
    portal: {},
  };
}

function makeCtx(overrides?: {
  returned?: unknown;
  client?: ReturnType<typeof makeClient>;
}) {
  const client = overrides?.client ?? makeClient();
  const loggerError = vi.fn();

  return {
    path: "/api-key/verify",
    context: {
      returned:
        overrides?.returned ??
        {
          valid: true,
          key: {
            id: "key_123",
            name: "Production",
            start: "sk_live",
            referenceId: "user_123",
            configId: "default",
            remaining: 99,
            requestCount: 1,
            rateLimitEnabled: true,
            rateLimitMax: 100,
            rateLimitTimeWindow: 60000,
            permissions: { usage: ["ingest"] },
            metadata: { env: "prod" },
          },
        },
      getPlugin: (id: string) =>
        id === "openmeter"
          ? {
              options: {
                openmeterClient: client,
              },
            }
          : null,
      logger: {
        error: loggerError,
      },
    },
    loggerError,
    client,
  } as any;
}

describe("openmeterApiKeyAdapter", () => {
  it("exports the compatibility alias", () => {
    expect(apiKeyAdapter).toBe(openmeterApiKeyAdapter);
  });

  it("requires OpenMeter and API key plugins by default", () => {
    const adapter = openmeterApiKeyAdapter();

    expect(() =>
      adapter.init?.({ hasPlugin: (id: string) => id === "openmeter" } as any),
    ).toThrow("openmeterApiKeyAdapter requires @better-auth/api-key.");

    expect(() =>
      adapter.init?.({ hasPlugin: (id: string) => id === "api-key" } as any),
    ).toThrow("OpenMeter adapters require openmeterPlugin().");

    expect(() =>
      adapter.init?.({
        hasPlugin: (id: string) => id === "api-key" || id === "openmeter",
      } as any),
    ).not.toThrow();
  });

  it("ingests an event for successful API key verification", async () => {
    const client = makeClient();
    const onEventIngested = vi.fn();
    const adapter = openmeterApiKeyAdapter({ onEventIngested });
    const hook = adapter.hooks?.after?.[0];
    if (!hook) throw new Error("Expected API key adapter hook");
    const ctx = makeCtx({ client });

    expect(hook.matcher({ path: "/api-key/verify" } as any)).toBe(true);
    expect(hook.matcher({ path: "/api-key/create" } as any)).toBe(false);

    await hook.handler(ctx);

    expect(client.events.ingest).toHaveBeenCalledWith({
      specversion: "1.0",
      source: "better-auth",
      type: "better-auth.api-key.verified",
      subject: "user_123",
      data: expect.objectContaining({
        apiKeyId: "key_123",
        apiKeyName: "Production",
        referenceId: "user_123",
        remaining: 99,
      }),
    });
    expect(onEventIngested).toHaveBeenCalledOnce();
  });

  it("skips invalid verification results", async () => {
    const client = makeClient();
    const adapter = openmeterApiKeyAdapter();
    const hook = adapter.hooks?.after?.[0];
    if (!hook) throw new Error("Expected API key adapter hook");

    await hook.handler(
      makeCtx({
        client,
        returned: {
          valid: false,
          key: null,
        },
      }),
    );

    expect(client.events.ingest).not.toHaveBeenCalled();
  });

  it("supports custom subject and event builders", async () => {
    const client = makeClient();
    const adapter = openmeterApiKeyAdapter({
      resolveSubject: ({ apiKey }) => `api-key:${apiKey.id}`,
      buildEvent: ({ subject }) => ({
        type: "custom.api-key.request",
        subject,
        data: { units: 1 },
      }),
    });
    const hook = adapter.hooks?.after?.[0];
    if (!hook) throw new Error("Expected API key adapter hook");

    await hook.handler(makeCtx({ client }));

    expect(client.events.ingest).toHaveBeenCalledWith({
      type: "custom.api-key.request",
      subject: "api-key:key_123",
      data: { units: 1 },
    });
  });

  it("logs and swallows ingestion failures by default", async () => {
    const client = makeClient();
    const error = new Error("OpenMeter down");
    client.events.ingest.mockRejectedValue(error);
    const onError = vi.fn();
    const adapter = openmeterApiKeyAdapter({ onError });
    const hook = adapter.hooks?.after?.[0];
    if (!hook) throw new Error("Expected API key adapter hook");
    const ctx = makeCtx({ client });

    await hook.handler(ctx);

    expect(onError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ operation: "api-key-verify-event" }),
      expect.objectContaining({ path: "/api-key/verify" }),
    );
    expect(ctx.loggerError).toHaveBeenCalledWith(
      "OpenMeter API key adapter failed: OpenMeter down",
    );
  });
});

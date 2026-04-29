import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openmeter, openmeterPlugin } from "../src/index";

const user = {
  id: "user_123",
  email: "test@example.com",
  name: "Test User",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeClient(overrides?: {
  customer?: Record<string, unknown> | null;
  customerId?: string;
}) {
  const customer =
    overrides && "customer" in overrides
      ? overrides.customer
      : {
          id: overrides?.customerId ?? "cus_123",
          key: "user_123",
        };

  return {
    customers: {
      get: vi.fn().mockResolvedValue(customer),
      create: vi.fn().mockResolvedValue({
        id: overrides?.customerId ?? "cus_123",
        key: "user_123",
      }),
      update: vi.fn().mockResolvedValue({
        id: overrides?.customerId ?? "cus_123",
        key: "user_123",
      }),
      getAccess: vi.fn().mockResolvedValue({
        entitlements: {
          ai_tokens: { hasAccess: true, balance: 100 },
        },
      }),
      entitlements: {
        list: vi.fn().mockResolvedValue({ items: [] }),
        value: vi.fn().mockResolvedValue({ hasAccess: true, balance: 50 }),
      },
    },
    events: {
      ingest: vi.fn().mockResolvedValue(undefined),
    },
    portal: {},
  };
}

function makeCtx(overrides?: {
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  sessionUser?: Record<string, unknown> | null;
}) {
  const updateUser = vi.fn().mockResolvedValue(undefined);
  const adapterUpdate = vi.fn().mockResolvedValue(undefined);
  const loggerError = vi.fn();

  return {
    body: overrides?.body ?? {},
    query: overrides?.query ?? {},
    context: {
      session:
        overrides?.sessionUser === null
          ? undefined
          : {
              user: {
                ...user,
                ...overrides?.sessionUser,
              },
            },
      internalAdapter: {
        updateUser,
      },
      adapter: {
        update: adapterUpdate,
      },
      logger: {
        error: loggerError,
      },
    },
    updateUser,
    adapterUpdate,
    loggerError,
  } as any;
}

describe("openmeter plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports the compatibility alias", () => {
    expect(openmeterPlugin).toBe(openmeter);
  });

  it("throws when no SDK client or connection config is provided", () => {
    expect(() => openmeter({} as any)).toThrow(
      "Provide openmeterClient or apiKey/baseUrl for OpenMeter.",
    );
  });

  it("builds the expected plugin contract", () => {
    const plugin = openmeter({ openmeterClient: makeClient() as any });

    expect(plugin.id).toBe("openmeter");
    expect(plugin.schema).toHaveProperty("user");
    expect(Object.keys(plugin.endpoints)).toEqual([
      "ingestOpenMeterEvent",
      "syncOpenMeterCustomer",
      "getOpenMeterCustomer",
      "getOpenMeterCustomerAccess",
      "listOpenMeterEntitlements",
      "getOpenMeterEntitlementValue",
    ]);
  });

  it("allows public event ingestion only with an explicit subject", async () => {
    const client = makeClient();
    const plugin = openmeter({
      openmeterClient: client as any,
      requireSession: false,
      eventSource: "api-gateway",
    });

    await plugin.endpoints.ingestOpenMeterEvent(
      makeCtx({
        sessionUser: null,
        body: {
          type: "request",
          subject: "customer_123",
          data: { route: "/v1/messages" },
        },
      }),
    );

    expect(client.events.ingest).toHaveBeenCalledWith({
      specversion: "1.0",
      source: "api-gateway",
      subject: "customer_123",
      type: "request",
      data: { route: "/v1/messages" },
    });

    await expect(
      plugin.endpoints.ingestOpenMeterEvent(
        makeCtx({
          sessionUser: null,
          body: {
            type: "request",
            data: { route: "/v1/messages" },
          },
        }),
      ),
    ).rejects.toMatchObject({
      status: "UNAUTHORIZED",
    });
  });

  it("runs create database hooks for customer sync and auth events", async () => {
    const client = makeClient({ customer: null, customerId: "cus_new" });
    const onCustomerSynced = vi.fn();
    const plugin = openmeter({
      openmeterClient: client as any,
      createCustomerOnSignUp: true,
      trackAuthEvents: true,
      customer: {
        currency: "USD",
        metadata: { plan: "starter" },
      },
      callbacks: { onCustomerSynced },
    });
    const ctx = makeCtx();

    await plugin.options.databaseHooks.user.create.after(user as any, ctx);

    expect(client.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test User",
        key: "user_123",
        primaryEmail: "test@example.com",
        usageAttribution: { subjectKeys: ["user_123"] },
        currency: "USD",
        metadata: expect.objectContaining({
          betterAuthUserId: "user_123",
          betterAuthEmail: "test@example.com",
          plan: "starter",
        }),
      }),
    );
    expect(ctx.updateUser).toHaveBeenCalledWith("user_123", {
      openmeterCustomerId: "cus_new",
    });
    expect(onCustomerSynced).toHaveBeenCalledOnce();
    expect(client.events.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "better-auth.user.created",
        subject: "user_123",
      }),
    );
  });

  it("runs update database hooks for customer sync and skips duplicate id storage", async () => {
    const client = makeClient({ customerId: "cus_existing" });
    const plugin = openmeter({
      openmeterClient: client as any,
      syncCustomerOnUserUpdate: true,
    });
    const ctx = makeCtx();

    await plugin.options.databaseHooks.user.update.after(
      {
        ...user,
        openmeterCustomerId: "cus_existing",
      },
      ctx,
    );

    expect(client.customers.update).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        key: "user_123",
        usageAttribution: { subjectKeys: ["user_123"] },
      }),
    );
    expect(ctx.updateUser).not.toHaveBeenCalled();
  });

  it("declares protected customer and entitlement endpoint methods", () => {
    const plugin = openmeter({ openmeterClient: makeClient() as any });

    expect(plugin.endpoints.getOpenMeterCustomer.path).toBe(
      "/openmeter/customer",
    );
    expect(plugin.endpoints.getOpenMeterCustomer.options.method).toBe("GET");
    expect(plugin.endpoints.getOpenMeterCustomerAccess.path).toBe(
      "/openmeter/customer/access",
    );
    expect(plugin.endpoints.listOpenMeterEntitlements.path).toBe(
      "/openmeter/entitlements",
    );
    expect(plugin.endpoints.getOpenMeterEntitlementValue.path).toBe(
      "/openmeter/entitlement/value",
    );
  });

  it("ingests auth events from the sign-in/sign-up after hook", async () => {
    const client = makeClient();
    const plugin = openmeter({
      openmeterClient: client as any,
      trackAuthEvents: true,
    });
    const hook = plugin.hooks.after[0];
    expect(hook).toBeDefined();
    if (!hook) throw new Error("Expected OpenMeter after hook");

    expect(hook.matcher({ path: "/sign-in/email" } as any)).toBe(true);
    expect(hook.matcher({ path: "/session" } as any)).toBe(false);

    await hook.handler({
      path: "/sign-in/email",
      context: {
        newSession: { user },
        logger: { error: vi.fn() },
      },
    } as any);

    expect(client.events.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "better-auth.user.signed-in",
        subject: "user_123",
      }),
    );
  });

  it("logs hook failures by default and calls onError", async () => {
    const error = new Error("OpenMeter unavailable");
    const client = makeClient();
    client.customers.get.mockRejectedValue(error);
    const onError = vi.fn();
    const plugin = openmeter({
      openmeterClient: client as any,
      createCustomerOnSignUp: true,
      callbacks: { onError },
    });
    const ctx = makeCtx();

    await plugin.options.databaseHooks.user.create.after(user as any, ctx);

    expect(onError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ operation: "user-create-hook" }),
      ctx,
    );
    expect(ctx.loggerError).toHaveBeenCalledWith(
      "OpenMeter user-create-hook failed: OpenMeter unavailable",
    );
  });

  it("can rethrow hook failures when configured", async () => {
    const error = new Error("OpenMeter unavailable");
    const client = makeClient();
    client.customers.get.mockRejectedValue(error);
    const plugin = openmeter({
      openmeterClient: client as any,
      createCustomerOnSignUp: true,
      failOnOpenMeterError: true,
    });

    await expect(
      plugin.options.databaseHooks.user.create.after(user as any, makeCtx()),
    ).rejects.toThrow(error);
  });

  it("throws APIError when a session-only endpoint has no session", async () => {
    const plugin = openmeter({ openmeterClient: makeClient() as any });

    await expect(
      plugin.endpoints.getOpenMeterCustomer(makeCtx({ sessionUser: null })),
    ).rejects.toBeInstanceOf(APIError);
  });
});

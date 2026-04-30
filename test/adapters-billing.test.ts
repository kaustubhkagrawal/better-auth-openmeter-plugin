import { describe, expect, it, vi } from "vitest";
import {
  applyCatalogTopupGrant,
  applyOpenMeterBillingEvent,
  billingAdapter,
  openmeterBillingAdapter,
} from "../src/adapters/billing";
import { defineBillingCatalog } from "../src/catalog";

function makeClient() {
  return {
    events: {
      ingest: vi.fn().mockResolvedValue(undefined),
    },
    customers: {
      entitlements: {
        create: vi.fn().mockResolvedValue({ id: "ent_123" }),
        createGrant: vi.fn().mockResolvedValue({ id: "grant_123" }),
      },
    },
    portal: {},
  };
}

function makeCtx(client = makeClient()) {
  return {
    context: {
      getPlugin: (id: string) =>
        id === "openmeter"
          ? {
              options: {
                openmeterClient: client,
              },
            }
          : null,
      logger: {
        error: vi.fn(),
      },
    },
    client,
  } as any;
}

describe("openmeterBillingAdapter", () => {
  it("exports the compatibility alias", () => {
    expect(billingAdapter).toBe(openmeterBillingAdapter);
  });

  it("requires the core OpenMeter plugin by default", () => {
    const adapter = openmeterBillingAdapter();

    expect(() =>
      adapter.init?.({ hasPlugin: () => false } as any),
    ).toThrow("OpenMeter adapters require openmeterPlugin().");

    expect(() =>
      adapter.init?.({ hasPlugin: (id: string) => id === "openmeter" } as any),
    ).not.toThrow();
  });

  it("passes through provider plugin hooks and endpoints", () => {
    const provider = {
      id: "test-provider",
      plugin: {
        id: "provider-plugin",
        endpoints: { testEndpoint: vi.fn() as any },
        hooks: { after: [] },
      },
    };
    const adapter = openmeterBillingAdapter({ provider });

    expect(adapter.endpoints).toBe(provider.plugin.endpoints);
    expect(adapter.hooks).toBe(provider.plugin.hooks);
  });
});

describe("applyOpenMeterBillingEvent", () => {
  it("ingests billing events and creates mapped entitlements", async () => {
    const client = makeClient();
    const onBillingEvent = vi.fn();

    await applyOpenMeterBillingEvent(
      {
        type: "subscription.active",
        provider: "stripe",
        customerIdOrKey: "cus_123",
        subject: "org_123",
        referenceId: "org_123",
        customerType: "organization",
        plan: "pro",
        subscriptionId: "sub_123",
      },
      makeCtx(client),
      {
        mapPlanToEntitlements: () => [
          {
            featureKey: "ai_tokens",
            type: "metered",
            amount: 100000,
          },
        ],
        onBillingEvent,
      },
    );

    expect(client.events.ingest).toHaveBeenCalledWith({
      specversion: "1.0",
      source: "better-auth",
      type: "better-auth.billing.subscription.active",
      subject: "org_123",
      data: expect.objectContaining({
        provider: "stripe",
        plan: "pro",
        subscriptionId: "sub_123",
      }),
    });
    expect(client.customers.entitlements.create).toHaveBeenCalledWith(
      "cus_123",
      {
        featureKey: "ai_tokens",
        type: "metered",
        amount: 100000,
      },
    );
    expect(onBillingEvent).toHaveBeenCalledOnce();
  });

  it("can skip audit event ingestion", async () => {
    const client = makeClient();

    await applyOpenMeterBillingEvent(
      {
        type: "subscription.canceled",
        provider: "razorpay",
        customerIdOrKey: "cus_123",
      },
      makeCtx(client),
      {
        ingestBillingEvents: false,
      },
    );

    expect(client.events.ingest).not.toHaveBeenCalled();
  });

  it("can create entitlements from a billing catalog", async () => {
    const client = makeClient();
    const catalog = defineBillingCatalog({
      features: {
        tokens: {
          key: "ai_tokens",
          type: "metered",
        },
        apiAccess: {
          key: "api_access",
          type: "boolean",
        },
      },
      plans: {
        pro: {
          entitlements: {
            tokens: 100000,
            apiAccess: true,
          },
        },
      },
    });

    await applyOpenMeterBillingEvent(
      {
        type: "subscription.active",
        provider: "stripe",
        customerIdOrKey: "cus_123",
        plan: "pro",
      },
      makeCtx(client),
      {
        catalog,
      },
    );

    expect(client.customers.entitlements.create).toHaveBeenCalledTimes(2);
    expect(client.customers.entitlements.create).toHaveBeenCalledWith(
      "cus_123",
      expect.objectContaining({
        featureKey: "ai_tokens",
        type: "metered",
        amount: 100000,
      }),
    );
    expect(client.customers.entitlements.create).toHaveBeenCalledWith(
      "cus_123",
      expect.objectContaining({
        featureKey: "api_access",
        type: "boolean",
      }),
    );
  });

  it("can mirror billing events without creating catalog entitlements", async () => {
    const client = makeClient();
    const catalog = defineBillingCatalog({
      features: {
        tokens: {
          type: "metered",
        },
      },
      plans: {
        pro: {
          entitlements: {
            tokens: 100000,
          },
        },
      },
    });

    await applyOpenMeterBillingEvent(
      {
        type: "subscription.active",
        provider: "stripe",
        customerIdOrKey: "cus_123",
        plan: "pro",
      },
      makeCtx(client),
      {
        catalog,
        entitlementMode: "none",
      },
    );

    expect(client.events.ingest).toHaveBeenCalledOnce();
    expect(client.customers.entitlements.create).not.toHaveBeenCalled();
  });

  it("can apply a catalog topup grant and ingest an audit event", async () => {
    const client = makeClient();
    const onTopupGranted = vi.fn();
    const catalog = defineBillingCatalog({
      features: {
        tokens: {
          key: "ai_tokens",
          type: "metered",
        },
      },
      plans: {
        pro: {
          entitlements: {
            tokens: 100000,
          },
        },
      },
      topups: {
        tokenPack1m: {
          key: "token_pack_1m",
          feature: "tokens",
          amount: 1_000_000,
          grant: {
            priority: 1,
            expiration: {
              duration: "year",
              count: 1,
            },
            maxRolloverAmount: 1_000_000,
            metadata: {
              source: "catalog",
              nested: {
                mode: "catalog",
              },
            },
          },
          prices: {
            oneTime: {
              amount: 1000,
              currency: "USD",
              interval: "one_time",
            },
          },
        },
      },
    });

    const result = await applyCatalogTopupGrant(
      {
        customerIdOrKey: "cus_123",
        subject: "org_123",
        topup: "tokenPack1m",
        provider: "stripe",
        referenceId: "org_123",
        paymentId: "pi_123",
        metadata: {
          source: "webhook",
          checkoutSessionId: "cs_123",
          nested: {
            mode: "webhook",
          },
        },
      },
      makeCtx(client),
      {
        catalog,
        onTopupGranted,
      },
    );

    expect(client.customers.entitlements.createGrant).toHaveBeenCalledWith(
      "cus_123",
      "ai_tokens",
      {
        amount: 1_000_000,
        priority: 1,
        effectiveAt: expect.any(Date),
        expiration: {
          duration: "YEAR",
          count: 1,
        },
        maxRolloverAmount: 1_000_000,
        metadata: {
          source: "webhook",
          nested: JSON.stringify({ mode: "webhook" }),
          catalogTopupId: "tokenPack1m",
          catalogTopupKey: "token_pack_1m",
          catalogFeatureId: "tokens",
          checkoutSessionId: "cs_123",
        },
      },
    );
    expect(client.events.ingest).toHaveBeenCalledWith({
      specversion: "1.0",
      source: "better-auth",
      type: "better-auth.billing.topup.applied",
      subject: "org_123",
      data: {
        provider: "stripe",
        referenceId: "org_123",
        paymentId: "pi_123",
        topupId: "tokenPack1m",
        topupKey: "token_pack_1m",
        featureKey: "ai_tokens",
        amount: 1_000_000,
        grantId: "grant_123",
        metadata: {
          source: "webhook",
          nested: JSON.stringify({ mode: "webhook" }),
          catalogTopupId: "tokenPack1m",
          catalogTopupKey: "token_pack_1m",
          catalogFeatureId: "tokens",
          checkoutSessionId: "cs_123",
        },
      },
    });
    expect(onTopupGranted).toHaveBeenCalledOnce();
    expect(result.compiledTopup.topupId).toBe("tokenPack1m");
    expect(result.grant?.id).toBe("grant_123");
  });

  it("can apply a catalog topup grant without ingesting an audit event", async () => {
    const client = makeClient();
    const catalog = defineBillingCatalog({
      features: {
        tokens: {
          key: "ai_tokens",
          type: "metered",
        },
      },
      plans: {
        pro: {
          entitlements: {
            tokens: 100000,
          },
        },
      },
      topups: {
        tokenPack1m: {
          feature: "tokens",
          amount: 1_000_000,
          prices: {
            oneTime: {
              amount: 1000,
              currency: "USD",
              interval: "one_time",
            },
          },
        },
      },
    });

    await applyCatalogTopupGrant(
      {
        customerIdOrKey: "cus_123",
        topup: "tokenPack1m",
      },
      makeCtx(client),
      {
        catalog,
        ingestTopupEvents: false,
      },
    );

    expect(client.customers.entitlements.createGrant).toHaveBeenCalledOnce();
    expect(client.events.ingest).not.toHaveBeenCalled();
  });
});

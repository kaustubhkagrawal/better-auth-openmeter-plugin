import { describe, expect, it, vi } from "vitest";
import {
  applyOpenMeterBillingEvent,
  billingAdapter,
  openmeterBillingAdapter,
} from "../src/adapters/billing";

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
});


import { describe, expect, it, vi } from "vitest";
import { openmeterBillingAdapter } from "../src/adapters/billing";
import { polarBillingProvider } from "../src/adapters/polar";

const subscriptionPayload = {
  type: "subscription.active",
  data: {
    id: "sub_polar_123",
    customerId: "cus_polar_123",
    metadata: {
      referenceId: "org_123",
    },
    product: {
      name: "pro",
    },
  },
};

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

describe("polarBillingProvider", () => {
  it("normalizes Polar subscription webhooks to billing events", async () => {
    const provider = polarBillingProvider({ apply: false });

    const event = await provider.toBillingEvent(
      "onSubscriptionActive",
      subscriptionPayload,
    );

    expect(event).toMatchObject({
      type: "subscription.active",
      provider: "polar",
      customerIdOrKey: "org_123",
      subject: "org_123",
      referenceId: "org_123",
      plan: "pro",
      subscriptionId: "sub_polar_123",
      metadata: {
        callbackName: "onSubscriptionActive",
        polarEventType: "subscription.active",
        polarCustomerId: "cus_polar_123",
      },
    });
  });

  it("applies webhook events to OpenMeter", async () => {
    const client = makeClient();
    const provider = polarBillingProvider({
      billing: {
        openmeterClient: client as any,
        mapPlanToEntitlements: () => [
          {
            featureKey: "ai_tokens",
            type: "metered",
            amount: 100000,
          },
        ],
      },
    });

    await provider.callbacks.onSubscriptionActive(subscriptionPayload);

    expect(client.events.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "better-auth.billing.subscription.active",
        subject: "org_123",
        data: expect.objectContaining({
          provider: "polar",
          plan: "pro",
          subscriptionId: "sub_polar_123",
        }),
      }),
    );
    expect(client.customers.entitlements.create).toHaveBeenCalledWith(
      "org_123",
      {
        featureKey: "ai_tokens",
        type: "metered",
        amount: 100000,
      },
    );
  });

  it("supports custom customer and subject resolution", async () => {
    const provider = polarBillingProvider({
      apply: false,
      resolveCustomerIdOrKey: () => "customer:org_123",
      resolveSubject: () => "subject:org_123",
      resolveCustomerType: () => "organization",
      resolvePlan: () => "enterprise",
      metadata: { providerVersion: "test" },
    });

    const event = await provider.handleWebhookEvent(
      "onSubscriptionCanceled",
      subscriptionPayload,
    );

    expect(event).toMatchObject({
      type: "subscription.canceled",
      customerIdOrKey: "customer:org_123",
      subject: "subject:org_123",
      customerType: "organization",
      plan: "enterprise",
      metadata: expect.objectContaining({
        providerVersion: "test",
      }),
    });
  });

  it("requires a resolvable customer id", async () => {
    const provider = polarBillingProvider({ apply: false });

    await expect(
      provider.toBillingEvent("onOrderPaid", {
        data: {
          id: "order_123",
        },
      }),
    ).rejects.toThrow(
      "Polar billing event could not resolve customerIdOrKey",
    );
  });

  it("can be passed through the generic billing adapter", () => {
    const provider = polarBillingProvider({
      billing: { openmeterClient: makeClient() as any },
    });
    const adapter = openmeterBillingAdapter({ provider });

    expect(adapter.options.provider).toBe(provider);
  });

  it("requires OpenMeter or explicit client at provider init", () => {
    const provider = polarBillingProvider();

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: () => false } as any),
    ).toThrow(
      "polarBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
    );

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: (id: string) => id === "openmeter" } as any),
    ).not.toThrow();
  });
});


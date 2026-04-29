import { describe, expect, it, vi } from "vitest";
import { openmeterBillingAdapter } from "../src/adapters/billing";
import { creemBillingProvider } from "../src/adapters/creem";

const subscriptionEvent = {
  webhookEventType: "subscription.active",
  webhookId: "evt_creem_123",
  id: "sub_creem_123",
  status: "active",
  customer: {
    id: "cus_creem_123",
    email: "buyer@example.com",
  },
  product: {
    id: "prod_creem_123",
    name: "pro",
  },
  metadata: {
    referenceId: "org_123",
  },
  items: [{ price_id: "price_creem_123", units: 5 }],
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

describe("creemBillingProvider", () => {
  it("normalizes Creem subscription callbacks to billing events", async () => {
    const provider = creemBillingProvider({ apply: false });

    const event = await provider.toBillingEvent(
      "onSubscriptionActive",
      subscriptionEvent,
    );

    expect(event).toMatchObject({
      type: "subscription.active",
      provider: "creem",
      customerIdOrKey: "org_123",
      subject: "org_123",
      referenceId: "org_123",
      plan: "pro",
      subscriptionId: "sub_creem_123",
      metadata: {
        callbackName: "onSubscriptionActive",
        creemEventType: "subscription.active",
        creemWebhookId: "evt_creem_123",
        creemCustomerId: "cus_creem_123",
        status: "active",
        priceId: "price_creem_123",
        units: 5,
      },
    });
  });

  it("applies callback events to OpenMeter", async () => {
    const client = makeClient();
    const provider = creemBillingProvider({
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

    await provider.callbacks.onSubscriptionActive(subscriptionEvent);

    expect(client.events.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "better-auth.billing.subscription.active",
        subject: "org_123",
        data: expect.objectContaining({
          provider: "creem",
          plan: "pro",
          subscriptionId: "sub_creem_123",
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

  it("maps access callbacks from Creem reasons", async () => {
    const provider = creemBillingProvider({ apply: false });

    const granted = await provider.handleWebhookEvent("onGrantAccess", {
      ...subscriptionEvent,
      reason: "subscription_paid",
    });
    const revoked = await provider.handleWebhookEvent("onRevokeAccess", {
      ...subscriptionEvent,
      reason: "subscription_expired",
    });

    expect(granted.type).toBe("invoice.paid");
    expect(revoked.type).toBe("subscription.expired");
  });

  it("supports custom customer and subject resolution", async () => {
    const provider = creemBillingProvider({
      apply: false,
      resolveCustomerIdOrKey: () => "customer:org_123",
      resolveSubject: () => "subject:org_123",
      resolveCustomerType: () => "organization",
      resolvePlan: () => "enterprise",
      metadata: { providerVersion: "test" },
    });

    const event = await provider.handleWebhookEvent(
      "onSubscriptionCanceled",
      subscriptionEvent,
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
    const provider = creemBillingProvider({ apply: false });

    await expect(
      provider.toBillingEvent("onCheckoutCompleted", {
        product: { name: "pro" },
      }),
    ).rejects.toThrow(
      "Creem billing event could not resolve customerIdOrKey",
    );
  });

  it("can be passed through the generic billing adapter", () => {
    const provider = creemBillingProvider({
      billing: { openmeterClient: makeClient() as any },
    });
    const adapter = openmeterBillingAdapter({ provider });

    expect(adapter.options.provider).toBe(provider);
  });

  it("requires OpenMeter or explicit client at provider init", () => {
    const provider = creemBillingProvider();

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: () => false } as any),
    ).toThrow(
      "creemBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
    );

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: (id: string) => id === "openmeter" } as any),
    ).not.toThrow();
  });
});

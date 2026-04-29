import { describe, expect, it, vi } from "vitest";
import { openmeterBillingAdapter } from "../src/adapters/billing";
import { dodoBillingProvider } from "../src/adapters/dodo";

const subscriptionPayload = {
  event_type: "subscription_active",
  data: {
    id: "sub_dodo_123",
    customer_id: "cus_dodo_123",
    product_id: "pdt_dodo_123",
    status: "active",
    metadata: {
      referenceId: "org_123",
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

describe("dodoBillingProvider", () => {
  it("normalizes Dodo subscription callbacks to billing events", async () => {
    const provider = dodoBillingProvider({ apply: false });

    const event = await provider.toBillingEvent(
      "onSubscriptionActive",
      subscriptionPayload,
    );

    expect(event).toMatchObject({
      type: "subscription.active",
      provider: "dodo",
      customerIdOrKey: "org_123",
      subject: "org_123",
      referenceId: "org_123",
      plan: "pdt_dodo_123",
      subscriptionId: "sub_dodo_123",
      metadata: {
        callbackName: "onSubscriptionActive",
        dodoEventType: "subscription_active",
        dodoCustomerId: "cus_dodo_123",
        status: "active",
        paymentId: "sub_dodo_123",
      },
    });
  });

  it("applies callback events to OpenMeter", async () => {
    const client = makeClient();
    const provider = dodoBillingProvider({
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
          provider: "dodo",
          plan: "pdt_dodo_123",
          subscriptionId: "sub_dodo_123",
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

  it("supports catch-all payload handling", async () => {
    const provider = dodoBillingProvider({ apply: false });

    const event = await provider.handleWebhookEvent("onPayload", {
      event_type: "payment_succeeded",
      data: {
        payment_id: "pay_123",
        customer_id: "cus_dodo_123",
        metadata: { referenceId: "org_123" },
      },
    });

    expect(event).toMatchObject({
      type: "invoice.paid",
      subscriptionId: undefined,
      metadata: expect.objectContaining({
        callbackName: "onPayload",
        paymentId: "pay_123",
      }),
    });
  });

  it("supports custom customer and subject resolution", async () => {
    const provider = dodoBillingProvider({
      apply: false,
      resolveCustomerIdOrKey: () => "customer:org_123",
      resolveSubject: () => "subject:org_123",
      resolveCustomerType: () => "organization",
      resolvePlan: () => "enterprise",
      metadata: { providerVersion: "test" },
    });

    const event = await provider.handleWebhookEvent(
      "onSubscriptionCancelled",
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
    const provider = dodoBillingProvider({ apply: false });

    await expect(
      provider.toBillingEvent("onPaymentSucceeded", {
        data: {
          id: "pay_123",
        },
      }),
    ).rejects.toThrow(
      "Dodo billing event could not resolve customerIdOrKey",
    );
  });

  it("can be passed through the generic billing adapter", () => {
    const provider = dodoBillingProvider({
      billing: { openmeterClient: makeClient() as any },
    });
    const adapter = openmeterBillingAdapter({ provider });

    expect(adapter.options.provider).toBe(provider);
  });

  it("requires OpenMeter or explicit client at provider init", () => {
    const provider = dodoBillingProvider();

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: () => false } as any),
    ).toThrow(
      "dodoBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
    );

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: (id: string) => id === "openmeter" } as any),
    ).not.toThrow();
  });
});

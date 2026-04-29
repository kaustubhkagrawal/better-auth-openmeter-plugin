import { describe, expect, it, vi } from "vitest";
import { openmeterBillingAdapter } from "../src/adapters/billing";
import { stripeBillingProvider } from "../src/adapters/stripe";

const subscription = {
  id: "local_sub_123",
  plan: "pro",
  referenceId: "org_123",
  status: "active",
  stripeCustomerId: "cus_stripe_123",
  stripeSubscriptionId: "sub_stripe_123",
  priceId: "price_123",
  groupId: "workspace",
  seats: 5,
  billingInterval: "month" as const,
};

const plan = {
  name: "pro",
  priceId: "price_123",
  limits: { tokens: 100000 },
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

describe("stripeBillingProvider", () => {
  it("normalizes Stripe completion callbacks to billing events", async () => {
    const provider = stripeBillingProvider({ apply: false });

    const event = await provider.toBillingEvent("onSubscriptionComplete", {
      event: { id: "evt_123" },
      stripeSubscription: {
        id: "sub_stripe_123",
        status: "active",
        customer: "cus_stripe_123",
        items: {
          data: [{ price: { id: "price_123" }, quantity: 5 }],
        },
      },
      subscription,
      plan,
    });

    expect(event).toMatchObject({
      type: "subscription.active",
      provider: "stripe",
      customerIdOrKey: "org_123",
      subject: "org_123",
      referenceId: "org_123",
      plan: "pro",
      subscriptionId: "sub_stripe_123",
      metadata: {
        callbackName: "onSubscriptionComplete",
        stripeCustomerId: "cus_stripe_123",
        stripePriceId: "price_123",
        status: "active",
        groupId: "workspace",
        seats: 5,
        billingInterval: "month",
      },
    });
  });

  it("applies callback events to OpenMeter", async () => {
    const client = makeClient();
    const provider = stripeBillingProvider({
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

    await provider.callbacks.onSubscriptionComplete({
      subscription,
      plan,
    });

    expect(client.events.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "better-auth.billing.subscription.active",
        subject: "org_123",
        data: expect.objectContaining({
          provider: "stripe",
          plan: "pro",
          subscriptionId: "sub_stripe_123",
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
    const provider = stripeBillingProvider({
      apply: false,
      resolveCustomerIdOrKey: ({ subscription }) =>
        `customer:${subscription.referenceId}`,
      resolveSubject: ({ subscription }) => `subject:${subscription.referenceId}`,
      resolveCustomerType: () => "organization",
      metadata: { providerVersion: "test" },
    });

    const event = await provider.handleSubscriptionEvent(
      "onSubscriptionCancel",
      { subscription, cancellationDetails: { reason: "requested" } },
    );

    expect(event).toMatchObject({
      type: "subscription.canceled",
      customerIdOrKey: "customer:org_123",
      subject: "subject:org_123",
      customerType: "organization",
      metadata: expect.objectContaining({
        providerVersion: "test",
        cancellationDetails: { reason: "requested" },
      }),
    });
  });

  it("can be passed through the generic billing adapter", () => {
    const provider = stripeBillingProvider({
      billing: { openmeterClient: makeClient() as any },
    });
    const adapter = openmeterBillingAdapter({ provider });

    expect(adapter.options.provider).toBe(provider);
  });

  it("requires OpenMeter or explicit client at provider init", () => {
    const provider = stripeBillingProvider();

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: () => false } as any),
    ).toThrow(
      "stripeBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
    );

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: (id: string) => id === "openmeter" } as any),
    ).not.toThrow();
  });
});


import { describe, expect, it, vi } from "vitest";
import { openmeterBillingAdapter } from "../src/adapters/billing";
import { razorpayBillingProvider } from "../src/adapters/razorpay";

const subscription = {
  id: "local_sub_123",
  plan: "pro",
  referenceId: "org_123",
  status: "active",
  razorpayCustomerId: "cust_rzp_123",
  razorpaySubscriptionId: "sub_rzp_123",
  razorpayPlanId: "plan_rzp_123",
  groupId: "workspace",
  quantity: 5,
  metadata: JSON.stringify({ source: "test" }),
};

const plan = {
  name: "pro",
  planId: "plan_rzp_123",
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

describe("razorpayBillingProvider", () => {
  it("normalizes Razorpay activated callbacks to billing events", async () => {
    const provider = razorpayBillingProvider({ apply: false });

    const event = await provider.toBillingEvent("onSubscriptionActivated", {
      event: { id: "evt_123" },
      razorpaySubscription: {
        id: "sub_rzp_123",
        status: "active",
        customer_id: "cust_rzp_123",
        plan_id: "plan_rzp_123",
      },
      subscription,
      plan,
    });

    expect(event).toMatchObject({
      type: "subscription.active",
      provider: "razorpay",
      customerIdOrKey: "org_123",
      subject: "org_123",
      referenceId: "org_123",
      plan: "pro",
      subscriptionId: "sub_rzp_123",
      metadata: {
        source: "test",
        callbackName: "onSubscriptionActivated",
        razorpayCustomerId: "cust_rzp_123",
        razorpayPlanId: "plan_rzp_123",
        status: "active",
        groupId: "workspace",
        quantity: 5,
      },
    });
  });

  it("applies callback events to OpenMeter", async () => {
    const client = makeClient();
    const onBillingEvent = vi.fn();
    const provider = razorpayBillingProvider({
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
      onBillingEvent,
    });

    await provider.callbacks.onSubscriptionActivated({
      subscription,
      plan,
    });

    expect(client.events.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "better-auth.billing.subscription.active",
        subject: "org_123",
        data: expect.objectContaining({
          provider: "razorpay",
          plan: "pro",
          subscriptionId: "sub_rzp_123",
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
    expect(onBillingEvent).toHaveBeenCalledOnce();
  });

  it("supports custom customer and subject resolution", async () => {
    const provider = razorpayBillingProvider({
      apply: false,
      resolveCustomerIdOrKey: ({ subscription }) =>
        `customer:${subscription.referenceId}`,
      resolveSubject: ({ subscription }) => `subject:${subscription.referenceId}`,
      resolveCustomerType: () => "organization",
      metadata: { providerVersion: "test" },
    });

    const event = await provider.handleSubscriptionEvent(
      "onSubscriptionCancelled",
      { subscription },
    );

    expect(event).toMatchObject({
      type: "subscription.canceled",
      customerIdOrKey: "customer:org_123",
      subject: "subject:org_123",
      customerType: "organization",
      metadata: expect.objectContaining({
        providerVersion: "test",
      }),
    });
  });

  it("can be passed through the generic billing adapter", () => {
    const provider = razorpayBillingProvider({
      billing: { openmeterClient: makeClient() as any },
    });
    const adapter = openmeterBillingAdapter({ provider });

    expect(adapter.id).toBe("openmeter-billing-adapter");
    expect(adapter.options.provider).toBe(provider);
  });

  it("requires OpenMeter or explicit client at provider init", () => {
    const provider = razorpayBillingProvider();

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: () => false } as any),
    ).toThrow(
      "razorpayBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
    );

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: (id: string) => id === "openmeter" } as any),
    ).not.toThrow();
  });
});


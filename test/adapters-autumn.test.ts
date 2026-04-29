import { describe, expect, it, vi } from "vitest";
import { openmeterBillingAdapter } from "../src/adapters/billing";
import { autumnBillingProvider } from "../src/adapters/autumn";

const identity = {
  session: {
    user: {
      id: "user_123",
      name: "Jane User",
      email: "jane@example.com",
    },
    session: {
      id: "sess_123",
      activeOrganizationId: "org_123",
    },
  },
  organization: {
    id: "org_123",
    name: "Acme",
    slug: "acme",
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

describe("autumnBillingProvider", () => {
  it("creates a Better Auth Autumn identify function for users", async () => {
    const provider = autumnBillingProvider();

    await expect(provider.identify(identity)).resolves.toMatchObject({
      customerId: "user_123",
      customerData: {
        name: "Jane User",
        email: "jane@example.com",
        metadata: {
          userId: "user_123",
        },
      },
    });
  });

  it("supports organization-scoped Autumn customers", async () => {
    const provider = autumnBillingProvider({ customerScope: "organization" });

    await expect(provider.identify(identity)).resolves.toMatchObject({
      customerId: "org_123",
      customerData: {
        name: "Acme",
        metadata: {
          organizationId: "org_123",
          organizationSlug: "acme",
        },
      },
    });
  });

  it("normalizes Autumn state to billing events", async () => {
    const provider = autumnBillingProvider({
      apply: false,
      customerScope: "organization",
    });

    const event = await provider.toBillingEvent({
      type: "subscription.active",
      identity,
      productId: "pro",
      subscriptionId: "sub_autumn_123",
    });

    expect(event).toMatchObject({
      type: "subscription.active",
      provider: "autumn",
      customerIdOrKey: "org_123",
      subject: "org_123",
      referenceId: "org_123",
      customerType: "organization",
      plan: "pro",
      subscriptionId: "sub_autumn_123",
      metadata: {
        autumnCustomerId: "org_123",
        productId: "pro",
      },
    });
  });

  it("applies billing state to OpenMeter", async () => {
    const client = makeClient();
    const provider = autumnBillingProvider({
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

    await provider.handleBillingState({
      type: "subscription.active",
      customerId: "user_123",
      productId: "pro",
    });

    expect(client.events.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "better-auth.billing.subscription.active",
        subject: "user_123",
        data: expect.objectContaining({
          provider: "autumn",
          plan: "pro",
        }),
      }),
    );
    expect(client.customers.entitlements.create).toHaveBeenCalledWith(
      "user_123",
      {
        featureKey: "ai_tokens",
        type: "metered",
        amount: 100000,
      },
    );
  });

  it("supports custom identity and customer resolution", async () => {
    const provider = autumnBillingProvider({
      apply: false,
      identify: () => ({
        customerId: "workspace_123",
        customerData: { name: "Workspace" },
      }),
      resolveCustomerIdOrKey: () => "customer:workspace_123",
      resolveSubject: () => "subject:workspace_123",
      resolveCustomerType: () => "workspace",
      resolvePlan: () => "enterprise",
      metadata: { providerVersion: "test" },
    });

    const event = await provider.handleBillingState({
      type: "subscription.updated",
      identity,
    });

    expect(event).toMatchObject({
      type: "subscription.updated",
      customerIdOrKey: "customer:workspace_123",
      subject: "subject:workspace_123",
      customerType: "workspace",
      plan: "enterprise",
      metadata: expect.objectContaining({
        providerVersion: "test",
      }),
    });
  });

  it("requires a resolvable customer id", async () => {
    const provider = autumnBillingProvider({ apply: false });

    await expect(
      provider.toBillingEvent({
        productId: "pro",
      }),
    ).rejects.toThrow(
      "Autumn billing event could not resolve customerIdOrKey",
    );
  });

  it("can be passed through the generic billing adapter", () => {
    const provider = autumnBillingProvider({
      billing: { openmeterClient: makeClient() as any },
    });
    const adapter = openmeterBillingAdapter({ provider });

    expect(adapter.options.provider).toBe(provider);
  });

  it("requires OpenMeter or explicit client at provider init", () => {
    const provider = autumnBillingProvider();

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: () => false } as any),
    ).toThrow(
      "autumnBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
    );

    expect(() =>
      provider.plugin?.init?.({ hasPlugin: (id: string) => id === "openmeter" } as any),
    ).not.toThrow();
  });
});

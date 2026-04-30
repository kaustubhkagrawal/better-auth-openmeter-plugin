import { describe, expect, it } from "vitest";
import {
  compileCatalogFeatures,
  compileCatalogPlans,
  compileOpenMeterEntitlements,
  compilePaymentCatalog,
  createCatalogEntitlementMapper,
  defineBillingCatalog,
  validateBillingCatalog,
} from "../src/catalog";

const catalog = defineBillingCatalog({
  meters: {
    tokens: {
      key: "tokens",
      eventType: "ai.tokens",
      aggregation: "sum",
      valueProperty: "tokens",
    },
  },
  features: {
    aiTokens: {
      key: "ai_tokens",
      type: "metered",
      meter: "tokens",
      name: "AI tokens",
    },
    apiAccess: {
      key: "api_access",
      type: "boolean",
    },
    supportTier: {
      key: "support_tier",
      type: "static",
    },
  },
  plans: {
    free: {
      name: "Free",
      entitlements: {
        aiTokens: 10000,
        apiAccess: true,
        supportTier: "community",
      },
    },
    pro: {
      key: "pro",
      name: "Pro",
      description: "Pro plan",
      providerIds: {
        stripe: "prod_stripe_pro",
      },
      entitlements: {
        aiTokens: {
          amount: 100000,
          reset: "month",
          metadata: { unit: "tokens" },
        },
        apiAccess: { enabled: true },
        supportTier: { config: "priority" },
      },
      prices: {
        monthly: {
          amount: 2000,
          currency: "USD",
          interval: "month",
          providerIds: {
            stripe: "price_stripe_monthly",
          },
        },
        yearly: {
          amount: 20000,
          currency: "USD",
          interval: "year",
          lookupKey: "pro-yearly",
        },
      },
    },
  },
});

describe("billing catalog", () => {
  it("defines and compiles catalog features and plans", () => {
    expect(compileCatalogFeatures(catalog)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "aiTokens",
          key: "ai_tokens",
          type: "metered",
        }),
      ]),
    );

    expect(compileCatalogPlans(catalog)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "pro",
          key: "pro",
          name: "Pro",
        }),
      ]),
    );
  });

  it("compiles plan entitlements to OpenMeter entitlement plans", () => {
    expect(compileOpenMeterEntitlements(catalog, "pro")).toEqual([
      {
        featureKey: "ai_tokens",
        type: "metered",
        amount: 100000,
        metadata: {
          unit: "tokens",
          catalogPlanId: "pro",
          catalogFeatureId: "aiTokens",
        },
      },
      {
        featureKey: "api_access",
        type: "boolean",
        metadata: {
          catalogPlanId: "pro",
          catalogFeatureId: "apiAccess",
          enabled: true,
        },
      },
      {
        featureKey: "support_tier",
        type: "static",
        config: "priority",
        metadata: {
          catalogPlanId: "pro",
          catalogFeatureId: "supportTier",
        },
      },
    ]);
  });

  it("creates a billing adapter entitlement mapper from event.plan", () => {
    const mapper = createCatalogEntitlementMapper(catalog);

    expect(mapper({ plan: "pro" })).toHaveLength(3);
    expect(mapper({ plan: "missing" })).toEqual([]);
    expect(() =>
      createCatalogEntitlementMapper(catalog, { strict: true })({
        plan: "missing",
      }),
    ).toThrow('Unknown catalog plan "missing".');
  });

  it("compiles payment provider product and price setup data", () => {
    expect(compilePaymentCatalog(catalog, "stripe")).toEqual({
      provider: "stripe",
      products: expect.arrayContaining([
        {
          provider: "stripe",
          catalogPlanId: "pro",
          name: "Pro",
          description: "Pro plan",
          productId: "prod_stripe_pro",
          metadata: {
            catalogPlanId: "pro",
            catalogPlanKey: "pro",
          },
        },
      ]),
      prices: expect.arrayContaining([
        {
          provider: "stripe",
          catalogPlanId: "pro",
          catalogPriceId: "monthly",
          lookupKey: "pro:monthly",
          amount: 2000,
          currency: "usd",
          interval: "month",
          intervalCount: undefined,
          trialDays: undefined,
          priceId: "price_stripe_monthly",
          metadata: {
            catalogPlanId: "pro",
            catalogPlanKey: "pro",
            catalogPriceId: "monthly",
            provider: "stripe",
          },
        },
        expect.objectContaining({
          catalogPriceId: "yearly",
          lookupKey: "pro-yearly",
        }),
      ]),
    });
  });

  it("reports catalog validation issues without throwing", () => {
    const issues = validateBillingCatalog({
      features: {
        tokens: {
          type: "metered",
          meter: "missing",
        },
        apiAccess: {
          type: "boolean",
        },
      },
      plans: {
        pro: {
          entitlements: {
            tokens: true,
            missingFeature: 100,
          },
          prices: {
            monthly: {
              amount: 20.5,
              currency: "US",
            },
          },
        },
      },
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "features.tokens.meter",
        }),
        expect.objectContaining({
          path: "plans.pro.entitlements.tokens",
        }),
        expect.objectContaining({
          path: "plans.pro.entitlements.missingFeature",
        }),
        expect.objectContaining({
          path: "plans.pro.prices.monthly.amount",
        }),
        expect.objectContaining({
          path: "plans.pro.prices.monthly.currency",
        }),
      ]),
    );
  });

  it("throws early when defining an invalid catalog", () => {
    expect(() =>
      defineBillingCatalog({
        features: {
          apiAccess: { type: "boolean" },
        },
        plans: {
          pro: {
            entitlements: {
              apiAccess: 100,
            },
          },
        },
      }),
    ).toThrow("Invalid billing catalog");
  });
});

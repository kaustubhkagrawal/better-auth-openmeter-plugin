import { describe, expect, it } from "vitest";
import {
  compileCatalogAddons,
  compileCatalogFeatures,
  compileCatalogPlans,
  compileCatalogTopups,
  compileOpenMeterAddonEntitlements,
  compileOpenMeterEntitlements,
  compileOpenMeterTopupGrant,
  compilePaymentCatalog,
  createCatalogEntitlementMapper,
  defineBillingCatalog,
  validateBillingCatalog,
  validateBillingCatalogProviderCompatibility,
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
    prioritySupport: {
      key: "priority_support",
      type: "boolean",
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
        dodo: "prod_dodo_pro",
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
            dodo: "price_dodo_monthly",
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
  addons: {
    prioritySupport: {
      key: "priority_support_addon",
      name: "Priority Support",
      description: "Support SLA and escalation",
      compatiblePlans: ["pro"],
      multiple: false,
      entitlements: {
        prioritySupport: true,
      },
      prices: {
        monthly: {
          amount: 1000,
          currency: "USD",
          interval: "month",
          providerIds: {
            stripe: "price_support_monthly",
          },
        },
      },
    },
  },
  topups: {
    tokenPack1m: {
      key: "token_pack_1m",
      name: "1M Token Pack",
      feature: "aiTokens",
      amount: 1_000_000,
      grant: {
        priority: 1,
        expiration: {
          duration: "YEAR",
          count: 1,
        },
        maxRolloverAmount: 1_000_000,
        metadata: {
          source: "checkout",
        },
      },
      prices: {
        oneTime: {
          amount: 1000,
          currency: "USD",
          interval: "one_time",
          providerIds: {
            stripe: "price_token_pack",
          },
        },
      },
    },
  },
});

describe("billing catalog", () => {
  it("defines and compiles catalog features, plans, addons, and topups", () => {
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

    expect(compileCatalogAddons(catalog)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "prioritySupport",
          key: "priority_support_addon",
          name: "Priority Support",
        }),
      ]),
    );

    expect(compileCatalogTopups(catalog)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tokenPack1m",
          key: "token_pack_1m",
          name: "1M Token Pack",
        }),
      ]),
    );
  });

  it("compiles OpenMeter plan and addon entitlements plus topup grants", () => {
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

    expect(compileOpenMeterAddonEntitlements(catalog, "priority_support_addon")).toEqual([
      {
        featureKey: "priority_support",
        type: "boolean",
        metadata: {
          catalogAddonId: "prioritySupport",
          catalogFeatureId: "prioritySupport",
          enabled: true,
        },
      },
    ]);

    expect(compileOpenMeterTopupGrant(catalog, "token_pack_1m")).toEqual({
      topupId: "tokenPack1m",
      topupKey: "token_pack_1m",
      featureId: "aiTokens",
      featureKey: "ai_tokens",
      amount: 1_000_000,
      priority: 1,
      expiration: {
        duration: "YEAR",
        count: 1,
      },
      maxRolloverAmount: 1_000_000,
      metadata: {
        source: "checkout",
        catalogTopupId: "tokenPack1m",
        catalogTopupKey: "token_pack_1m",
        catalogFeatureId: "aiTokens",
      },
    });
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

  it("compiles Stripe setup data with explicit strategies", () => {
    expect(compilePaymentCatalog(catalog, "stripe")).toEqual({
      provider: "stripe",
      warnings: [],
      products: expect.arrayContaining([
        {
          provider: "stripe",
          kind: "plan",
          strategy: "subscription_product",
          catalogPlanId: "pro",
          name: "Pro",
          description: "Pro plan",
          productId: "prod_stripe_pro",
          metadata: {
            catalogPlanId: "pro",
            catalogPlanKey: "pro",
          },
        },
        {
          provider: "stripe",
          kind: "addon",
          strategy: "subscription_item",
          catalogAddonId: "prioritySupport",
          name: "Priority Support",
          description: "Support SLA and escalation",
          productId: undefined,
          compatiblePlanIds: ["pro"],
          multiple: false,
          quantity: undefined,
          metadata: {
            catalogAddonId: "prioritySupport",
            catalogAddonKey: "priority_support_addon",
          },
        },
        {
          provider: "stripe",
          kind: "topup",
          strategy: "one_time_checkout",
          catalogTopupId: "tokenPack1m",
          name: "1M Token Pack",
          description: undefined,
          productId: undefined,
          featureId: "aiTokens",
          amount: 1_000_000,
          compatiblePlanIds: ["free", "pro"],
          metadata: {
            catalogTopupId: "tokenPack1m",
            catalogTopupKey: "token_pack_1m",
            catalogFeatureId: "aiTokens",
          },
        },
      ]),
      prices: expect.arrayContaining([
        {
          provider: "stripe",
          kind: "plan",
          strategy: "subscription_product",
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
          kind: "addon",
          strategy: "subscription_item",
          catalogAddonId: "prioritySupport",
          catalogPriceId: "monthly",
          lookupKey: "priority_support_addon:monthly",
          priceId: "price_support_monthly",
        }),
        expect.objectContaining({
          kind: "topup",
          strategy: "one_time_checkout",
          catalogTopupId: "tokenPack1m",
          catalogPriceId: "oneTime",
          lookupKey: "token_pack_1m:oneTime",
          priceId: "price_token_pack",
        }),
      ]),
    });
  });

  it("emits provider compatibility warnings for Razorpay but still compiles", () => {
    const compiled = compilePaymentCatalog(catalog, "razorpay");

    expect(compiled.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "plan",
          strategy: "subscription_plan",
        }),
        expect.objectContaining({
          kind: "addon",
          strategy: "subscription_addon",
        }),
        expect.objectContaining({
          kind: "topup",
          strategy: "manual_charge",
        }),
      ]),
    );

    expect(compiled.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("addons.prioritySupport.prices.monthly.interval"),
        expect.stringContaining("topups.tokenPack1m"),
      ]),
    );

    expect(() =>
      compilePaymentCatalog(catalog, "razorpay", { strict: true }),
    ).toThrow('Invalid billing catalog for provider "razorpay"');
  });

  it("reports provider-specific compatibility issues", () => {
    const issues = validateBillingCatalogProviderCompatibility(
      defineBillingCatalog({
        features: {
          aiTokens: {
            type: "metered",
            meter: "tokens",
          },
        },
        meters: {
          tokens: {
            eventType: "ai.tokens",
          },
        },
        plans: {
          pro: {
            entitlements: {
              aiTokens: 100,
            },
            prices: {
              yearly: {
                amount: 12000,
                currency: "USD",
                interval: "year",
              },
            },
          },
        },
        addons: {
          monthlyBoost: {
            entitlements: {
              aiTokens: 1000,
            },
            prices: {
              monthly: {
                amount: 1000,
                currency: "USD",
                interval: "month",
              },
            },
          },
        },
        topups: {},
      }),
      "dodo",
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "addons.monthlyBoost.compatiblePlans",
        }),
      ]),
    );
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
            setup: {
              amount: 999,
              currency: "USD",
              interval: "one_time",
            },
          },
        },
        empty: {
          entitlements: {},
        },
      },
      addons: {
        emptyAddon: {
          entitlements: {},
        },
      },
      topups: {
        badTopup: {
          feature: "apiAccess",
          amount: 100,
          prices: {
            monthly: {
              amount: 999,
              currency: "USD",
              interval: "month",
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
        expect.objectContaining({
          path: "plans.pro.prices.setup.interval",
        }),
        expect.objectContaining({
          path: "plans.empty.entitlements",
        }),
        expect.objectContaining({
          path: "addons.emptyAddon.entitlements",
        }),
        expect.objectContaining({
          path: "topups.badTopup.feature",
        }),
        expect.objectContaining({
          path: "topups.badTopup.prices.monthly.interval",
        }),
      ]),
    );
  });

  it("defaults omitted compatiblePlans to every catalog plan", () => {
    const compiled = compilePaymentCatalog(catalog, "stripe");
    const topupProduct = compiled.products.find(
      (product) => product.kind === "topup" && product.catalogTopupId === "tokenPack1m",
    );
    const topupPrice = compiled.prices.find(
      (price) => price.kind === "topup" && price.catalogTopupId === "tokenPack1m",
    );

    expect(topupProduct).toEqual(
      expect.objectContaining({
        compatiblePlanIds: ["free", "pro"],
      }),
    );
    expect(topupPrice).toEqual(
      expect.objectContaining({
        compatiblePlanIds: ["free", "pro"],
      }),
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

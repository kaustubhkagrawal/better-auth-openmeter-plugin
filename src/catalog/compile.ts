import type { OpenMeterEntitlementPlan } from "../adapters/billing";
import type {
  BillingCatalog,
  BillingCatalogAddon,
  BillingCatalogEntitlement,
  BillingCatalogPlan,
  BillingCatalogTopup,
  CatalogEntitlementMapper,
  CatalogEntitlementMapperOptions,
  CompilePaymentCatalogOptions,
  CompiledCatalogAddon,
  CompiledCatalogFeature,
  CompiledCatalogPlan,
  CompiledCatalogTopup,
  CompiledOpenMeterTopupGrant,
  CompiledPaymentAddonPrice,
  CompiledPaymentAddonProduct,
  CompiledPaymentCatalog,
  CompiledPaymentPlanPrice,
  CompiledPaymentPlanProduct,
  CompiledPaymentPrice,
  CompiledPaymentProduct,
  CompiledPaymentStrategy,
  CompiledPaymentTopupPrice,
  CompiledPaymentTopupProduct,
} from "./types";
import {
  assertValidBillingCatalog,
  validateBillingCatalogProviderCompatibility,
} from "./validate";

function featureKey(featureId: string, catalog: BillingCatalog) {
  return catalog.features[featureId]?.key ?? featureId;
}

function planKey(planId: string, plan: BillingCatalogPlan) {
  return plan.key ?? planId;
}

function addonKey(addonId: string, addon: BillingCatalogAddon) {
  return addon.key ?? addonId;
}

function topupKey(topupId: string, topup: BillingCatalogTopup) {
  return topup.key ?? topupId;
}

function findPlanEntry(catalog: BillingCatalog, planIdOrKey: string) {
  return Object.entries(catalog.plans).find(
    ([planId, plan]) => planId === planIdOrKey || planKey(planId, plan) === planIdOrKey,
  );
}

function findAddonEntry(catalog: BillingCatalog, addonIdOrKey: string) {
  return Object.entries(catalog.addons ?? {}).find(
    ([addonId, addon]) =>
      addonId === addonIdOrKey || addonKey(addonId, addon) === addonIdOrKey,
  );
}

function findTopupEntry(catalog: BillingCatalog, topupIdOrKey: string) {
  return Object.entries(catalog.topups ?? {}).find(
    ([topupId, topup]) =>
      topupId === topupIdOrKey || topupKey(topupId, topup) === topupIdOrKey,
  );
}

function entitlementMetadata(
  source:
    | { kind: "plan"; id: string }
    | { kind: "addon"; id: string },
  featureId: string,
  entitlement: BillingCatalogEntitlement,
) {
  const metadata =
    typeof entitlement === "object" && !Array.isArray(entitlement)
      ? entitlement.metadata
      : undefined;

  if (source.kind === "plan") {
    return {
      ...metadata,
      catalogPlanId: source.id,
      catalogFeatureId: featureId,
    };
  }

  return {
    ...metadata,
    catalogAddonId: source.id,
    catalogFeatureId: featureId,
  };
}

function compileEntitlement(
  catalog: BillingCatalog,
  source:
    | { kind: "plan"; id: string }
    | { kind: "addon"; id: string },
  featureId: string,
  entitlement: BillingCatalogEntitlement,
): OpenMeterEntitlementPlan {
  const feature = catalog.features[featureId];
  if (!feature) {
    throw new Error(`Unknown catalog feature "${featureId}".`);
  }

  if (feature.type === "boolean") {
    const enabled =
      typeof entitlement === "boolean"
        ? entitlement
        : typeof entitlement === "object" && "enabled" in entitlement
          ? entitlement.enabled !== false
          : true;

    return {
      featureKey: featureKey(featureId, catalog),
      type: "boolean",
      metadata: {
        ...entitlementMetadata(source, featureId, entitlement),
        enabled,
      },
    };
  }

  if (feature.type === "metered") {
    const amount =
      typeof entitlement === "number"
        ? entitlement
        : typeof entitlement === "object" && "amount" in entitlement
          ? entitlement.amount
          : 0;

    return {
      featureKey: featureKey(featureId, catalog),
      type: "metered",
      amount,
      metadata: entitlementMetadata(source, featureId, entitlement),
    };
  }

  const config =
    typeof entitlement === "string"
      ? entitlement
      : typeof entitlement === "object" && "config" in entitlement
        ? entitlement.config
        : "";

  return {
    featureKey: featureKey(featureId, catalog),
    type: "static",
    config,
    metadata: entitlementMetadata(source, featureId, entitlement),
  };
}

function compileCompatibilityWarnings(catalog: BillingCatalog, provider: string) {
  return validateBillingCatalogProviderCompatibility(catalog, provider).map(
    (catalogIssue) => `${catalogIssue.path}: ${catalogIssue.message}`,
  );
}

function planStrategy(provider: string): CompiledPaymentStrategy {
  return provider.toLowerCase() === "razorpay"
    ? "subscription_plan"
    : "subscription_product";
}

function addonStrategy(provider: string, interval: string | undefined): CompiledPaymentStrategy {
  switch (provider.toLowerCase()) {
    case "stripe":
      return interval === "one_time" ? "invoice_item" : "subscription_item";
    case "razorpay":
      return "subscription_addon";
    case "dodo":
      return "subscription_addon";
    default:
      return interval === "one_time" ? "invoice_item" : "subscription_item";
  }
}

function topupStrategy(provider: string): CompiledPaymentStrategy {
  switch (provider.toLowerCase()) {
    case "razorpay":
      return "manual_charge";
    default:
      return "one_time_checkout";
  }
}

function normalizeCompatiblePlanIds(
  catalog: BillingCatalog,
  compatiblePlans: string[] | undefined,
) {
  return (compatiblePlans ?? []).map((planRef) => {
    const entry = findPlanEntry(catalog, planRef);
    return entry?.[0] ?? planRef;
  });
}

export function compileCatalogFeatures(
  catalog: BillingCatalog,
): CompiledCatalogFeature[] {
  assertValidBillingCatalog(catalog);
  return Object.entries(catalog.features).map(([id, feature]) => ({
    ...feature,
    id,
    key: feature.key ?? id,
  }));
}

export function compileCatalogPlans(
  catalog: BillingCatalog,
): CompiledCatalogPlan[] {
  assertValidBillingCatalog(catalog);
  return Object.entries(catalog.plans).map(([id, plan]) => ({
    ...plan,
    id,
    key: planKey(id, plan),
    name: plan.name ?? planKey(id, plan),
  }));
}

export function compileCatalogAddons(
  catalog: BillingCatalog,
): CompiledCatalogAddon[] {
  assertValidBillingCatalog(catalog);
  return Object.entries(catalog.addons ?? {}).map(([id, addon]) => ({
    ...addon,
    id,
    key: addonKey(id, addon),
    name: addon.name ?? addonKey(id, addon),
  }));
}

export function compileCatalogTopups(
  catalog: BillingCatalog,
): CompiledCatalogTopup[] {
  assertValidBillingCatalog(catalog);
  return Object.entries(catalog.topups ?? {}).map(([id, topup]) => ({
    ...topup,
    id,
    key: topupKey(id, topup),
    name: topup.name ?? topupKey(id, topup),
  }));
}

export function compileOpenMeterEntitlements(
  catalog: BillingCatalog,
  planIdOrKey: string,
): OpenMeterEntitlementPlan[] {
  assertValidBillingCatalog(catalog);
  const planEntry = findPlanEntry(catalog, planIdOrKey);

  if (!planEntry) {
    throw new Error(`Unknown catalog plan "${planIdOrKey}".`);
  }

  const [planId, plan] = planEntry;
  return Object.entries(plan.entitlements).map(([featureId, entitlement]) =>
    compileEntitlement(catalog, { kind: "plan", id: planId }, featureId, entitlement),
  );
}

export function compileOpenMeterAddonEntitlements(
  catalog: BillingCatalog,
  addonIdOrKey: string,
): OpenMeterEntitlementPlan[] {
  assertValidBillingCatalog(catalog);
  const addonEntry = findAddonEntry(catalog, addonIdOrKey);

  if (!addonEntry) {
    throw new Error(`Unknown catalog add-on "${addonIdOrKey}".`);
  }

  const [addonId, addon] = addonEntry;
  return Object.entries(addon.entitlements).map(([featureId, entitlement]) =>
    compileEntitlement(catalog, { kind: "addon", id: addonId }, featureId, entitlement),
  );
}

export function compileOpenMeterTopupGrant(
  catalog: BillingCatalog,
  topupIdOrKey: string,
): CompiledOpenMeterTopupGrant {
  assertValidBillingCatalog(catalog);
  const topupEntry = findTopupEntry(catalog, topupIdOrKey);

  if (!topupEntry) {
    throw new Error(`Unknown catalog top-up "${topupIdOrKey}".`);
  }

  const [topupId, topup] = topupEntry;
  return {
    topupId,
    topupKey: topupKey(topupId, topup),
    featureId: topup.feature,
    featureKey: featureKey(topup.feature, catalog),
    amount: topup.amount,
    priority: topup.grant?.priority,
    expiration: topup.grant?.expiration,
    maxRolloverAmount: topup.grant?.maxRolloverAmount,
    metadata: {
      ...topup.grant?.metadata,
      ...topup.metadata,
      catalogTopupId: topupId,
      catalogTopupKey: topupKey(topupId, topup),
      catalogFeatureId: topup.feature,
    },
  };
}

export function createCatalogEntitlementMapper(
  catalog: BillingCatalog,
  options: CatalogEntitlementMapperOptions = {},
): CatalogEntitlementMapper {
  assertValidBillingCatalog(catalog);
  return (event) => {
    if (!event.plan) return [];
    try {
      return compileOpenMeterEntitlements(catalog, event.plan);
    } catch (error) {
      if (options.strict) throw error;
      return [];
    }
  };
}

export function compilePaymentCatalog(
  catalog: BillingCatalog,
  provider: string,
  options: CompilePaymentCatalogOptions = {},
): CompiledPaymentCatalog {
  assertValidBillingCatalog(catalog);

  const warnings = compileCompatibilityWarnings(catalog, provider);
  if (options.strict && warnings.length) {
    throw new Error(
      `Invalid billing catalog for provider "${provider}":\n${warnings
        .map((warning) => `- ${warning}`)
        .join("\n")}`,
    );
  }

  const products: CompiledPaymentProduct[] = [];
  const prices: CompiledPaymentPrice[] = [];

  for (const [planId, plan] of Object.entries(catalog.plans)) {
    const resolvedPlanKey = planKey(planId, plan);
    const strategy = planStrategy(provider);
    const product: CompiledPaymentPlanProduct = {
      provider,
      kind: "plan",
      strategy,
      catalogPlanId: planId,
      name: plan.name ?? resolvedPlanKey,
      description: plan.description,
      productId: plan.providerIds?.[provider],
      metadata: {
        ...plan.metadata,
        catalogPlanId: planId,
        catalogPlanKey: resolvedPlanKey,
      },
    };
    products.push(product);

    for (const [priceId, price] of Object.entries(plan.prices ?? {})) {
      const compiledPrice: CompiledPaymentPlanPrice = {
        provider,
        kind: "plan",
        strategy,
        catalogPlanId: planId,
        catalogPriceId: priceId,
        lookupKey: price.lookupKey ?? `${resolvedPlanKey}:${priceId}`,
        amount: price.amount,
        currency: price.currency.toLowerCase(),
        interval: price.interval,
        intervalCount: price.intervalCount,
        trialDays: price.trialDays,
        priceId: price.providerIds?.[provider],
        metadata: {
          ...price.metadata,
          catalogPlanId: planId,
          catalogPlanKey: resolvedPlanKey,
          catalogPriceId: priceId,
          provider,
        },
      };
      prices.push(compiledPrice);
    }
  }

  for (const [addonId, addon] of Object.entries(catalog.addons ?? {})) {
    const resolvedAddonKey = addonKey(addonId, addon);
    const compatiblePlanIds = normalizeCompatiblePlanIds(catalog, addon.compatiblePlans);
    const defaultStrategy = addonStrategy(provider, undefined);
    const product: CompiledPaymentAddonProduct = {
      provider,
      kind: "addon",
      strategy: defaultStrategy,
      catalogAddonId: addonId,
      name: addon.name ?? resolvedAddonKey,
      description: addon.description,
      productId: addon.providerIds?.[provider],
      compatiblePlanIds,
      multiple: addon.multiple ?? false,
      quantity: addon.quantity,
      metadata: {
        ...addon.metadata,
        catalogAddonId: addonId,
        catalogAddonKey: resolvedAddonKey,
      },
    };
    products.push(product);

    for (const [priceId, price] of Object.entries(addon.prices ?? {})) {
      const strategy = addonStrategy(provider, price.interval);
      const compiledPrice: CompiledPaymentAddonPrice = {
        provider,
        kind: "addon",
        strategy,
        catalogAddonId: addonId,
        catalogPriceId: priceId,
        lookupKey: price.lookupKey ?? `${resolvedAddonKey}:${priceId}`,
        amount: price.amount,
        currency: price.currency.toLowerCase(),
        interval: price.interval,
        intervalCount: price.intervalCount,
        trialDays: price.trialDays,
        priceId: price.providerIds?.[provider],
        compatiblePlanIds,
        metadata: {
          ...price.metadata,
          catalogAddonId: addonId,
          catalogAddonKey: resolvedAddonKey,
          catalogPriceId: priceId,
          provider,
        },
      };
      prices.push(compiledPrice);
    }
  }

  for (const [topupId, topup] of Object.entries(catalog.topups ?? {})) {
    const resolvedTopupKey = topupKey(topupId, topup);
    const compatiblePlanIds = normalizeCompatiblePlanIds(catalog, topup.compatiblePlans);
    const strategy = topupStrategy(provider);
    const product: CompiledPaymentTopupProduct = {
      provider,
      kind: "topup",
      strategy,
      catalogTopupId: topupId,
      name: topup.name ?? resolvedTopupKey,
      description: topup.description,
      productId: topup.providerIds?.[provider],
      featureId: topup.feature,
      amount: topup.amount,
      compatiblePlanIds,
      metadata: {
        ...topup.metadata,
        catalogTopupId: topupId,
        catalogTopupKey: resolvedTopupKey,
        catalogFeatureId: topup.feature,
      },
    };
    products.push(product);

    for (const [priceId, price] of Object.entries(topup.prices)) {
      const compiledPrice: CompiledPaymentTopupPrice = {
        provider,
        kind: "topup",
        strategy,
        catalogTopupId: topupId,
        catalogPriceId: priceId,
        lookupKey: price.lookupKey ?? `${resolvedTopupKey}:${priceId}`,
        amount: price.amount,
        currency: price.currency.toLowerCase(),
        interval: price.interval,
        intervalCount: price.intervalCount,
        trialDays: price.trialDays,
        priceId: price.providerIds?.[provider],
        featureId: topup.feature,
        compatiblePlanIds,
        metadata: {
          ...price.metadata,
          catalogTopupId: topupId,
          catalogTopupKey: resolvedTopupKey,
          catalogPriceId: priceId,
          catalogFeatureId: topup.feature,
          provider,
        },
      };
      prices.push(compiledPrice);
    }
  }

  return { provider, products, prices, warnings };
}

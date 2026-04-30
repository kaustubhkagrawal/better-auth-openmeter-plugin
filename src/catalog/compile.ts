import type { OpenMeterEntitlementPlan } from "../adapters/billing";
import type {
  BillingCatalog,
  BillingCatalogEntitlement,
  BillingCatalogPlan,
  CatalogEntitlementMapper,
  CatalogEntitlementMapperOptions,
  CompiledCatalogFeature,
  CompiledCatalogPlan,
  CompiledPaymentCatalog,
  CompiledPaymentPrice,
  CompiledPaymentProduct,
} from "./types";
import { assertValidBillingCatalog } from "./validate";

function featureKey(featureId: string, catalog: BillingCatalog) {
  return catalog.features[featureId]?.key ?? featureId;
}

function planKey(planId: string, plan: BillingCatalogPlan) {
  return plan.key ?? planId;
}

function entitlementMetadata(
  planId: string,
  featureId: string,
  entitlement: BillingCatalogEntitlement,
) {
  const metadata =
    typeof entitlement === "object" && !Array.isArray(entitlement)
      ? entitlement.metadata
      : undefined;
  return {
    ...metadata,
    catalogPlanId: planId,
    catalogFeatureId: featureId,
  };
}

function compileEntitlement(
  catalog: BillingCatalog,
  planId: string,
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
        ...entitlementMetadata(planId, featureId, entitlement),
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
      metadata: entitlementMetadata(planId, featureId, entitlement),
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
    metadata: entitlementMetadata(planId, featureId, entitlement),
  };
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

export function compileOpenMeterEntitlements(
  catalog: BillingCatalog,
  planIdOrKey: string,
): OpenMeterEntitlementPlan[] {
  assertValidBillingCatalog(catalog);
  const planEntry = Object.entries(catalog.plans).find(
    ([planId, plan]) => planId === planIdOrKey || planKey(planId, plan) === planIdOrKey,
  );

  if (!planEntry) {
    throw new Error(`Unknown catalog plan "${planIdOrKey}".`);
  }

  const [planId, plan] = planEntry;
  return Object.entries(plan.entitlements).map(([featureId, entitlement]) =>
    compileEntitlement(catalog, planId, featureId, entitlement),
  );
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
): CompiledPaymentCatalog {
  assertValidBillingCatalog(catalog);

  const products: CompiledPaymentProduct[] = [];
  const prices: CompiledPaymentPrice[] = [];

  for (const [planId, plan] of Object.entries(catalog.plans)) {
    const resolvedPlanKey = planKey(planId, plan);
    const product: CompiledPaymentProduct = {
      provider,
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
      const compiledPrice: CompiledPaymentPrice = {
        provider,
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

  return { provider, products, prices };
}

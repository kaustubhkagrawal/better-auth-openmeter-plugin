import type {
  BillingCatalog,
  BillingCatalogEntitlement,
  BillingCatalogFeatureType,
  BillingCatalogPrice,
  BillingCatalogValidationIssue,
} from "./types";

function issue(path: string, message: string): BillingCatalogValidationIssue {
  return { path, message };
}

function inferEntitlementType(
  entitlement: BillingCatalogEntitlement,
): BillingCatalogFeatureType {
  if (typeof entitlement === "boolean") return "boolean";
  if (typeof entitlement === "number") return "metered";
  if (typeof entitlement === "string") return "static";
  if (entitlement.type) return entitlement.type;
  if ("amount" in entitlement) return "metered";
  if ("config" in entitlement) return "static";
  return "boolean";
}

function formatIssues(issues: BillingCatalogValidationIssue[]) {
  return issues
    .map((catalogIssue) => `- ${catalogIssue.path}: ${catalogIssue.message}`)
    .join("\n");
}

function planReferenceIndex(catalog: BillingCatalog) {
  const planRefs = new Map<string, string>();
  for (const [planId, plan] of Object.entries(catalog.plans)) {
    planRefs.set(planId, planId);
    planRefs.set(plan.key ?? planId, planId);
  }
  return planRefs;
}

function compatiblePlanRefs(
  catalog: BillingCatalog,
  compatiblePlans: string[] | undefined,
) {
  return compatiblePlans?.length ? compatiblePlans : Object.keys(catalog.plans);
}

function validateEntitlements(
  catalog: BillingCatalog,
  basePath: string,
  entitlements: Record<string, BillingCatalogEntitlement>,
  issues: BillingCatalogValidationIssue[],
) {
  for (const [featureId, entitlement] of Object.entries(entitlements)) {
    const feature = catalog.features[featureId];
    if (!feature) {
      issues.push(
        issue(
          `${basePath}.${featureId}`,
          `Catalog item references missing feature "${featureId}".`,
        ),
      );
      continue;
    }

    const entitlementType = inferEntitlementType(entitlement);
    if (entitlementType !== feature.type) {
      issues.push(
        issue(
          `${basePath}.${featureId}`,
          `Entitlement type "${entitlementType}" does not match feature type "${feature.type}".`,
        ),
      );
    }

    if (
      entitlementType === "metered" &&
      typeof entitlement === "number" &&
      entitlement < 0
    ) {
      issues.push(
        issue(
          `${basePath}.${featureId}`,
          "Metered entitlement amount must be greater than or equal to 0.",
        ),
      );
    }

    if (
      entitlementType === "metered" &&
      typeof entitlement === "object" &&
      "amount" in entitlement &&
      entitlement.amount < 0
    ) {
      issues.push(
        issue(
          `${basePath}.${featureId}.amount`,
          "Metered entitlement amount must be greater than or equal to 0.",
        ),
      );
    }
  }
}

function validatePrices(
  prices: Record<string, BillingCatalogPrice> | undefined,
  basePath: string,
  issues: BillingCatalogValidationIssue[],
) {
  for (const [priceId, price] of Object.entries(prices ?? {})) {
    if (!Number.isInteger(price.amount) || price.amount < 0) {
      issues.push(
        issue(
          `${basePath}.${priceId}.amount`,
          "Price amount must be a non-negative integer in the smallest currency unit.",
        ),
      );
    }

    if (!/^[a-zA-Z]{3}$/.test(price.currency)) {
      issues.push(
        issue(
          `${basePath}.${priceId}.currency`,
          "Price currency must be a three-letter ISO currency code.",
        ),
      );
    }

    if (
      price.intervalCount !== undefined &&
      (!Number.isInteger(price.intervalCount) || price.intervalCount <= 0)
    ) {
      issues.push(
        issue(
          `${basePath}.${priceId}.intervalCount`,
          "Price intervalCount must be a positive integer when provided.",
        ),
      );
    }

    if (
      price.trialDays !== undefined &&
      (!Number.isInteger(price.trialDays) || price.trialDays < 0)
    ) {
      issues.push(
        issue(
          `${basePath}.${priceId}.trialDays`,
          "Price trialDays must be a non-negative integer when provided.",
        ),
      );
    }
  }
}

function recurringIntervals(prices: Record<string, BillingCatalogPrice> | undefined) {
  return Array.from(
    new Set(
      Object.values(prices ?? {})
        .map((price) => price.interval)
        .filter((interval): interval is string => !!interval && interval !== "one_time"),
    ),
  );
}

function validateCompatiblePlans(
  compatiblePlans: string[] | undefined,
  planRefs: Map<string, string>,
  basePath: string,
  issues: BillingCatalogValidationIssue[],
) {
  for (const [index, planRef] of (compatiblePlans ?? []).entries()) {
    if (!planRefs.has(planRef)) {
      issues.push(
        issue(
          `${basePath}.${index}`,
          `Catalog item references missing compatible plan "${planRef}".`,
        ),
      );
    }
  }
}

function validateMatchingBillingCadence(
  catalog: BillingCatalog,
  provider: string,
  issues: BillingCatalogValidationIssue[],
) {
  const normalizedProvider = provider.toLowerCase();
  if (normalizedProvider !== "openmeter" && normalizedProvider !== "dodo") {
    return;
  }

  const planRefs = planReferenceIndex(catalog);

  for (const [addonId, addon] of Object.entries(catalog.addons ?? {})) {
    const addonIntervals = recurringIntervals(addon.prices);
    if (!addonIntervals.length) continue;

    for (const planRef of compatiblePlanRefs(catalog, addon.compatiblePlans)) {
      const planId = planRefs.get(planRef);
      if (!planId) continue;
      const plan = catalog.plans[planId];
      if (!plan) continue;
      const planIntervals = new Set(recurringIntervals(plan.prices));

      for (const interval of addonIntervals) {
        if (planIntervals.has(interval)) continue;
        issues.push(
          issue(
            `addons.${addonId}.compatiblePlans`,
            `${
              normalizedProvider === "openmeter" ? "OpenMeter" : "Dodo Payments"
            } requires recurring add-on interval "${interval}" to match a recurring price on compatible plan "${planRef}".`,
          ),
        );
      }
    }
  }
}

export function validateBillingCatalog(
  catalog: BillingCatalog,
): BillingCatalogValidationIssue[] {
  const issues: BillingCatalogValidationIssue[] = [];
  const featureKeys = new Map<string, string>();
  const planKeys = new Map<string, string>();
  const addonKeys = new Map<string, string>();
  const topupKeys = new Map<string, string>();
  const planRefs = planReferenceIndex(catalog);

  for (const [featureId, feature] of Object.entries(catalog.features)) {
    const featureKey = feature.key ?? featureId;
    const existingFeature = featureKeys.get(featureKey);
    if (existingFeature) {
      issues.push(
        issue(
          `features.${featureId}.key`,
          `Duplicate feature key "${featureKey}" already used by "${existingFeature}".`,
        ),
      );
    }
    featureKeys.set(featureKey, featureId);

    if (feature.meter && !catalog.meters?.[feature.meter]) {
      issues.push(
        issue(
          `features.${featureId}.meter`,
          `Feature references missing meter "${feature.meter}".`,
        ),
      );
    }
  }

  for (const [planId, plan] of Object.entries(catalog.plans)) {
    const resolvedPlanKey = plan.key ?? planId;
    const existingPlan = planKeys.get(resolvedPlanKey);
    if (existingPlan) {
      issues.push(
        issue(
          `plans.${planId}.key`,
          `Duplicate plan key "${resolvedPlanKey}" already used by "${existingPlan}".`,
        ),
      );
    }
    planKeys.set(resolvedPlanKey, planId);

    if (!Object.keys(plan.entitlements).length) {
      issues.push(
        issue(
          `plans.${planId}.entitlements`,
          "Plan must define at least one entitlement.",
        ),
      );
    }

    validateEntitlements(catalog, `plans.${planId}.entitlements`, plan.entitlements, issues);
    validatePrices(plan.prices, `plans.${planId}.prices`, issues);

    for (const [priceId, price] of Object.entries(plan.prices ?? {})) {
      if (price.interval === "one_time") {
        issues.push(
          issue(
            `plans.${planId}.prices.${priceId}.interval`,
            'Plan prices must be recurring and cannot use interval "one_time".',
          ),
        );
      }
    }
  }

  for (const [addonId, addon] of Object.entries(catalog.addons ?? {})) {
    const resolvedAddonKey = addon.key ?? addonId;
    const existingAddon = addonKeys.get(resolvedAddonKey);
    if (existingAddon) {
      issues.push(
        issue(
          `addons.${addonId}.key`,
          `Duplicate add-on key "${resolvedAddonKey}" already used by "${existingAddon}".`,
        ),
      );
    }
    addonKeys.set(resolvedAddonKey, addonId);

    if (!Object.keys(addon.entitlements).length) {
      issues.push(
        issue(
          `addons.${addonId}.entitlements`,
          "Add-on must define at least one entitlement.",
        ),
      );
    }

    validateEntitlements(
      catalog,
      `addons.${addonId}.entitlements`,
      addon.entitlements,
      issues,
    );
    validatePrices(addon.prices, `addons.${addonId}.prices`, issues);
    validateCompatiblePlans(addon.compatiblePlans, planRefs, `addons.${addonId}.compatiblePlans`, issues);

    if (
      addon.quantity?.min !== undefined &&
      (!Number.isInteger(addon.quantity.min) || addon.quantity.min < 0)
    ) {
      issues.push(
        issue(
          `addons.${addonId}.quantity.min`,
          "Add-on quantity.min must be a non-negative integer when provided.",
        ),
      );
    }
    if (
      addon.quantity?.max !== undefined &&
      (!Number.isInteger(addon.quantity.max) || addon.quantity.max < 0)
    ) {
      issues.push(
        issue(
          `addons.${addonId}.quantity.max`,
          "Add-on quantity.max must be a non-negative integer when provided.",
        ),
      );
    }
    if (
      addon.quantity?.min !== undefined &&
      addon.quantity?.max !== undefined &&
      addon.quantity.max < addon.quantity.min
    ) {
      issues.push(
        issue(
          `addons.${addonId}.quantity.max`,
          "Add-on quantity.max must be greater than or equal to quantity.min.",
        ),
      );
    }
  }

  for (const [topupId, topup] of Object.entries(catalog.topups ?? {})) {
    const resolvedTopupKey = topup.key ?? topupId;
    const existingTopup = topupKeys.get(resolvedTopupKey);
    if (existingTopup) {
      issues.push(
        issue(
          `topups.${topupId}.key`,
          `Duplicate top-up key "${resolvedTopupKey}" already used by "${existingTopup}".`,
        ),
      );
    }
    topupKeys.set(resolvedTopupKey, topupId);

    const feature = catalog.features[topup.feature];
    if (!feature) {
      issues.push(
        issue(
          `topups.${topupId}.feature`,
          `Top-up references missing feature "${topup.feature}".`,
        ),
      );
    } else if (feature.type !== "metered") {
      issues.push(
        issue(
          `topups.${topupId}.feature`,
          `Top-up feature "${topup.feature}" must be metered; received "${feature.type}".`,
        ),
      );
    }

    if (topup.amount < 0) {
      issues.push(
        issue(
          `topups.${topupId}.amount`,
          "Top-up amount must be greater than or equal to 0.",
        ),
      );
    }

    if (!Object.keys(topup.prices).length) {
      issues.push(
        issue(
          `topups.${topupId}.prices`,
          "Top-up must define at least one one-time purchase price.",
        ),
      );
    }

    validatePrices(topup.prices, `topups.${topupId}.prices`, issues);
    validateCompatiblePlans(
      topup.compatiblePlans,
      planRefs,
      `topups.${topupId}.compatiblePlans`,
      issues,
    );

    for (const [priceId, price] of Object.entries(topup.prices)) {
      if (price.interval !== "one_time") {
        issues.push(
          issue(
            `topups.${topupId}.prices.${priceId}.interval`,
            'Top-up prices must use interval "one_time".',
          ),
        );
      }
    }

    if (topup.grant?.priority !== undefined && topup.grant.priority < 0) {
      issues.push(
        issue(
          `topups.${topupId}.grant.priority`,
          "Top-up grant priority must be greater than or equal to 0.",
        ),
      );
    }

    if (topup.grant?.maxRolloverAmount !== undefined && topup.grant.maxRolloverAmount < 0) {
      issues.push(
        issue(
          `topups.${topupId}.grant.maxRolloverAmount`,
          "Top-up grant maxRolloverAmount must be greater than or equal to 0.",
        ),
      );
    }

    if (
      topup.grant?.expiration?.count !== undefined &&
      (!Number.isInteger(topup.grant.expiration.count) || topup.grant.expiration.count <= 0)
    ) {
      issues.push(
        issue(
          `topups.${topupId}.grant.expiration.count`,
          "Top-up grant expiration.count must be a positive integer when provided.",
        ),
      );
    }
  }

  return issues;
}

export function validateBillingCatalogProviderCompatibility(
  catalog: BillingCatalog,
  provider: string,
): BillingCatalogValidationIssue[] {
  const issues = validateBillingCatalog(catalog);
  const normalizedProvider = provider.toLowerCase();

  if (normalizedProvider === "razorpay") {
    for (const [addonId, addon] of Object.entries(catalog.addons ?? {})) {
      for (const [priceId, price] of Object.entries(addon.prices ?? {})) {
        if (price.interval === undefined || price.interval === "one_time") continue;
        issues.push(
          issue(
            `addons.${addonId}.prices.${priceId}.interval`,
            'Razorpay subscription add-ons are upfront charges on subscription creation; use interval "one_time" or move recurring capacity into plan pricing.',
          ),
        );
      }
    }

    for (const [topupId] of Object.entries(catalog.topups ?? {})) {
      issues.push(
        issue(
          `topups.${topupId}`,
          "Razorpay subscriptions do not expose a first-class top-up catalog primitive. Charge the customer through your own payment flow and apply the OpenMeter grant after payment succeeds.",
        ),
      );
    }
  }

  validateMatchingBillingCadence(catalog, normalizedProvider, issues);

  return issues;
}

export function assertValidBillingCatalog(catalog: BillingCatalog) {
  const issues = validateBillingCatalog(catalog);
  if (issues.length) {
    throw new Error(`Invalid billing catalog:\n${formatIssues(issues)}`);
  }
}

export function assertBillingCatalogProviderCompatibility(
  catalog: BillingCatalog,
  provider: string,
) {
  const issues = validateBillingCatalogProviderCompatibility(catalog, provider);
  if (issues.length) {
    throw new Error(
      `Invalid billing catalog for provider "${provider}":\n${formatIssues(issues)}`,
    );
  }
}

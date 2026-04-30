import type {
  BillingCatalog,
  BillingCatalogEntitlement,
  BillingCatalogFeatureType,
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

export function validateBillingCatalog(
  catalog: BillingCatalog,
): BillingCatalogValidationIssue[] {
  const issues: BillingCatalogValidationIssue[] = [];
  const featureKeys = new Map<string, string>();
  const planKeys = new Map<string, string>();

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
    const planKey = plan.key ?? planId;
    const existingPlan = planKeys.get(planKey);
    if (existingPlan) {
      issues.push(
        issue(
          `plans.${planId}.key`,
          `Duplicate plan key "${planKey}" already used by "${existingPlan}".`,
        ),
      );
    }
    planKeys.set(planKey, planId);

    for (const [featureId, entitlement] of Object.entries(plan.entitlements)) {
      const feature = catalog.features[featureId];
      if (!feature) {
        issues.push(
          issue(
            `plans.${planId}.entitlements.${featureId}`,
            `Plan references missing feature "${featureId}".`,
          ),
        );
        continue;
      }

      const entitlementType = inferEntitlementType(entitlement);
      if (entitlementType !== feature.type) {
        issues.push(
          issue(
            `plans.${planId}.entitlements.${featureId}`,
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
            `plans.${planId}.entitlements.${featureId}`,
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
            `plans.${planId}.entitlements.${featureId}.amount`,
            "Metered entitlement amount must be greater than or equal to 0.",
          ),
        );
      }
    }

    for (const [priceId, price] of Object.entries(plan.prices ?? {})) {
      if (!Number.isInteger(price.amount) || price.amount < 0) {
        issues.push(
          issue(
            `plans.${planId}.prices.${priceId}.amount`,
            "Price amount must be a non-negative integer in the smallest currency unit.",
          ),
        );
      }

      if (!/^[a-zA-Z]{3}$/.test(price.currency)) {
        issues.push(
          issue(
            `plans.${planId}.prices.${priceId}.currency`,
            "Price currency must be a three-letter ISO currency code.",
          ),
        );
      }
    }
  }

  return issues;
}

export function assertValidBillingCatalog(catalog: BillingCatalog) {
  const issues = validateBillingCatalog(catalog);
  if (issues.length) {
    throw new Error(
      `Invalid billing catalog:\n${issues
        .map((catalogIssue) => `- ${catalogIssue.path}: ${catalogIssue.message}`)
        .join("\n")}`,
    );
  }
}

import type { JsonObject } from "../types";
import type { OpenMeterEntitlementPlan } from "../adapters/billing";

export type BillingCatalogMeter = {
  key?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  aggregation?: "sum" | "count" | "unique_count" | "latest" | (string & {}) | undefined;
  eventType?: string | undefined;
  valueProperty?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type BillingCatalogFeatureType = "boolean" | "metered" | "static";

export type BillingCatalogFeature = {
  key?: string | undefined;
  type: BillingCatalogFeatureType;
  name?: string | undefined;
  description?: string | undefined;
  meter?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type BillingCatalogEntitlement =
  | boolean
  | number
  | string
  | {
      type?: "boolean" | undefined;
      enabled?: boolean | undefined;
      metadata?: JsonObject | undefined;
    }
  | {
      type?: "metered" | undefined;
      amount: number;
      reset?: "day" | "week" | "month" | "year" | (string & {}) | undefined;
      metadata?: JsonObject | undefined;
    }
  | {
      type?: "static" | undefined;
      config: string;
      metadata?: JsonObject | undefined;
    };

export type BillingCatalogPrice = {
  amount: number;
  currency: string;
  interval?: "day" | "week" | "month" | "year" | "one_time" | (string & {}) | undefined;
  intervalCount?: number | undefined;
  trialDays?: number | undefined;
  lookupKey?: string | undefined;
  providerIds?: Record<string, string> | undefined;
  metadata?: JsonObject | undefined;
};

export type BillingCatalogPlan = {
  key?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  entitlements: Record<string, BillingCatalogEntitlement>;
  prices?: Record<string, BillingCatalogPrice> | undefined;
  providerIds?: Record<string, string> | undefined;
  metadata?: JsonObject | undefined;
};

export type BillingCatalogProvider = {
  id?: string | undefined;
  enabled?: boolean | undefined;
  metadata?: JsonObject | undefined;
};

export type BillingCatalog = {
  meters?: Record<string, BillingCatalogMeter> | undefined;
  features: Record<string, BillingCatalogFeature>;
  plans: Record<string, BillingCatalogPlan>;
  providers?: Record<string, BillingCatalogProvider> | undefined;
};

export type BillingCatalogValidationIssue = {
  path: string;
  message: string;
};

export type CompiledCatalogFeature = BillingCatalogFeature & {
  id: string;
  key: string;
};

export type CompiledCatalogPlan = Omit<BillingCatalogPlan, "key"> & {
  id: string;
  key: string;
  name: string;
};

export type CompiledPaymentProduct = {
  provider: string;
  catalogPlanId: string;
  name: string;
  description?: string | undefined;
  productId?: string | undefined;
  metadata: JsonObject;
};

export type CompiledPaymentPrice = {
  provider: string;
  catalogPlanId: string;
  catalogPriceId: string;
  lookupKey: string;
  amount: number;
  currency: string;
  interval?: string | undefined;
  intervalCount?: number | undefined;
  trialDays?: number | undefined;
  priceId?: string | undefined;
  metadata: JsonObject;
};

export type CompiledPaymentCatalog = {
  provider: string;
  products: CompiledPaymentProduct[];
  prices: CompiledPaymentPrice[];
};

export type CatalogEntitlementMapperOptions = {
  /**
   * Defaults to false. When true, missing plan ids throw instead of returning
   * no entitlements.
   */
  strict?: boolean | undefined;
};

export type CatalogEntitlementMapper = (
  event: {
    plan?: string | undefined;
  },
) => OpenMeterEntitlementPlan[];

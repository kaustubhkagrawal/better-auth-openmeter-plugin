import type { JsonObject } from "../types";
import type { OpenMeterEntitlementPlan } from "../adapters/billing";

export type BillingCatalogInterval =
  | "day"
  | "week"
  | "month"
  | "year"
  | "one_time"
  | (string & {});

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
  interval?: BillingCatalogInterval | undefined;
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

export type BillingCatalogAddonQuantity = {
  min?: number | undefined;
  max?: number | undefined;
};

export type BillingCatalogAddon = {
  key?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  entitlements: Record<string, BillingCatalogEntitlement>;
  prices?: Record<string, BillingCatalogPrice> | undefined;
  compatiblePlans?: string[] | undefined;
  multiple?: boolean | undefined;
  quantity?: BillingCatalogAddonQuantity | undefined;
  providerIds?: Record<string, string> | undefined;
  metadata?: JsonObject | undefined;
};

export type BillingCatalogTopupGrantExpiration = {
  duration: string;
  count?: number | undefined;
};

export type BillingCatalogTopupGrant = {
  priority?: number | undefined;
  expiration?: BillingCatalogTopupGrantExpiration | undefined;
  maxRolloverAmount?: number | undefined;
  metadata?: JsonObject | undefined;
};

export type BillingCatalogTopup = {
  key?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  feature: string;
  amount: number;
  prices: Record<string, BillingCatalogPrice>;
  compatiblePlans?: string[] | undefined;
  providerIds?: Record<string, string> | undefined;
  grant?: BillingCatalogTopupGrant | undefined;
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
  addons?: Record<string, BillingCatalogAddon> | undefined;
  topups?: Record<string, BillingCatalogTopup> | undefined;
  providers?: Record<string, BillingCatalogProvider> | undefined;
};

export type BillingCatalogValidationIssue = {
  path: string;
  message: string;
};

export type BillingCatalogSellableKind = "plan" | "addon" | "topup";

export type CompiledCatalogFeature = BillingCatalogFeature & {
  id: string;
  key: string;
};

export type CompiledCatalogPlan = Omit<BillingCatalogPlan, "key"> & {
  id: string;
  key: string;
  name: string;
};

export type CompiledCatalogAddon = Omit<BillingCatalogAddon, "key"> & {
  id: string;
  key: string;
  name: string;
};

export type CompiledCatalogTopup = Omit<BillingCatalogTopup, "key"> & {
  id: string;
  key: string;
  name: string;
};

export type CompiledPaymentStrategy =
  | "subscription_product"
  | "subscription_plan"
  | "subscription_item"
  | "subscription_addon"
  | "invoice_item"
  | "one_time_checkout"
  | "manual_charge";

type CompiledPaymentProductBase = {
  provider: string;
  kind: BillingCatalogSellableKind;
  strategy: CompiledPaymentStrategy;
  name: string;
  description?: string | undefined;
  productId?: string | undefined;
  metadata: JsonObject;
};

export type CompiledPaymentPlanProduct = CompiledPaymentProductBase & {
  kind: "plan";
  catalogPlanId: string;
};

export type CompiledPaymentAddonProduct = CompiledPaymentProductBase & {
  kind: "addon";
  catalogAddonId: string;
  compatiblePlanIds: string[];
  multiple: boolean;
  quantity?: BillingCatalogAddonQuantity | undefined;
};

export type CompiledPaymentTopupProduct = CompiledPaymentProductBase & {
  kind: "topup";
  catalogTopupId: string;
  featureId: string;
  amount: number;
  compatiblePlanIds: string[];
};

export type CompiledPaymentProduct =
  | CompiledPaymentPlanProduct
  | CompiledPaymentAddonProduct
  | CompiledPaymentTopupProduct;

type CompiledPaymentPriceBase = {
  provider: string;
  kind: BillingCatalogSellableKind;
  strategy: CompiledPaymentStrategy;
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

export type CompiledPaymentPlanPrice = CompiledPaymentPriceBase & {
  kind: "plan";
  catalogPlanId: string;
};

export type CompiledPaymentAddonPrice = CompiledPaymentPriceBase & {
  kind: "addon";
  catalogAddonId: string;
  compatiblePlanIds: string[];
};

export type CompiledPaymentTopupPrice = CompiledPaymentPriceBase & {
  kind: "topup";
  catalogTopupId: string;
  featureId: string;
  compatiblePlanIds: string[];
};

export type CompiledPaymentPrice =
  | CompiledPaymentPlanPrice
  | CompiledPaymentAddonPrice
  | CompiledPaymentTopupPrice;

export type CompiledPaymentCatalog = {
  provider: string;
  products: CompiledPaymentProduct[];
  prices: CompiledPaymentPrice[];
  warnings: string[];
};

export type CompilePaymentCatalogOptions = {
  /**
   * Defaults to false. When true, provider compatibility issues throw instead
   * of being emitted as warnings on the compiled catalog.
   */
  strict?: boolean | undefined;
};

export type CompiledOpenMeterTopupGrant = {
  topupId: string;
  topupKey: string;
  featureId: string;
  featureKey: string;
  amount: number;
  priority?: number | undefined;
  expiration?: BillingCatalogTopupGrantExpiration | undefined;
  maxRolloverAmount?: number | undefined;
  metadata: JsonObject;
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

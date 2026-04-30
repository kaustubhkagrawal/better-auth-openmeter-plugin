import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
  createCatalogEntitlementMapper,
  type BillingCatalog,
  type CatalogEntitlementMapperOptions,
} from "../catalog";
import type { JsonObject, OpenMeterUsageEvent } from "../types";
import {
  assertOpenMeterPlugin,
  getOpenMeterClient,
  type OpenMeterAdapterOptions,
  withAdapterDefaults,
} from "./shared";

export type OpenMeterBillingEventType =
  | "subscription.created"
  | "subscription.active"
  | "subscription.updated"
  | "subscription.canceled"
  | "subscription.deleted"
  | "invoice.paid"
  | "trial.started"
  | "trial.ended"
  | (string & {});

export type OpenMeterBillingEvent = {
  type: OpenMeterBillingEventType;
  customerIdOrKey: string;
  subject?: string | undefined;
  provider: string;
  referenceId?: string | undefined;
  customerType?: "user" | "organization" | (string & {}) | undefined;
  plan?: string | undefined;
  subscriptionId?: string | undefined;
  metadata?: JsonObject | undefined;
  raw?: unknown;
};

export type OpenMeterEntitlementPlan = {
  featureKey: string;
  type: "boolean" | "metered" | "static";
  /**
   * For metered entitlements, this is the grant amount to create.
   */
  amount?: number | undefined;
  /**
   * For static entitlements, this is the string config to expose.
   */
  config?: string | undefined;
  metadata?: JsonObject | undefined;
};

export type OpenMeterBillingProvider = {
  id: string;
  /**
   * Optional plugin contract supplied by the provider. Provider-specific
   * packages can return hooks/endpoints here that translate gateway events into
   * generic billing events.
   */
  plugin?: BetterAuthPlugin | undefined;
};

export type OpenMeterBillingAdapterOptions = OpenMeterAdapterOptions & {
  provider?: OpenMeterBillingProvider | undefined;
  requireOpenMeterPlugin?: boolean | undefined;
  catalog?: BillingCatalog | undefined;
  catalogMapperOptions?: CatalogEntitlementMapperOptions | undefined;
  /**
   * Defaults to "openmeter". Set to "none" when another catalog/subscription
   * system is the entitlement source of truth and billing events should only be
   * mirrored or audited.
   */
  entitlementMode?: "openmeter" | "none" | undefined;
  /**
   * Defaults to true. When true, billing events are also ingested as usage
   * events for auditability.
   */
  ingestBillingEvents?: boolean | undefined;
  mapPlanToEntitlements?:
    | ((
        event: OpenMeterBillingEvent,
        ctx: GenericEndpointContext,
      ) => OpenMeterEntitlementPlan[] | Promise<OpenMeterEntitlementPlan[]>)
    | undefined;
  buildEvent?:
    | ((
        event: OpenMeterBillingEvent,
        ctx: GenericEndpointContext,
      ) => OpenMeterUsageEvent | Promise<OpenMeterUsageEvent>)
    | undefined;
  onBillingEvent?:
    | ((
        event: OpenMeterBillingEvent,
        ctx: GenericEndpointContext,
      ) => Promise<void> | void)
    | undefined;
};

export async function applyOpenMeterBillingEvent(
  event: OpenMeterBillingEvent,
  ctx: GenericEndpointContext,
  options: OpenMeterBillingAdapterOptions = {},
) {
  const client = getOpenMeterClient(ctx, options);
  const ingestBillingEvents = options.ingestBillingEvents !== false;

  if (ingestBillingEvents) {
    const usageEvent = options.buildEvent
      ? await options.buildEvent(event, ctx)
      : withAdapterDefaults(
          {
            type: `better-auth.billing.${event.type}`,
            subject: event.subject ?? event.customerIdOrKey,
            data: {
              provider: event.provider,
              referenceId: event.referenceId,
              customerType: event.customerType,
              plan: event.plan,
              subscriptionId: event.subscriptionId,
              metadata: event.metadata,
            },
          },
          options,
        );

    await client.events.ingest(usageEvent as never);
  }

  const mapPlanToEntitlements =
    options.mapPlanToEntitlements ??
    (options.catalog && options.entitlementMode !== "none"
      ? createCatalogEntitlementMapper(
          options.catalog,
          options.catalogMapperOptions,
        )
      : undefined);

  const entitlements = await mapPlanToEntitlements?.(event, ctx);
  if (entitlements?.length) {
    for (const entitlement of entitlements) {
      await client.customers.entitlements.create(
        event.customerIdOrKey,
        entitlement as never,
      );
    }
  }

  await options.onBillingEvent?.(event, ctx);
}

export const openmeterBillingAdapter = (
  options: OpenMeterBillingAdapterOptions = {},
) => {
  const requireOpenMeterPlugin = options.requireOpenMeterPlugin !== false;

  return {
    id: "openmeter-billing-adapter",
    init(ctx) {
      if (requireOpenMeterPlugin) {
        assertOpenMeterPlugin(ctx);
      }
      options.provider?.plugin?.init?.(ctx);
    },
    hooks: options.provider?.plugin?.hooks,
    endpoints: options.provider?.plugin?.endpoints,
    middlewares: options.provider?.plugin?.middlewares,
    options,
  } satisfies BetterAuthPlugin;
};

export const billingAdapter = openmeterBillingAdapter;

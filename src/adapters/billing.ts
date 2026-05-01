import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
  compileOpenMeterTopupGrant,
  createCatalogEntitlementMapper,
  type BillingCatalog,
  type CatalogEntitlementMapperOptions,
  type CompiledOpenMeterTopupGrant,
} from "../catalog";
import type {
  JsonObject,
  OpenMeterClient,
  OpenMeterEntitlementGrant,
  OpenMeterUsageEvent,
} from "../types";
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

export type OpenMeterCatalogTopupInput = {
  customerIdOrKey: string;
  topup: string;
  subject?: string | undefined;
  provider?: string | undefined;
  referenceId?: string | undefined;
  /**
   * Stable key for de-duplicating grant creation across webhook retries.
   * Defaults to `paymentId` when omitted.
   */
  idempotencyKey?: string | undefined;
  paymentId?: string | undefined;
  effectiveAt?: string | Date | undefined;
  metadata?: JsonObject | undefined;
  annotations?: JsonObject | undefined;
};

export type OpenMeterTopupGrantCreateInput = Parameters<
  OpenMeterClient["customers"]["entitlements"]["createGrant"]
>[2];
type OpenMeterTopupGrantExpiration = NonNullable<
  OpenMeterTopupGrantCreateInput["expiration"]
>;

export type OpenMeterCatalogTopupResult = {
  input: OpenMeterCatalogTopupInput;
  compiledTopup: CompiledOpenMeterTopupGrant;
  grantInput: OpenMeterTopupGrantCreateInput;
  grant: OpenMeterEntitlementGrant;
  /**
   * True when this call created a new OpenMeter grant. False when an existing
   * grant was found by metadata idempotency lookup.
   */
  created: boolean;
  idempotencyKey?: string | undefined;
};

export type OpenMeterCatalogTopupOptions = OpenMeterAdapterOptions & {
  catalog: BillingCatalog;
  /**
   * Defaults to "metadata". When `input.idempotencyKey` or `input.paymentId`
   * exists, the helper checks existing OpenMeter grants for matching metadata
   * before creating a new grant. Set to "none" for app-owned idempotency only.
   */
  idempotency?: "metadata" | "none" | undefined;
  /**
   * Defaults to true. When true, top-up grants are also ingested as usage
   * events for auditability.
   */
  ingestTopupEvents?: boolean | undefined;
  buildEvent?:
    | ((
        result: OpenMeterCatalogTopupResult,
        ctx: GenericEndpointContext,
      ) => OpenMeterUsageEvent | Promise<OpenMeterUsageEvent>)
    | undefined;
  onTopupGranted?:
    | ((
        result: OpenMeterCatalogTopupResult,
        ctx: GenericEndpointContext,
      ) => Promise<void> | void)
    | undefined;
};

function toOpenMeterMetadata(
  metadata?: JsonObject | undefined,
): OpenMeterTopupGrantCreateInput["metadata"] {
  if (!metadata) return undefined;

  const entries = Object.entries(metadata).flatMap(([key, value]) => {
    if (value === undefined) return [];
    if (typeof value === "string") return [[key, value] as const];
    return [[key, JSON.stringify(value)] as const];
  });

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeGrantExpiration(
  expiration?: CompiledOpenMeterTopupGrant["expiration"] | undefined,
): OpenMeterTopupGrantCreateInput["expiration"] {
  if (!expiration) return undefined;
  return {
    duration: expiration.duration.toUpperCase() as OpenMeterTopupGrantExpiration["duration"],
    count: expiration.count ?? 1,
  };
}

function resolveEffectiveAt(value?: string | Date | undefined) {
  const effectiveAt = value ? new Date(value) : new Date();
  if (Number.isNaN(effectiveAt.valueOf())) {
    throw new Error('Invalid top-up effectiveAt; expected a valid Date or ISO timestamp.');
  }
  return effectiveAt;
}

type OpenMeterTopupGrantList = {
  items?: Array<NonNullable<OpenMeterEntitlementGrant> & {
    metadata?: Record<string, string> | null | undefined;
  }>;
};

function resolveTopupIdempotencyKey(input: OpenMeterCatalogTopupInput) {
  return input.idempotencyKey ?? input.paymentId;
}

async function findExistingTopupGrant(
  client: OpenMeterClient,
  customerIdOrKey: string,
  featureKey: string,
  idempotencyKey: string,
) {
  const grants = (await client.customers.entitlements.listGrants(
    customerIdOrKey,
    featureKey,
  )) as OpenMeterTopupGrantList | undefined;

  return grants?.items?.find((grant) => {
    return grant.metadata?.idempotencyKey === idempotencyKey;
  }) as OpenMeterEntitlementGrant;
}

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

export async function applyCatalogTopupGrant(
  input: OpenMeterCatalogTopupInput,
  ctx: GenericEndpointContext,
  options: OpenMeterCatalogTopupOptions,
) {
  const client = getOpenMeterClient(ctx, options);
  const compiledTopup = compileOpenMeterTopupGrant(options.catalog, input.topup);
  const expiration = normalizeGrantExpiration(compiledTopup.expiration);
  const idempotencyKey = resolveTopupIdempotencyKey(input);
  const metadata = toOpenMeterMetadata({
    ...compiledTopup.metadata,
    ...input.metadata,
    provider: input.provider,
    referenceId: input.referenceId,
    paymentId: input.paymentId,
    idempotencyKey,
  });
  const grantInput: OpenMeterTopupGrantCreateInput = {
    amount: compiledTopup.amount,
    effectiveAt: resolveEffectiveAt(input.effectiveAt),
    ...(compiledTopup.priority !== undefined
      ? { priority: compiledTopup.priority }
      : {}),
    ...(expiration ? { expiration } : {}),
    ...(compiledTopup.maxRolloverAmount !== undefined
      ? { maxRolloverAmount: compiledTopup.maxRolloverAmount }
      : {}),
    ...(metadata ? { metadata } : {}),
    ...(input.annotations ? { annotations: input.annotations } : {}),
  };

  const existingGrant =
    idempotencyKey && options.idempotency !== "none"
      ? await findExistingTopupGrant(
          client,
          input.customerIdOrKey,
          compiledTopup.featureKey,
          idempotencyKey,
        )
      : undefined;

  const grant =
    existingGrant ??
    (await client.customers.entitlements.createGrant(
      input.customerIdOrKey,
      compiledTopup.featureKey,
      grantInput,
    ));

  const result: OpenMeterCatalogTopupResult = {
    input,
    compiledTopup,
    grantInput,
    grant,
    created: !existingGrant,
    idempotencyKey,
  };

  if (options.ingestTopupEvents !== false) {
    const usageEvent = options.buildEvent
      ? await options.buildEvent(result, ctx)
      : withAdapterDefaults(
          {
            ...(idempotencyKey
              ? {
                  id: `topup:${input.customerIdOrKey}:${compiledTopup.featureKey}:${idempotencyKey}`,
                }
              : {}),
            type: "better-auth.billing.topup.applied",
            subject: input.subject ?? input.customerIdOrKey,
            data: {
              provider: input.provider,
              referenceId: input.referenceId,
              paymentId: input.paymentId,
              topupId: compiledTopup.topupId,
              topupKey: compiledTopup.topupKey,
              featureKey: compiledTopup.featureKey,
              amount: compiledTopup.amount,
              grantId: grant?.id,
              created: result.created,
              deduped: !result.created,
              idempotencyKey,
              metadata: grantInput.metadata,
            },
          },
          options,
        );

    await client.events.ingest(usageEvent as never);
  }

  await options.onTopupGranted?.(result, ctx);
  return result;
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

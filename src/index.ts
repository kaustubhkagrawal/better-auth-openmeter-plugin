import type { BetterAuthPlugin, GenericEndpointContext, User } from "better-auth";
import { OpenMeter } from "@openmeter/sdk";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  requireOrgRole,
  sessionMiddleware,
} from "better-auth/api";
import * as z from "zod";
import { getSchema } from "./schema";
import type {
  OpenMeterClient,
  OpenMeterOrganization,
  OpenMeterOptions,
  OpenMeterUsageEvent,
  WithOpenMeterCustomerId,
} from "./types";
import {
  OPENMETER_ERROR_CODES,
  addDefaultOrganizationSubject,
  addDefaultSubject,
  assertOpenMeterClient,
  authPathToEventType,
  createAPIError,
  normalizeUsageEvents,
  resolveOrganizationCustomerKey,
  resolveOrganizationCustomerProfile,
  resolveOrganizationSubject,
  resolveCustomerKey,
  resolveCustomerProfile,
  resolveSubject,
} from "./utils";

export { OPENMETER_ERROR_CODES } from "./utils";
export { getSchema, user as openmeterUserSchema } from "./schema";
export {
  defineBillingCatalog,
  compileCatalogFeatures,
  compileCatalogPlans,
  compileOpenMeterEntitlements,
  compilePaymentCatalog,
  createCatalogEntitlementMapper,
  assertValidBillingCatalog,
  validateBillingCatalog,
} from "./catalog";
export type {
  BillingCatalog,
  BillingCatalogEntitlement,
  BillingCatalogFeature,
  BillingCatalogMeter,
  BillingCatalogPlan,
  BillingCatalogPrice,
  BillingCatalogProvider,
  BillingCatalogValidationIssue,
  CompiledPaymentCatalog,
  CompiledPaymentPrice,
  CompiledPaymentProduct,
} from "./catalog";
export type {
  JsonObject,
  OpenMeterClient,
  OpenMeterCustomer,
  OpenMeterCustomerProfile,
  OpenMeterOptions,
  OpenMeterUsageEvent,
  WithOpenMeterCustomerId,
} from "./types";

const metadataSchema = z.record(z.string(), z.unknown());

const usageEventSchema = z
  .object({
    id: z.string().min(1).optional(),
    specversion: z.literal("1.0").optional(),
    type: z.string().min(1),
    source: z.string().min(1).optional(),
    subject: z.string().min(1).optional(),
    time: z.union([z.string().min(1), z.date()]).optional(),
    data: metadataSchema.optional(),
  })
  .passthrough();

const ingestEventsBodySchema = z
  .object({
    events: z
      .union([usageEventSchema, z.array(usageEventSchema).min(1)])
      .optional(),
    id: z.string().min(1).optional(),
    specversion: z.literal("1.0").optional(),
    type: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    subject: z.string().min(1).optional(),
    time: z.union([z.string().min(1), z.date()]).optional(),
    data: metadataSchema.optional(),
  })
  .passthrough()
  .superRefine((body, ctx) => {
    if (!body.events && !body.type) {
      ctx.addIssue({
        code: "custom",
        message: OPENMETER_ERROR_CODES.INVALID_EVENT,
        path: ["type"],
      });
    }
  });

const syncCustomerBodySchema = z.object({
  metadata: metadataSchema.optional(),
});

const organizationBodySchema = z.object({
  organizationId: z.string().min(1),
});

const syncOrganizationCustomerBodySchema = organizationBodySchema.extend({
  metadata: metadataSchema.optional(),
});

const organizationEventBodySchema = ingestEventsBodySchema.and(
  organizationBodySchema,
);

const organizationQuerySchema = z.object({
  organizationId: z.string().min(1),
});

const entitlementQuerySchema = z.object({
  featureKey: z.string().min(1),
});

const organizationEntitlementQuerySchema = organizationQuerySchema.extend({
  featureKey: z.string().min(1),
});

declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    openmeter: {
      creator: typeof openmeter;
    };
  }
}

function getResolvedClient(options: OpenMeterOptions): OpenMeterClient {
  if (options.openmeterClient) return options.openmeterClient;
  if (!options.apiKey && !options.baseUrl) {
    throw new Error("Provide openmeterClient or apiKey/baseUrl for OpenMeter.");
  }

  const config: { baseUrl: string; apiKey?: string } = {
    baseUrl: options.baseUrl ?? "https://openmeter.cloud",
  };

  if (options.apiKey) {
    config.apiKey = options.apiKey;
  }

  return new OpenMeter(config) as OpenMeterClient;
}

async function reportOpenMeterError(
  options: OpenMeterOptions,
  operation: string,
  error: unknown,
  ctx?: GenericEndpointContext,
  user?: User & WithOpenMeterCustomerId,
  organization?: OpenMeterOrganization,
) {
  await options.callbacks?.onError?.(
    error,
    { operation, user, organization },
    ctx,
  );

  if (options.failOnOpenMeterError) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  ctx?.context.logger.error(`OpenMeter ${operation} failed: ${message}`);
}

async function updateUserOpenMeterCustomerId(
  ctx: GenericEndpointContext,
  userId: string,
  openmeterCustomerId: string,
) {
  if (ctx.context.internalAdapter?.updateUser) {
    await ctx.context.internalAdapter.updateUser(userId, {
      openmeterCustomerId,
    });
    return;
  }

  await ctx.context.adapter.update({
    model: "user",
    update: { openmeterCustomerId },
    where: [{ field: "id", value: userId }],
  });
}

async function updateOrganizationOpenMeterCustomerId(
  ctx: GenericEndpointContext,
  organizationId: string,
  openmeterCustomerId: string,
) {
  await ctx.context.adapter.update({
    model: "organization",
    update: { openmeterCustomerId },
    where: [{ field: "id", value: organizationId }],
  });
}

async function getOrganizationById(
  ctx: GenericEndpointContext,
  organizationId: string,
) {
  const organization =
    await ctx.context.adapter.findOne<OpenMeterOrganization>({
      model: "organization",
      where: [{ field: "id", value: organizationId }],
    });

  if (!organization) {
    throw createAPIError(
      "NOT_FOUND",
      OPENMETER_ERROR_CODES.ORGANIZATION_NOT_FOUND,
    );
  }

  return organization;
}

async function syncOpenMeterCustomerForUser(
  client: OpenMeterClient,
  options: OpenMeterOptions,
  user: User & WithOpenMeterCustomerId,
  ctx: GenericEndpointContext,
  extraMetadata?: Record<string, unknown> | undefined,
) {
  const key = await resolveCustomerKey(options, user, ctx);
  const subject = await resolveSubject(options, user, ctx);
  const profile = await resolveCustomerProfile(options, user, ctx, extraMetadata);
  const customerPayload = {
    ...profile,
    key,
    usageAttribution: { subjectKeys: [subject] },
  };

  let customer = await client.customers.get(key);

  if (customer) {
    customer = await client.customers.update(key, customerPayload as never);
  } else {
    customer = await client.customers.create(customerPayload as never);
  }

  if (!customer?.id) {
    throw createAPIError("BAD_REQUEST", OPENMETER_ERROR_CODES.CUSTOMER_NOT_FOUND);
  }

  if (user.openmeterCustomerId !== customer.id) {
    await updateUserOpenMeterCustomerId(ctx, user.id, customer.id);
  }

  await options.callbacks?.onCustomerSynced?.(
    {
      customer,
      user: {
        ...user,
        openmeterCustomerId: customer.id,
      },
    },
    ctx,
  );

  return customer;
}

async function syncOpenMeterCustomerForOrganization(
  client: OpenMeterClient,
  options: OpenMeterOptions,
  organization: OpenMeterOrganization,
  user: User & WithOpenMeterCustomerId,
  ctx: GenericEndpointContext,
  extraMetadata?: Record<string, unknown> | undefined,
) {
  const key = await resolveOrganizationCustomerKey(
    options,
    organization,
    user,
    ctx,
  );
  const subject = await resolveOrganizationSubject(
    options,
    organization,
    user,
    ctx,
  );
  const profile = await resolveOrganizationCustomerProfile(
    options,
    organization,
    user,
    ctx,
    extraMetadata,
  );
  const customerPayload = {
    ...profile,
    key,
    usageAttribution: { subjectKeys: [subject] },
  };

  let customer = await client.customers.get(key);

  if (customer) {
    customer = await client.customers.update(key, customerPayload as never);
  } else {
    customer = await client.customers.create(customerPayload as never);
  }

  if (!customer?.id) {
    throw createAPIError("BAD_REQUEST", OPENMETER_ERROR_CODES.CUSTOMER_NOT_FOUND);
  }

  if (organization.openmeterCustomerId !== customer.id) {
    await updateOrganizationOpenMeterCustomerId(ctx, organization.id, customer.id);
  }

  await options.callbacks?.onCustomerSynced?.(
    {
      customer,
      user,
      organization,
    },
    ctx,
  );

  return customer;
}

async function ingestAuthEvent(
  client: OpenMeterClient,
  options: OpenMeterOptions,
  eventType: string,
  user: User & WithOpenMeterCustomerId,
  ctx: GenericEndpointContext,
) {
  const event = await addDefaultSubject(
    [
      {
        type: eventType,
        data: {
          userId: user.id,
          email: user.email,
        },
      },
    ],
    options,
    user,
    ctx,
  );

  await client.events.ingest(event[0] as never);
  await options.callbacks?.onEventIngested?.({ events: event, user }, ctx);
}

function getSessionUser(ctx: GenericEndpointContext) {
  const session = ctx.context.session;
  const user = session?.user as (User & WithOpenMeterCustomerId) | undefined;

  if (!user) {
    throw new APIError("UNAUTHORIZED", {
      message: "Session is required.",
    });
  }

  return user;
}

function getOrganizationIdFromBody(ctx: GenericEndpointContext) {
  const organizationId = (ctx.body as { organizationId?: string }).organizationId;
  if (!organizationId) {
    throw createAPIError("BAD_REQUEST", OPENMETER_ERROR_CODES.ORGANIZATION_NOT_FOUND);
  }
  return organizationId;
}

function getOrganizationIdFromQuery(ctx: GenericEndpointContext) {
  const organizationId = (ctx.query as { organizationId?: string })
    .organizationId;
  if (!organizationId) {
    throw createAPIError("BAD_REQUEST", OPENMETER_ERROR_CODES.ORGANIZATION_NOT_FOUND);
  }
  return organizationId;
}

export const openmeter = <O extends OpenMeterOptions>(options: O) => {
  const client = getResolvedClient(options);
  assertOpenMeterClient(client);
  const eventUseSession =
    options.requireSession === false ? [] : [sessionMiddleware];
  const requireSession = [sessionMiddleware];
  const organizationRoleConfigFromBody = {
    orgIdParam: "organizationId",
    orgIdSource: "body" as const,
    ...(options.organization?.allowedRoles
      ? { allowedRoles: options.organization.allowedRoles }
      : {}),
  };
  const organizationRoleConfigFromQuery = {
    orgIdParam: "organizationId",
    orgIdSource: "query" as const,
    ...(options.organization?.allowedRoles
      ? { allowedRoles: options.organization.allowedRoles }
      : {}),
  };
  const requireOrganizationFromBody = [
    sessionMiddleware,
    requireOrgRole(organizationRoleConfigFromBody),
  ];
  const requireOrganizationFromQuery = [
    sessionMiddleware,
    requireOrgRole(organizationRoleConfigFromQuery),
  ];

  const resolvedOptions = {
    ...options,
    openmeterClient: client,
  } satisfies OpenMeterOptions;

  return {
    id: "openmeter",
    init(ctx) {
      if (resolvedOptions.organization?.enabled && !ctx.hasPlugin("organization")) {
        throw new Error(
          "openmeter organization support requires the Better Auth organization plugin.",
        );
      }
    },
    endpoints: {
      ingestOpenMeterEvent: createAuthEndpoint(
        "/openmeter/events/ingest",
        {
          method: "POST",
          body: ingestEventsBodySchema,
          use: eventUseSession,
        },
        async (ctx) => {
          const events = normalizeUsageEvents(
            ctx.body as OpenMeterUsageEvent | { events?: OpenMeterUsageEvent[] },
          );
          const user = ctx.context.session?.user as
            | (User & WithOpenMeterCustomerId)
            | undefined;
          const enrichedEvents = user
            ? await addDefaultSubject(events, resolvedOptions, user, ctx)
            : events.map((event) => {
                if (!event.subject) {
                  throw new APIError("UNAUTHORIZED", {
                    message:
                      "Session or explicit OpenMeter event subject is required.",
                  });
                }

                return {
                  source: resolvedOptions.eventSource ?? "better-auth",
                  ...event,
                };
              });

          await client.events.ingest(
            enrichedEvents.length === 1
              ? (enrichedEvents[0] as never)
              : (enrichedEvents as never),
          );
          await resolvedOptions.callbacks?.onEventIngested?.(
            { events: enrichedEvents, user },
            ctx,
          );

          return ctx.json({ ok: true });
        },
      ),
      syncOpenMeterCustomer: createAuthEndpoint(
        "/openmeter/customer/sync",
        {
          method: "POST",
          body: syncCustomerBodySchema,
          use: requireSession,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const customer = await syncOpenMeterCustomerForUser(
            client,
            resolvedOptions,
            user,
            ctx,
            ctx.body.metadata,
          );

          return ctx.json((customer ?? null) as never);
        },
      ),
      getOpenMeterCustomer: createAuthEndpoint(
        "/openmeter/customer",
        {
          method: "GET",
          use: requireSession,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const customerIdOrKey =
            user.openmeterCustomerId ??
            (await resolveCustomerKey(resolvedOptions, user, ctx));
          const customer = await client.customers.get(customerIdOrKey);

          return ctx.json((customer ?? null) as never);
        },
      ),
      getOpenMeterCustomerAccess: createAuthEndpoint(
        "/openmeter/customer/access",
        {
          method: "GET",
          use: requireSession,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const customerIdOrKey =
            user.openmeterCustomerId ??
            (await resolveCustomerKey(resolvedOptions, user, ctx));
          const access = await client.customers.getAccess(customerIdOrKey);

          return ctx.json((access ?? null) as never);
        },
      ),
      listOpenMeterEntitlements: createAuthEndpoint(
        "/openmeter/entitlements",
        {
          method: "GET",
          use: requireSession,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const customerIdOrKey =
            user.openmeterCustomerId ??
            (await resolveCustomerKey(resolvedOptions, user, ctx));
          const entitlements =
            await client.customers.entitlements.list(customerIdOrKey);

          return ctx.json((entitlements ?? null) as never);
        },
      ),
      getOpenMeterEntitlementValue: createAuthEndpoint(
        "/openmeter/entitlement/value",
        {
          method: "GET",
          query: entitlementQuerySchema,
          use: requireSession,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const customerIdOrKey =
            user.openmeterCustomerId ??
            (await resolveCustomerKey(resolvedOptions, user, ctx));
          const featureKey = ctx.query.featureKey;
          if (!featureKey) {
            throw createAPIError("BAD_REQUEST", OPENMETER_ERROR_CODES.INVALID_EVENT);
          }

          const value = await client.customers.entitlements.value(
            customerIdOrKey,
            featureKey,
          );

          return ctx.json((value ?? null) as never);
        },
      ),
      ingestOpenMeterOrganizationEvent: createAuthEndpoint(
        "/openmeter/organization/events/ingest",
        {
          method: "POST",
          body: organizationEventBodySchema,
          use: requireOrganizationFromBody,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const organization = await getOrganizationById(
            ctx,
            getOrganizationIdFromBody(ctx),
          );
          const events = normalizeUsageEvents(
            ctx.body as OpenMeterUsageEvent | { events?: OpenMeterUsageEvent[] },
          );
          const enrichedEvents = await addDefaultOrganizationSubject(
            events,
            resolvedOptions,
            organization,
            user,
            ctx,
          );

          await client.events.ingest(
            enrichedEvents.length === 1
              ? (enrichedEvents[0] as never)
              : (enrichedEvents as never),
          );
          await resolvedOptions.callbacks?.onEventIngested?.(
            { events: enrichedEvents, user, organization },
            ctx,
          );

          return ctx.json({ ok: true });
        },
      ),
      syncOpenMeterOrganizationCustomer: createAuthEndpoint(
        "/openmeter/organization/customer/sync",
        {
          method: "POST",
          body: syncOrganizationCustomerBodySchema,
          use: requireOrganizationFromBody,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const organization = await getOrganizationById(
            ctx,
            getOrganizationIdFromBody(ctx),
          );
          const customer = await syncOpenMeterCustomerForOrganization(
            client,
            resolvedOptions,
            organization,
            user,
            ctx,
            ctx.body.metadata,
          );

          return ctx.json((customer ?? null) as never);
        },
      ),
      getOpenMeterOrganizationCustomer: createAuthEndpoint(
        "/openmeter/organization/customer",
        {
          method: "GET",
          query: organizationQuerySchema,
          use: requireOrganizationFromQuery,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const organization = await getOrganizationById(
            ctx,
            getOrganizationIdFromQuery(ctx),
          );
          const customerIdOrKey =
            organization.openmeterCustomerId ??
            (await resolveOrganizationCustomerKey(
              resolvedOptions,
              organization,
              user,
              ctx,
            ));
          const customer = await client.customers.get(customerIdOrKey);

          return ctx.json((customer ?? null) as never);
        },
      ),
      getOpenMeterOrganizationCustomerAccess: createAuthEndpoint(
        "/openmeter/organization/customer/access",
        {
          method: "GET",
          query: organizationQuerySchema,
          use: requireOrganizationFromQuery,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const organization = await getOrganizationById(
            ctx,
            getOrganizationIdFromQuery(ctx),
          );
          const customerIdOrKey =
            organization.openmeterCustomerId ??
            (await resolveOrganizationCustomerKey(
              resolvedOptions,
              organization,
              user,
              ctx,
            ));
          const access = await client.customers.getAccess(customerIdOrKey);

          return ctx.json((access ?? null) as never);
        },
      ),
      listOpenMeterOrganizationEntitlements: createAuthEndpoint(
        "/openmeter/organization/entitlements",
        {
          method: "GET",
          query: organizationQuerySchema,
          use: requireOrganizationFromQuery,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const organization = await getOrganizationById(
            ctx,
            getOrganizationIdFromQuery(ctx),
          );
          const customerIdOrKey =
            organization.openmeterCustomerId ??
            (await resolveOrganizationCustomerKey(
              resolvedOptions,
              organization,
              user,
              ctx,
            ));
          const entitlements =
            await client.customers.entitlements.list(customerIdOrKey);

          return ctx.json((entitlements ?? null) as never);
        },
      ),
      getOpenMeterOrganizationEntitlementValue: createAuthEndpoint(
        "/openmeter/organization/entitlement/value",
        {
          method: "GET",
          query: organizationEntitlementQuerySchema,
          use: requireOrganizationFromQuery,
        },
        async (ctx) => {
          const user = getSessionUser(ctx);
          const organization = await getOrganizationById(
            ctx,
            getOrganizationIdFromQuery(ctx),
          );
          const customerIdOrKey =
            organization.openmeterCustomerId ??
            (await resolveOrganizationCustomerKey(
              resolvedOptions,
              organization,
              user,
              ctx,
            ));
          const featureKey = ctx.query.featureKey;
          if (!featureKey) {
            throw createAPIError("BAD_REQUEST", OPENMETER_ERROR_CODES.INVALID_EVENT);
          }

          const value = await client.customers.entitlements.value(
            customerIdOrKey,
            featureKey,
          );

          return ctx.json((value ?? null) as never);
        },
      ),
    },
    hooks: {
      after: [
        {
          matcher: (context) =>
            Boolean(
              options.trackAuthEvents && authPathToEventType(context.path ?? ""),
            ),
          handler: createAuthMiddleware(async (ctx) => {
            const eventType = authPathToEventType(ctx.path);
            const user = ctx.context.newSession?.user as
              | (User & WithOpenMeterCustomerId)
              | undefined;

            if (!eventType || !user) return;

            try {
              await ingestAuthEvent(client, resolvedOptions, eventType, user, ctx);
            } catch (error) {
              await reportOpenMeterError(
                resolvedOptions,
                "auth-event",
                error,
                ctx,
                user,
              );
            }
          }),
        },
      ],
    },
    schema: getSchema(resolvedOptions),
    options: {
      ...resolvedOptions,
      databaseHooks: {
        user: {
          create: {
            async after(user: User & WithOpenMeterCustomerId, ctx: any) {
              if (!ctx) return;

              try {
                if (resolvedOptions.createCustomerOnSignUp) {
                  await syncOpenMeterCustomerForUser(
                    client,
                    resolvedOptions,
                    user,
                    ctx,
                  );
                }

                if (resolvedOptions.trackAuthEvents) {
                  await ingestAuthEvent(
                    client,
                    resolvedOptions,
                    "better-auth.user.created",
                    user,
                    ctx,
                  );
                }
              } catch (error) {
                await reportOpenMeterError(
                  resolvedOptions,
                  "user-create-hook",
                  error,
                  ctx,
                  user,
                );
              }
            },
          },
          update: {
            async after(user: User & WithOpenMeterCustomerId, ctx: any) {
              if (!ctx) return;

              try {
                if (
                  resolvedOptions.syncCustomerOnUserUpdate &&
                  user.openmeterCustomerId
                ) {
                  await syncOpenMeterCustomerForUser(
                    client,
                    resolvedOptions,
                    user,
                    ctx,
                  );
                }

                if (resolvedOptions.trackAuthEvents) {
                  await ingestAuthEvent(
                    client,
                    resolvedOptions,
                    "better-auth.user.updated",
                    user,
                    ctx,
                  );
                }
              } catch (error) {
                await reportOpenMeterError(
                  resolvedOptions,
                  "user-update-hook",
                  error,
                  ctx,
                  user,
                );
              }
            },
          },
        },
        organization: resolvedOptions.organization?.enabled
          ? {
              create: {
                async after(organization: OpenMeterOrganization, ctx: any) {
                  if (!ctx || !resolvedOptions.organization?.enabled) return;
                  if (
                    !resolvedOptions.organization
                      .createCustomerOnOrganizationCreate
                  ) {
                    return;
                  }

                  const user = ctx.context.session?.user as
                    | (User & WithOpenMeterCustomerId)
                    | undefined;
                  if (!user) return;

                  try {
                    await syncOpenMeterCustomerForOrganization(
                      client,
                      resolvedOptions,
                      organization,
                      user,
                      ctx,
                    );
                  } catch (error) {
                    await reportOpenMeterError(
                      resolvedOptions,
                      "organization-create-hook",
                      error,
                      ctx,
                      user,
                      organization,
                    );
                  }
                },
              },
              update: {
                async after(organization: OpenMeterOrganization, ctx: any) {
                  if (!ctx || !resolvedOptions.organization?.enabled) return;
                  if (
                    !resolvedOptions.organization
                      .syncCustomerOnOrganizationUpdate ||
                    !organization.openmeterCustomerId
                  ) {
                    return;
                  }

                  const user = ctx.context.session?.user as
                    | (User & WithOpenMeterCustomerId)
                    | undefined;
                  if (!user) return;

                  try {
                    await syncOpenMeterCustomerForOrganization(
                      client,
                      resolvedOptions,
                      organization,
                      user,
                      ctx,
                    );
                  } catch (error) {
                    await reportOpenMeterError(
                      resolvedOptions,
                      "organization-update-hook",
                      error,
                      ctx,
                      user,
                      organization,
                    );
                  }
                },
              },
            }
          : undefined,
      },
    },
  } satisfies BetterAuthPlugin;
};

export type OpenMeterPlugin<O extends OpenMeterOptions> = ReturnType<
  typeof openmeter<O>
>;

export const openmeterPlugin = openmeter;

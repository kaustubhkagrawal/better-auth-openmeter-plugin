import type { GenericEndpointContext, User } from "better-auth";
import { APIError } from "better-auth/api";
import type {
  JsonObject,
  OpenMeterAuthEventType,
  OpenMeterClient,
  OpenMeterOrganization,
  OpenMeterOptions,
  OpenMeterUsageEvent,
  WithOpenMeterCustomerId,
} from "./types";

export const OPENMETER_ERROR_CODES = {
  CUSTOMER_NOT_FOUND: "OPENMETER_CUSTOMER_NOT_FOUND",
  INVALID_EVENT: "OPENMETER_INVALID_EVENT",
  MISSING_CLIENT_CONFIG: "OPENMETER_MISSING_CLIENT_CONFIG",
  ORGANIZATION_NOT_FOUND: "OPENMETER_ORGANIZATION_NOT_FOUND",
} as const;

export function createAPIError(
  status: ConstructorParameters<typeof APIError>[0],
  message: string,
) {
  return new APIError(status, {
    message,
    code: message,
  });
}

export function assertOpenMeterClient(
  client: OpenMeterClient | undefined,
): asserts client is OpenMeterClient {
  if (!client) {
    throw createAPIError(
      "INTERNAL_SERVER_ERROR",
      OPENMETER_ERROR_CODES.MISSING_CLIENT_CONFIG,
    );
  }
}

export async function resolveCustomerKey(
  options: OpenMeterOptions,
  user: User & WithOpenMeterCustomerId,
  ctx?: GenericEndpointContext,
) {
  return options.customer?.resolveKey
    ? await options.customer.resolveKey({ user, ctx })
    : user.id;
}

export async function resolveSubject(
  options: OpenMeterOptions,
  user: User & WithOpenMeterCustomerId,
  ctx?: GenericEndpointContext,
) {
  return options.customer?.resolveSubject
    ? await options.customer.resolveSubject({ user, ctx })
    : await resolveCustomerKey(options, user, ctx);
}

export async function resolveCustomerName(
  options: OpenMeterOptions,
  user: User & WithOpenMeterCustomerId,
  ctx?: GenericEndpointContext,
) {
  if (options.customer?.resolveName) {
    return await options.customer.resolveName({ user, ctx });
  }

  return user.name || user.email || user.id;
}

export async function resolveCustomerMetadata(
  options: OpenMeterOptions,
  user: User & WithOpenMeterCustomerId,
  ctx?: GenericEndpointContext,
) {
  const base = {
    betterAuthUserId: user.id,
    betterAuthEmail: user.email,
  } satisfies JsonObject;
  const metadata = options.customer?.metadata;

  if (!metadata) return base;
  const resolved =
    typeof metadata === "function" ? await metadata({ user, ctx }) : metadata;

  return {
    ...base,
    ...resolved,
  };
}

export async function resolveOrganizationCustomerKey(
  options: OpenMeterOptions,
  organization: OpenMeterOrganization,
  user: User & WithOpenMeterCustomerId,
  ctx?: GenericEndpointContext,
) {
  return options.organization?.resolveKey
    ? await options.organization.resolveKey({ organization, user, ctx })
    : organization.id;
}

export async function resolveOrganizationSubject(
  options: OpenMeterOptions,
  organization: OpenMeterOrganization,
  user: User & WithOpenMeterCustomerId,
  ctx?: GenericEndpointContext,
) {
  return options.organization?.resolveSubject
    ? await options.organization.resolveSubject({ organization, user, ctx })
    : await resolveOrganizationCustomerKey(options, organization, user, ctx);
}

export async function resolveOrganizationCustomerName(
  options: OpenMeterOptions,
  organization: OpenMeterOrganization,
  user: User & WithOpenMeterCustomerId,
  ctx?: GenericEndpointContext,
) {
  if (options.organization?.resolveName) {
    return await options.organization.resolveName({ organization, user, ctx });
  }

  return organization.name || organization.slug || organization.id;
}

export async function resolveOrganizationCustomerMetadata(
  options: OpenMeterOptions,
  organization: OpenMeterOrganization,
  user: User & WithOpenMeterCustomerId,
  ctx?: GenericEndpointContext,
) {
  const base = {
    betterAuthOrganizationId: organization.id,
    betterAuthOrganizationSlug: organization.slug,
  } satisfies JsonObject;
  const metadata = options.organization?.metadata;

  if (!metadata) return base;
  const resolved =
    typeof metadata === "function"
      ? await metadata({ organization, user, ctx })
      : metadata;

  return {
    ...base,
    ...resolved,
  };
}

export function normalizeUsageEvents(
  input:
    | OpenMeterUsageEvent
    | OpenMeterUsageEvent[]
    | { events?: OpenMeterUsageEvent | OpenMeterUsageEvent[] | undefined },
) {
  const events = Array.isArray(input)
    ? input
    : "events" in input && input.events
      ? input.events
      : input;

  return (Array.isArray(events) ? events : [events]).map((event) => {
    if (!event.type) {
      throw createAPIError("BAD_REQUEST", OPENMETER_ERROR_CODES.INVALID_EVENT);
    }

    return {
      specversion: "1.0" as const,
      ...event,
    };
  });
}

export async function addDefaultSubject(
  events: OpenMeterUsageEvent[],
  options: OpenMeterOptions,
  user: User & WithOpenMeterCustomerId,
  ctx: GenericEndpointContext,
) {
  const subject = await resolveSubject(options, user, ctx);

  return Promise.all(
    events.map(async (event) => {
      const withDefaults = {
        source: options.eventSource ?? "better-auth",
        subject,
        ...event,
      };

      return options.events?.enrich
        ? await options.events.enrich(withDefaults, { user, ctx })
        : withDefaults;
    }),
  );
}

export async function addDefaultOrganizationSubject(
  events: OpenMeterUsageEvent[],
  options: OpenMeterOptions,
  organization: OpenMeterOrganization,
  user: User & WithOpenMeterCustomerId,
  ctx: GenericEndpointContext,
) {
  const subject = await resolveOrganizationSubject(
    options,
    organization,
    user,
    ctx,
  );

  return Promise.all(
    events.map(async (event) => {
      const withDefaults = {
        source: options.eventSource ?? "better-auth",
        subject,
        ...event,
      };

      return options.events?.enrich
        ? await options.events.enrich(withDefaults, { user, ctx })
        : withDefaults;
    }),
  );
}

export function authPathToEventType(path: string): OpenMeterAuthEventType | null {
  if (path.startsWith("/sign-up")) return "better-auth.user.signed-up";
  if (path.startsWith("/sign-in")) return "better-auth.user.signed-in";
  return null;
}

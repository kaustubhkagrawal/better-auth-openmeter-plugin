import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
  applyOpenMeterBillingEvent,
  type OpenMeterBillingAdapterOptions,
  type OpenMeterBillingEvent,
  type OpenMeterBillingProvider,
} from "./billing";

export type AutumnIdentityContext = {
  session?: {
    user?: {
      id?: string | undefined;
      name?: string | undefined;
      email?: string | undefined;
      [key: string]: unknown;
    } | undefined;
    session?: {
      id?: string | undefined;
      activeOrganizationId?: string | null | undefined;
      [key: string]: unknown;
    } | undefined;
  } | null | undefined;
  organization?: {
    id?: string | undefined;
    name?: string | undefined;
    slug?: string | undefined;
    [key: string]: unknown;
  } | null | undefined;
};

export type AutumnIdentityResult = {
  customerId: string | null | undefined;
  customerData?: {
    name?: string | null | undefined;
    email?: string | null | undefined;
    metadata?: Record<string, unknown> | null | undefined;
    [key: string]: unknown;
  } | undefined;
};

export type AutumnBillingState = {
  type?: OpenMeterBillingEvent["type"] | undefined;
  customerId?: string | undefined;
  referenceId?: string | undefined;
  customerType?: "user" | "organization" | (string & {}) | undefined;
  subject?: string | undefined;
  plan?: string | undefined;
  productId?: string | undefined;
  subscriptionId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  identity?: AutumnIdentityContext | undefined;
  raw?: unknown;
  [key: string]: unknown;
};

export type AutumnBillingProviderOptions = {
  billing?: OpenMeterBillingAdapterOptions | undefined;
  ctx?:
    | GenericEndpointContext
    | ((state: AutumnBillingState) => GenericEndpointContext)
    | undefined;
  customerScope?: "user" | "organization" | "user_and_organization" | undefined;
  apply?: boolean | undefined;
  identify?:
    | ((
        context: AutumnIdentityContext,
      ) => AutumnIdentityResult | null | Promise<AutumnIdentityResult | null>)
    | undefined;
  resolveCustomerIdOrKey?:
    | ((
        state: AutumnBillingState | AutumnIdentityContext,
      ) => string | undefined | Promise<string | undefined>)
    | undefined;
  resolveSubject?:
    | ((state: AutumnBillingState) => string | Promise<string>)
    | undefined;
  resolveCustomerType?:
    | ((
        state: AutumnBillingState,
      ) => "user" | "organization" | (string & {}) | undefined)
    | undefined;
  resolvePlan?:
    | ((state: AutumnBillingState) => string | undefined | Promise<string | undefined>)
    | undefined;
  metadata?:
    | Record<string, unknown>
    | ((state: AutumnBillingState) => Record<string, unknown>)
    | undefined;
  onBillingEvent?:
    | ((
        event: OpenMeterBillingEvent,
        state: AutumnBillingState,
      ) => Promise<void> | void)
    | undefined;
};

export type AutumnBillingProvider = OpenMeterBillingProvider & {
  identify: (
    context: AutumnIdentityContext,
  ) => Promise<AutumnIdentityResult | null>;
  toBillingEvent: (
    state: AutumnBillingState,
  ) => Promise<OpenMeterBillingEvent>;
  handleBillingState: (
    state: AutumnBillingState,
  ) => Promise<OpenMeterBillingEvent>;
};

function createFallbackContext(): GenericEndpointContext {
  return {
    context: {
      getPlugin: () => null,
      logger: {
        error: () => undefined,
      },
    },
  } as unknown as GenericEndpointContext;
}

function resolveContext(
  options: AutumnBillingProviderOptions,
  state: AutumnBillingState,
) {
  if (typeof options.ctx === "function") return options.ctx(state);
  return options.ctx ?? createFallbackContext();
}

function getDefaultCustomerId(
  context: AutumnIdentityContext,
  customerScope: AutumnBillingProviderOptions["customerScope"],
) {
  if (customerScope === "organization") return context.organization?.id;
  if (customerScope === "user_and_organization") {
    return context.organization?.id ?? context.session?.user?.id;
  }
  return context.session?.user?.id;
}

function getDefaultCustomerType(
  state: AutumnBillingState,
  customerScope: AutumnBillingProviderOptions["customerScope"],
) {
  if (state.customerType) return state.customerType;
  if (customerScope === "organization") return "organization";
  if (customerScope === "user_and_organization" && state.identity?.organization?.id) {
    return "organization";
  }
  return "user";
}

function getDefaultCustomerData(
  context: AutumnIdentityContext,
  customerScope: AutumnBillingProviderOptions["customerScope"],
) {
  if (
    customerScope === "organization" ||
    (customerScope === "user_and_organization" && context.organization?.id)
  ) {
    return {
      name: context.organization?.name ?? context.organization?.slug ?? null,
      metadata: {
        organizationId: context.organization?.id,
        organizationSlug: context.organization?.slug,
      },
    };
  }

  return {
    name: context.session?.user?.name ?? null,
    email: context.session?.user?.email ?? null,
    metadata: {
      userId: context.session?.user?.id,
    },
  };
}

export const autumnBillingProvider = (
  options: AutumnBillingProviderOptions = {},
) => {
  const customerScope = options.customerScope ?? "user";

  async function identify(context: AutumnIdentityContext) {
    const customIdentity = await options.identify?.(context);
    if (customIdentity) return customIdentity;

    const customerId = options.resolveCustomerIdOrKey
      ? await options.resolveCustomerIdOrKey(context)
      : getDefaultCustomerId(context, customerScope);

    if (!customerId) return null;

    return {
      customerId,
      customerData: getDefaultCustomerData(context, customerScope),
    } satisfies AutumnIdentityResult;
  }

  async function toBillingEvent(
    state: AutumnBillingState,
  ): Promise<OpenMeterBillingEvent> {
    const identity = state.identity ? await identify(state.identity) : null;
    const metadata =
      typeof options.metadata === "function"
        ? options.metadata(state)
        : options.metadata;
    const customerIdOrKey = options.resolveCustomerIdOrKey
      ? await options.resolveCustomerIdOrKey(state)
      : state.customerId ?? state.referenceId ?? identity?.customerId ?? undefined;

    if (!customerIdOrKey) {
      throw new Error(
        "Autumn billing event could not resolve customerIdOrKey. Provide resolveCustomerIdOrKey or state.customerId.",
      );
    }

    const subject = options.resolveSubject
      ? await options.resolveSubject(state)
      : state.subject ?? customerIdOrKey;
    const plan = options.resolvePlan
      ? await options.resolvePlan(state)
      : state.plan ?? state.productId;

    return {
      type: state.type ?? "customer.synced",
      provider: "autumn",
      customerIdOrKey,
      subject,
      referenceId: state.referenceId ?? identity?.customerId ?? customerIdOrKey,
      customerType: options.resolveCustomerType?.(state) ??
        getDefaultCustomerType(state, customerScope),
      plan,
      subscriptionId: state.subscriptionId,
      metadata: {
        ...metadata,
        ...state.metadata,
        autumnCustomerId: identity?.customerId ?? state.customerId,
        productId: state.productId,
      },
      raw: state.raw ?? state,
    };
  }

  async function handleBillingState(state: AutumnBillingState) {
    const event = await toBillingEvent(state);

    if (options.apply !== false) {
      await applyOpenMeterBillingEvent(
        event,
        resolveContext(options, state),
        options.billing,
      );
    }

    await options.onBillingEvent?.(event, state);
    return event;
  }

  return {
    id: "autumn",
    plugin: {
      id: "openmeter-autumn-billing-provider",
      init(ctx) {
        if (!ctx.hasPlugin("openmeter") && !options.billing?.openmeterClient) {
          throw new Error(
            "autumnBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
          );
        }
      },
    } satisfies BetterAuthPlugin,
    identify,
    toBillingEvent,
    handleBillingState,
  } satisfies AutumnBillingProvider;
};

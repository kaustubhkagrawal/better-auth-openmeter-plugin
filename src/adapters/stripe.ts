import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
  applyOpenMeterBillingEvent,
  type OpenMeterBillingAdapterOptions,
  type OpenMeterBillingEvent,
  type OpenMeterBillingProvider,
} from "./billing";

export type StripeBillingSubscription = {
  id: string;
  plan: string;
  referenceId: string;
  status?: string | undefined;
  stripeCustomerId?: string | undefined;
  stripeSubscriptionId?: string | undefined;
  priceId?: string | undefined;
  groupId?: string | undefined;
  seats?: number | undefined;
  billingInterval?: "day" | "week" | "month" | "year" | undefined;
  [key: string]: unknown;
};

export type StripeBillingPlan = {
  name: string;
  priceId: string;
  annualDiscountPriceId?: string | undefined;
  group?: string | undefined;
  limits?: Record<string, unknown> | undefined;
  [key: string]: unknown;
};

export type StripeSubscriptionEntity = {
  id: string;
  status?: string | undefined;
  customer?: string | { id: string } | null | undefined;
  items?: {
    data?: Array<{
      price?: {
        id?: string | undefined;
      };
      quantity?: number | null | undefined;
    }>;
  };
  [key: string]: unknown;
};

export type StripeBillingCallbackData = {
  event?: unknown;
  stripeSubscription?: StripeSubscriptionEntity | undefined;
  subscription: StripeBillingSubscription;
  plan?: StripeBillingPlan | undefined;
  cancellationDetails?: unknown;
};

export type StripeBillingCallbackName =
  | "onSubscriptionComplete"
  | "onSubscriptionCreated"
  | "onSubscriptionUpdate"
  | "onSubscriptionCancel"
  | "onSubscriptionDeleted";

export type StripeBillingProviderOptions = {
  billing?: OpenMeterBillingAdapterOptions | undefined;
  ctx?:
    | GenericEndpointContext
    | ((data: StripeBillingCallbackData) => GenericEndpointContext)
    | undefined;
  apply?: boolean | undefined;
  resolveCustomerIdOrKey?:
    | ((data: StripeBillingCallbackData) => string | Promise<string>)
    | undefined;
  resolveSubject?:
    | ((data: StripeBillingCallbackData) => string | Promise<string>)
    | undefined;
  resolveCustomerType?:
    | ((
        data: StripeBillingCallbackData,
      ) => "user" | "organization" | (string & {}) | undefined)
    | undefined;
  metadata?:
    | Record<string, unknown>
    | ((data: StripeBillingCallbackData) => Record<string, unknown>)
    | undefined;
  onBillingEvent?:
    | ((
        event: OpenMeterBillingEvent,
        data: StripeBillingCallbackData,
      ) => Promise<void> | void)
    | undefined;
};

export type StripeBillingProvider = OpenMeterBillingProvider & {
  callbacks: Record<
    StripeBillingCallbackName,
    (data: StripeBillingCallbackData, ctx?: GenericEndpointContext) => Promise<void>
  >;
  toBillingEvent: (
    callbackName: StripeBillingCallbackName,
    data: StripeBillingCallbackData,
  ) => Promise<OpenMeterBillingEvent>;
  handleSubscriptionEvent: (
    callbackName: StripeBillingCallbackName,
    data: StripeBillingCallbackData,
    ctx?: GenericEndpointContext,
  ) => Promise<OpenMeterBillingEvent>;
};

const callbackEventTypes: Record<
  StripeBillingCallbackName,
  OpenMeterBillingEvent["type"]
> = {
  onSubscriptionComplete: "subscription.active",
  onSubscriptionCreated: "subscription.created",
  onSubscriptionUpdate: "subscription.updated",
  onSubscriptionCancel: "subscription.canceled",
  onSubscriptionDeleted: "subscription.deleted",
};

function getStripeCustomerId(subscription?: StripeSubscriptionEntity) {
  const customer = subscription?.customer;
  if (!customer) return undefined;
  return typeof customer === "string" ? customer : customer.id;
}

function getStripePriceId(subscription?: StripeSubscriptionEntity) {
  return subscription?.items?.data?.[0]?.price?.id;
}

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
  options: StripeBillingProviderOptions,
  data: StripeBillingCallbackData,
  ctx?: GenericEndpointContext,
) {
  if (ctx) return ctx;
  if (typeof options.ctx === "function") return options.ctx(data);
  return options.ctx ?? createFallbackContext();
}

export const stripeBillingProvider = (
  options: StripeBillingProviderOptions = {},
) => {
  async function toBillingEvent(
    callbackName: StripeBillingCallbackName,
    data: StripeBillingCallbackData,
  ): Promise<OpenMeterBillingEvent> {
    const subscription = data.subscription;
    const metadata =
      typeof options.metadata === "function"
        ? options.metadata(data)
        : options.metadata;
    const customerIdOrKey = options.resolveCustomerIdOrKey
      ? await options.resolveCustomerIdOrKey(data)
      : subscription.referenceId;
    const subject = options.resolveSubject
      ? await options.resolveSubject(data)
      : customerIdOrKey;

    return {
      type: callbackEventTypes[callbackName],
      provider: "stripe",
      customerIdOrKey,
      subject,
      referenceId: subscription.referenceId,
      customerType: options.resolveCustomerType?.(data),
      plan: data.plan?.name ?? subscription.plan,
      subscriptionId:
        subscription.stripeSubscriptionId ?? data.stripeSubscription?.id,
      metadata: {
        ...metadata,
        callbackName,
        stripeCustomerId:
          subscription.stripeCustomerId ??
          getStripeCustomerId(data.stripeSubscription),
        stripePriceId:
          subscription.priceId ??
          data.plan?.priceId ??
          getStripePriceId(data.stripeSubscription),
        status: subscription.status ?? data.stripeSubscription?.status,
        groupId: subscription.groupId,
        seats:
          subscription.seats ?? data.stripeSubscription?.items?.data?.[0]?.quantity,
        billingInterval: subscription.billingInterval,
        cancellationDetails: data.cancellationDetails,
      },
      raw: data,
    };
  }

  async function handleSubscriptionEvent(
    callbackName: StripeBillingCallbackName,
    data: StripeBillingCallbackData,
    ctx?: GenericEndpointContext,
  ) {
    const event = await toBillingEvent(callbackName, data);

    if (options.apply !== false) {
      await applyOpenMeterBillingEvent(
        event,
        resolveContext(options, data, ctx),
        options.billing,
      );
    }

    await options.onBillingEvent?.(event, data);
    return event;
  }

  const callbacks = Object.fromEntries(
    (Object.keys(callbackEventTypes) as StripeBillingCallbackName[]).map(
      (callbackName) => [
        callbackName,
        (data: StripeBillingCallbackData, ctx?: GenericEndpointContext) =>
          handleSubscriptionEvent(callbackName, data, ctx).then(() => undefined),
      ],
    ),
  ) as StripeBillingProvider["callbacks"];

  return {
    id: "stripe",
    plugin: {
      id: "openmeter-stripe-billing-provider",
      init(ctx) {
        if (!ctx.hasPlugin("openmeter") && !options.billing?.openmeterClient) {
          throw new Error(
            "stripeBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
          );
        }
      },
    } satisfies BetterAuthPlugin,
    callbacks,
    toBillingEvent,
    handleSubscriptionEvent,
  } satisfies StripeBillingProvider;
};


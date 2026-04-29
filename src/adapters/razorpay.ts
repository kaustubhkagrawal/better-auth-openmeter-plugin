import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
  applyOpenMeterBillingEvent,
  type OpenMeterBillingAdapterOptions,
  type OpenMeterBillingEvent,
  type OpenMeterBillingProvider,
} from "./billing";

export type RazorpayBillingSubscription = {
  id: string;
  plan: string;
  referenceId: string;
  status?: string | undefined;
  razorpayCustomerId?: string | undefined;
  razorpaySubscriptionId?: string | undefined;
  razorpayPlanId?: string | undefined;
  groupId?: string | undefined;
  quantity?: number | undefined;
  metadata?: string | undefined;
  [key: string]: unknown;
};

export type RazorpayBillingPlan = {
  name: string;
  planId: string;
  annualPlanId?: string | undefined;
  group?: string | undefined;
  limits?: Record<string, unknown> | undefined;
  [key: string]: unknown;
};

export type RazorpaySubscriptionEntity = {
  id: string;
  status?: string | undefined;
  customer_id?: string | undefined;
  plan_id?: string | undefined;
  [key: string]: unknown;
};

export type RazorpayBillingCallbackData = {
  event?: unknown;
  razorpaySubscription?: RazorpaySubscriptionEntity | undefined;
  subscription: RazorpayBillingSubscription;
  plan?: RazorpayBillingPlan | undefined;
};

export type RazorpayBillingCallbackName =
  | "onSubscriptionAuthenticated"
  | "onSubscriptionActivated"
  | "onSubscriptionCharged"
  | "onSubscriptionRenewed"
  | "onSubscriptionPending"
  | "onSubscriptionHalted"
  | "onSubscriptionUpdated"
  | "onSubscriptionPaused"
  | "onSubscriptionResumed"
  | "onSubscriptionCancelled"
  | "onSubscriptionCompleted";

export type RazorpayBillingProviderOptions = {
  billing?: OpenMeterBillingAdapterOptions | undefined;
  /**
   * Optional endpoint context. Provide this if your callback has access to one.
   * If omitted, `billing.openmeterClient` must be configured.
   */
  ctx?:
    | GenericEndpointContext
    | ((data: RazorpayBillingCallbackData) => GenericEndpointContext)
    | undefined;
  /**
   * Defaults to true. Set to false if you only need event normalization and
   * want to call `applyOpenMeterBillingEvent` yourself.
   */
  apply?: boolean | undefined;
  resolveCustomerIdOrKey?:
    | ((data: RazorpayBillingCallbackData) => string | Promise<string>)
    | undefined;
  resolveSubject?:
    | ((data: RazorpayBillingCallbackData) => string | Promise<string>)
    | undefined;
  resolveCustomerType?:
    | ((
        data: RazorpayBillingCallbackData,
      ) => "user" | "organization" | (string & {}) | undefined)
    | undefined;
  metadata?:
    | Record<string, unknown>
    | ((data: RazorpayBillingCallbackData) => Record<string, unknown>)
    | undefined;
  onBillingEvent?:
    | ((
        event: OpenMeterBillingEvent,
        data: RazorpayBillingCallbackData,
      ) => Promise<void> | void)
    | undefined;
};

export type RazorpayBillingProvider = OpenMeterBillingProvider & {
  callbacks: Record<
    RazorpayBillingCallbackName,
    (data: RazorpayBillingCallbackData) => Promise<void>
  >;
  toBillingEvent: (
    callbackName: RazorpayBillingCallbackName,
    data: RazorpayBillingCallbackData,
  ) => Promise<OpenMeterBillingEvent>;
  handleSubscriptionEvent: (
    callbackName: RazorpayBillingCallbackName,
    data: RazorpayBillingCallbackData,
  ) => Promise<OpenMeterBillingEvent>;
};

const callbackEventTypes: Record<
  RazorpayBillingCallbackName,
  OpenMeterBillingEvent["type"]
> = {
  onSubscriptionAuthenticated: "subscription.created",
  onSubscriptionActivated: "subscription.active",
  onSubscriptionCharged: "invoice.paid",
  onSubscriptionRenewed: "invoice.paid",
  onSubscriptionPending: "subscription.updated",
  onSubscriptionHalted: "subscription.updated",
  onSubscriptionUpdated: "subscription.updated",
  onSubscriptionPaused: "subscription.updated",
  onSubscriptionResumed: "subscription.updated",
  onSubscriptionCancelled: "subscription.canceled",
  onSubscriptionCompleted: "subscription.completed",
};

function parseMetadata(metadata: string | undefined) {
  if (!metadata) return undefined;
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return { rawMetadata: metadata };
  }
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
  options: RazorpayBillingProviderOptions,
  data: RazorpayBillingCallbackData,
) {
  if (typeof options.ctx === "function") return options.ctx(data);
  return options.ctx ?? createFallbackContext();
}

export const razorpayBillingProvider = (
  options: RazorpayBillingProviderOptions = {},
) => {
  async function toBillingEvent(
    callbackName: RazorpayBillingCallbackName,
    data: RazorpayBillingCallbackData,
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
      provider: "razorpay",
      customerIdOrKey,
      subject,
      referenceId: subscription.referenceId,
      customerType: options.resolveCustomerType?.(data),
      plan: data.plan?.name ?? subscription.plan,
      subscriptionId:
        subscription.razorpaySubscriptionId ?? data.razorpaySubscription?.id,
      metadata: {
        ...parseMetadata(subscription.metadata),
        ...metadata,
        callbackName,
        razorpayCustomerId:
          subscription.razorpayCustomerId ??
          data.razorpaySubscription?.customer_id,
        razorpayPlanId:
          subscription.razorpayPlanId ?? data.razorpaySubscription?.plan_id,
        status: subscription.status ?? data.razorpaySubscription?.status,
        groupId: subscription.groupId,
        quantity: subscription.quantity,
      },
      raw: data,
    };
  }

  async function handleSubscriptionEvent(
    callbackName: RazorpayBillingCallbackName,
    data: RazorpayBillingCallbackData,
  ) {
    const event = await toBillingEvent(callbackName, data);

    if (options.apply !== false) {
      await applyOpenMeterBillingEvent(
        event,
        resolveContext(options, data),
        options.billing,
      );
    }

    await options.onBillingEvent?.(event, data);
    return event;
  }

  const callbacks = Object.fromEntries(
    (Object.keys(callbackEventTypes) as RazorpayBillingCallbackName[]).map(
      (callbackName) => [
        callbackName,
        (data: RazorpayBillingCallbackData) =>
          handleSubscriptionEvent(callbackName, data).then(() => undefined),
      ],
    ),
  ) as RazorpayBillingProvider["callbacks"];

  return {
    id: "razorpay",
    plugin: {
      id: "openmeter-razorpay-billing-provider",
      init(ctx) {
        if (!ctx.hasPlugin("openmeter") && !options.billing?.openmeterClient) {
          throw new Error(
            "razorpayBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
          );
        }
      },
    } satisfies BetterAuthPlugin,
    callbacks,
    toBillingEvent,
    handleSubscriptionEvent,
  } satisfies RazorpayBillingProvider;
};


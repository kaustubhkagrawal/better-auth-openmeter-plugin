import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
  applyOpenMeterBillingEvent,
  type OpenMeterBillingAdapterOptions,
  type OpenMeterBillingEvent,
  type OpenMeterBillingProvider,
} from "./billing";

export type DodoWebhookPayload = {
  event_type?: string | undefined;
  data?: Record<string, unknown> | undefined;
  payload?: Record<string, unknown> | undefined;
  metadata?: Record<string, unknown> | undefined;
  [key: string]: unknown;
};

export type DodoBillingCallbackName =
  | "onPaymentSucceeded"
  | "onPaymentFailed"
  | "onPaymentProcessing"
  | "onPaymentCancelled"
  | "onRefundSucceeded"
  | "onRefundFailed"
  | "onDisputeOpened"
  | "onDisputeExpired"
  | "onDisputeAccepted"
  | "onDisputeCancelled"
  | "onDisputeChallenged"
  | "onDisputeWon"
  | "onDisputeLost"
  | "onSubscriptionActive"
  | "onSubscriptionOnHold"
  | "onSubscriptionRenewed"
  | "onSubscriptionPlanChanged"
  | "onSubscriptionCancelled"
  | "onSubscriptionFailed"
  | "onSubscriptionExpired"
  | "onSubscriptionUpdated"
  | "onLicenseKeyCreated"
  | "onAbandonedCheckoutDetected"
  | "onAbandonedCheckoutRecovered"
  | "onDunningStarted"
  | "onDunningRecovered"
  | "onCreditAdded"
  | "onCreditDeducted"
  | "onCreditExpired"
  | "onCreditRolledOver"
  | "onCreditRolloverForfeited"
  | "onCreditOverageCharged"
  | "onCreditManualAdjustment"
  | "onCreditBalanceLow";

export type DodoBillingProviderOptions = {
  billing?: OpenMeterBillingAdapterOptions | undefined;
  ctx?:
    | GenericEndpointContext
    | ((payload: DodoWebhookPayload) => GenericEndpointContext)
    | undefined;
  apply?: boolean | undefined;
  resolveCustomerIdOrKey?:
    | ((payload: DodoWebhookPayload) => string | Promise<string>)
    | undefined;
  resolveSubject?:
    | ((payload: DodoWebhookPayload) => string | Promise<string>)
    | undefined;
  resolveCustomerType?:
    | ((
        payload: DodoWebhookPayload,
      ) => "user" | "organization" | (string & {}) | undefined)
    | undefined;
  resolvePlan?:
    | ((payload: DodoWebhookPayload) => string | undefined | Promise<string | undefined>)
    | undefined;
  metadata?:
    | Record<string, unknown>
    | ((payload: DodoWebhookPayload) => Record<string, unknown>)
    | undefined;
  onBillingEvent?:
    | ((
        event: OpenMeterBillingEvent,
        payload: DodoWebhookPayload,
      ) => Promise<void> | void)
    | undefined;
};

export type DodoBillingProvider = OpenMeterBillingProvider & {
  callbacks: Record<
    DodoBillingCallbackName,
    (payload: DodoWebhookPayload) => Promise<void>
  >;
  onPayload: (payload: DodoWebhookPayload) => Promise<void>;
  toBillingEvent: (
    callbackName: DodoBillingCallbackName | "onPayload",
    payload: DodoWebhookPayload,
  ) => Promise<OpenMeterBillingEvent>;
  handleWebhookEvent: (
    callbackName: DodoBillingCallbackName | "onPayload",
    payload: DodoWebhookPayload,
  ) => Promise<OpenMeterBillingEvent>;
};

const callbackEventTypes: Record<
  DodoBillingCallbackName,
  OpenMeterBillingEvent["type"]
> = {
  onPaymentSucceeded: "invoice.paid",
  onPaymentFailed: "invoice.payment_failed",
  onPaymentProcessing: "invoice.processing",
  onPaymentCancelled: "invoice.canceled",
  onRefundSucceeded: "invoice.refunded",
  onRefundFailed: "invoice.refund_failed",
  onDisputeOpened: "dispute.opened",
  onDisputeExpired: "dispute.expired",
  onDisputeAccepted: "dispute.accepted",
  onDisputeCancelled: "dispute.canceled",
  onDisputeChallenged: "dispute.challenged",
  onDisputeWon: "dispute.won",
  onDisputeLost: "dispute.lost",
  onSubscriptionActive: "subscription.active",
  onSubscriptionOnHold: "subscription.on_hold",
  onSubscriptionRenewed: "invoice.paid",
  onSubscriptionPlanChanged: "subscription.updated",
  onSubscriptionCancelled: "subscription.canceled",
  onSubscriptionFailed: "subscription.failed",
  onSubscriptionExpired: "subscription.expired",
  onSubscriptionUpdated: "subscription.updated",
  onLicenseKeyCreated: "license.created",
  onAbandonedCheckoutDetected: "checkout.abandoned",
  onAbandonedCheckoutRecovered: "checkout.recovered",
  onDunningStarted: "dunning.started",
  onDunningRecovered: "dunning.recovered",
  onCreditAdded: "credit.added",
  onCreditDeducted: "credit.deducted",
  onCreditExpired: "credit.expired",
  onCreditRolledOver: "credit.rolled_over",
  onCreditRolloverForfeited: "credit.rollover_forfeited",
  onCreditOverageCharged: "credit.overage_charged",
  onCreditManualAdjustment: "credit.manual_adjustment",
  onCreditBalanceLow: "credit.balance_low",
};

const eventTypeAliases: Record<string, OpenMeterBillingEvent["type"]> = {
  payment_succeeded: "invoice.paid",
  payment_failed: "invoice.payment_failed",
  payment_processing: "invoice.processing",
  payment_cancelled: "invoice.canceled",
  refund_succeeded: "invoice.refunded",
  refund_failed: "invoice.refund_failed",
  subscription_active: "subscription.active",
  subscription_on_hold: "subscription.on_hold",
  subscription_renewed: "invoice.paid",
  subscription_plan_changed: "subscription.updated",
  subscription_cancelled: "subscription.canceled",
  subscription_failed: "subscription.failed",
  subscription_expired: "subscription.expired",
  subscription_updated: "subscription.updated",
};

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, field: string) {
  const value = record?.[field];
  return typeof value === "string" ? value : undefined;
}

function getPayloadData(payload: DodoWebhookPayload) {
  return asRecord(payload.data) ?? asRecord(payload.payload) ?? payload;
}

function getNestedRecord(payload: DodoWebhookPayload, field: string) {
  return asRecord(getPayloadData(payload)[field]);
}

function getMetadata(payload: DodoWebhookPayload) {
  const data = getPayloadData(payload);
  return (
    asRecord(payload.metadata) ??
    asRecord(data.metadata) ??
    asRecord(getNestedRecord(payload, "customer")?.metadata) ??
    asRecord(getNestedRecord(payload, "subscription")?.metadata)
  );
}

function getReferenceId(payload: DodoWebhookPayload) {
  const data = getPayloadData(payload);
  const metadata = getMetadata(payload);
  return (
    stringField(metadata, "referenceId") ??
    stringField(metadata, "reference_id") ??
    stringField(metadata, "userId") ??
    stringField(metadata, "organizationId") ??
    stringField(data, "referenceId") ??
    stringField(data, "reference_id") ??
    stringField(getNestedRecord(payload, "customer"), "referenceId") ??
    stringField(getNestedRecord(payload, "subscription"), "referenceId")
  );
}

function getCustomerId(payload: DodoWebhookPayload) {
  const data = getPayloadData(payload);
  const customer = getNestedRecord(payload, "customer");
  const subscription = getNestedRecord(payload, "subscription");
  return (
    stringField(data, "customer_id") ??
    stringField(data, "customerId") ??
    stringField(customer, "customer_id") ??
    stringField(customer, "id") ??
    stringField(subscription, "customer_id") ??
    stringField(subscription, "customerId")
  );
}

function getSubscriptionId(payload: DodoWebhookPayload) {
  const data = getPayloadData(payload);
  const subscription = getNestedRecord(payload, "subscription");
  return (
    stringField(data, "subscription_id") ??
    stringField(data, "subscriptionId") ??
    stringField(subscription, "subscription_id") ??
    stringField(subscription, "id") ??
    stringField(data, "id")
  );
}

function getProductCartItem(payload: DodoWebhookPayload) {
  const cart = getPayloadData(payload).product_cart;
  return Array.isArray(cart) ? asRecord(cart[0]) : undefined;
}

function getProductName(payload: DodoWebhookPayload) {
  const data = getPayloadData(payload);
  const product = getNestedRecord(payload, "product");
  const item = getProductCartItem(payload);
  return (
    stringField(data, "product_id") ??
    stringField(data, "productId") ??
    stringField(product, "product_id") ??
    stringField(product, "id") ??
    stringField(product, "name") ??
    stringField(item, "product_id")
  );
}

function getEventType(
  callbackName: DodoBillingCallbackName | "onPayload",
  payload: DodoWebhookPayload,
) {
  if (callbackName !== "onPayload") return callbackEventTypes[callbackName];
  const eventType = payload.event_type;
  if (!eventType) return "webhook.received";
  return eventTypeAliases[eventType] ?? eventType;
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
  options: DodoBillingProviderOptions,
  payload: DodoWebhookPayload,
) {
  if (typeof options.ctx === "function") return options.ctx(payload);
  return options.ctx ?? createFallbackContext();
}

export const dodoBillingProvider = (
  options: DodoBillingProviderOptions = {},
) => {
  async function toBillingEvent(
    callbackName: DodoBillingCallbackName | "onPayload",
    payload: DodoWebhookPayload,
  ): Promise<OpenMeterBillingEvent> {
    const metadata =
      typeof options.metadata === "function"
        ? options.metadata(payload)
        : options.metadata;
    const data = getPayloadData(payload);
    const referenceId = getReferenceId(payload);
    const customerIdOrKey = options.resolveCustomerIdOrKey
      ? await options.resolveCustomerIdOrKey(payload)
      : referenceId ?? getCustomerId(payload);

    if (!customerIdOrKey) {
      throw new Error(
        "Dodo billing event could not resolve customerIdOrKey. Provide resolveCustomerIdOrKey.",
      );
    }

    const subject = options.resolveSubject
      ? await options.resolveSubject(payload)
      : customerIdOrKey;
    const plan = options.resolvePlan
      ? await options.resolvePlan(payload)
      : getProductName(payload);

    return {
      type: getEventType(callbackName, payload),
      provider: "dodo",
      customerIdOrKey,
      subject,
      referenceId,
      customerType: options.resolveCustomerType?.(payload),
      plan,
      subscriptionId: getSubscriptionId(payload),
      metadata: {
        ...metadata,
        callbackName,
        dodoEventType: payload.event_type,
        dodoCustomerId: getCustomerId(payload),
        status: stringField(data, "status"),
        paymentId: stringField(data, "payment_id") ?? stringField(data, "id"),
      },
      raw: payload,
    };
  }

  async function handleWebhookEvent(
    callbackName: DodoBillingCallbackName | "onPayload",
    payload: DodoWebhookPayload,
  ) {
    const event = await toBillingEvent(callbackName, payload);

    if (options.apply !== false) {
      await applyOpenMeterBillingEvent(
        event,
        resolveContext(options, payload),
        options.billing,
      );
    }

    await options.onBillingEvent?.(event, payload);
    return event;
  }

  const callbacks = Object.fromEntries(
    (Object.keys(callbackEventTypes) as DodoBillingCallbackName[]).map(
      (callbackName) => [
        callbackName,
        (payload: DodoWebhookPayload) =>
          handleWebhookEvent(callbackName, payload).then(() => undefined),
      ],
    ),
  ) as DodoBillingProvider["callbacks"];

  return {
    id: "dodo",
    plugin: {
      id: "openmeter-dodo-billing-provider",
      init(ctx) {
        if (!ctx.hasPlugin("openmeter") && !options.billing?.openmeterClient) {
          throw new Error(
            "dodoBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
          );
        }
      },
    } satisfies BetterAuthPlugin,
    callbacks,
    onPayload: (payload: DodoWebhookPayload) =>
      handleWebhookEvent("onPayload", payload).then(() => undefined),
    toBillingEvent,
    handleWebhookEvent,
  } satisfies DodoBillingProvider;
};

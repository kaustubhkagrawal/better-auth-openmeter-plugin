import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
  applyOpenMeterBillingEvent,
  type OpenMeterBillingAdapterOptions,
  type OpenMeterBillingEvent,
  type OpenMeterBillingProvider,
} from "./billing";

export type PolarWebhookPayload = {
  type?: string | undefined;
  data?: Record<string, unknown> | undefined;
  [key: string]: unknown;
};

export type PolarBillingCallbackName =
  | "onOrderPaid"
  | "onOrderRefunded"
  | "onSubscriptionCreated"
  | "onSubscriptionUpdated"
  | "onSubscriptionActive"
  | "onSubscriptionCanceled"
  | "onSubscriptionRevoked"
  | "onSubscriptionUncanceled"
  | "onCustomerStateChanged";

export type PolarBillingProviderOptions = {
  billing?: OpenMeterBillingAdapterOptions | undefined;
  ctx?:
    | GenericEndpointContext
    | ((payload: PolarWebhookPayload) => GenericEndpointContext)
    | undefined;
  apply?: boolean | undefined;
  resolveCustomerIdOrKey?:
    | ((payload: PolarWebhookPayload) => string | Promise<string>)
    | undefined;
  resolveSubject?:
    | ((payload: PolarWebhookPayload) => string | Promise<string>)
    | undefined;
  resolveCustomerType?:
    | ((
        payload: PolarWebhookPayload,
      ) => "user" | "organization" | (string & {}) | undefined)
    | undefined;
  resolvePlan?:
    | ((payload: PolarWebhookPayload) => string | undefined | Promise<string | undefined>)
    | undefined;
  metadata?:
    | Record<string, unknown>
    | ((payload: PolarWebhookPayload) => Record<string, unknown>)
    | undefined;
  onBillingEvent?:
    | ((
        event: OpenMeterBillingEvent,
        payload: PolarWebhookPayload,
      ) => Promise<void> | void)
    | undefined;
};

export type PolarBillingProvider = OpenMeterBillingProvider & {
  callbacks: Record<
    PolarBillingCallbackName,
    (payload: PolarWebhookPayload) => Promise<void>
  >;
  toBillingEvent: (
    callbackName: PolarBillingCallbackName,
    payload: PolarWebhookPayload,
  ) => Promise<OpenMeterBillingEvent>;
  handleWebhookEvent: (
    callbackName: PolarBillingCallbackName,
    payload: PolarWebhookPayload,
  ) => Promise<OpenMeterBillingEvent>;
};

const callbackEventTypes: Record<
  PolarBillingCallbackName,
  OpenMeterBillingEvent["type"]
> = {
  onOrderPaid: "invoice.paid",
  onOrderRefunded: "invoice.refunded",
  onSubscriptionCreated: "subscription.created",
  onSubscriptionUpdated: "subscription.updated",
  onSubscriptionActive: "subscription.active",
  onSubscriptionCanceled: "subscription.canceled",
  onSubscriptionRevoked: "subscription.deleted",
  onSubscriptionUncanceled: "subscription.active",
  onCustomerStateChanged: "customer.state.changed",
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

function getPayloadData(payload: PolarWebhookPayload) {
  return asRecord(payload.data) ?? payload;
}

function getMetadata(payload: PolarWebhookPayload) {
  return asRecord(getPayloadData(payload).metadata);
}

function getReferenceId(payload: PolarWebhookPayload) {
  const data = getPayloadData(payload);
  const metadata = getMetadata(payload);
  return (
    stringField(metadata, "referenceId") ??
    stringField(metadata, "reference_id") ??
    stringField(data, "referenceId") ??
    stringField(data, "reference_id") ??
    stringField(data, "customerId") ??
    stringField(data, "customer_id") ??
    stringField(asRecord(data.customer), "id")
  );
}

function getSubscriptionId(payload: PolarWebhookPayload) {
  const data = getPayloadData(payload);
  return (
    stringField(data, "subscriptionId") ??
    stringField(data, "subscription_id") ??
    stringField(asRecord(data.subscription), "id") ??
    stringField(data, "id")
  );
}

function getProductName(payload: PolarWebhookPayload) {
  const data = getPayloadData(payload);
  const product = asRecord(data.product);
  return (
    stringField(product, "name") ??
    stringField(product, "slug") ??
    stringField(data, "productName") ??
    stringField(data, "product_id") ??
    stringField(data, "productId")
  );
}

function getCustomerId(payload: PolarWebhookPayload) {
  const data = getPayloadData(payload);
  return (
    stringField(data, "customerId") ??
    stringField(data, "customer_id") ??
    stringField(asRecord(data.customer), "id")
  );
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
  options: PolarBillingProviderOptions,
  payload: PolarWebhookPayload,
) {
  if (typeof options.ctx === "function") return options.ctx(payload);
  return options.ctx ?? createFallbackContext();
}

export const polarBillingProvider = (
  options: PolarBillingProviderOptions = {},
) => {
  async function toBillingEvent(
    callbackName: PolarBillingCallbackName,
    payload: PolarWebhookPayload,
  ): Promise<OpenMeterBillingEvent> {
    const metadata =
      typeof options.metadata === "function"
        ? options.metadata(payload)
        : options.metadata;
    const referenceId = getReferenceId(payload);
    const customerIdOrKey = options.resolveCustomerIdOrKey
      ? await options.resolveCustomerIdOrKey(payload)
      : referenceId ?? getCustomerId(payload);

    if (!customerIdOrKey) {
      throw new Error(
        "Polar billing event could not resolve customerIdOrKey. Provide resolveCustomerIdOrKey.",
      );
    }

    const subject = options.resolveSubject
      ? await options.resolveSubject(payload)
      : customerIdOrKey;
    const plan = options.resolvePlan
      ? await options.resolvePlan(payload)
      : getProductName(payload);

    return {
      type: callbackEventTypes[callbackName],
      provider: "polar",
      customerIdOrKey,
      subject,
      referenceId,
      customerType: options.resolveCustomerType?.(payload),
      plan,
      subscriptionId: getSubscriptionId(payload),
      metadata: {
        ...metadata,
        callbackName,
        polarEventType: payload.type,
        polarCustomerId: getCustomerId(payload),
      },
      raw: payload,
    };
  }

  async function handleWebhookEvent(
    callbackName: PolarBillingCallbackName,
    payload: PolarWebhookPayload,
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
    (Object.keys(callbackEventTypes) as PolarBillingCallbackName[]).map(
      (callbackName) => [
        callbackName,
        (payload: PolarWebhookPayload) =>
          handleWebhookEvent(callbackName, payload).then(() => undefined),
      ],
    ),
  ) as PolarBillingProvider["callbacks"];

  return {
    id: "polar",
    plugin: {
      id: "openmeter-polar-billing-provider",
      init(ctx) {
        if (!ctx.hasPlugin("openmeter") && !options.billing?.openmeterClient) {
          throw new Error(
            "polarBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
          );
        }
      },
    } satisfies BetterAuthPlugin,
    callbacks,
    toBillingEvent,
    handleWebhookEvent,
  } satisfies PolarBillingProvider;
};


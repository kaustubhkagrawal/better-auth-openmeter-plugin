import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import {
  applyOpenMeterBillingEvent,
  type OpenMeterBillingAdapterOptions,
  type OpenMeterBillingEvent,
  type OpenMeterBillingProvider,
} from "./billing";

export type CreemCustomerEntity = {
  id?: string | undefined;
  email?: string | undefined;
  [key: string]: unknown;
};

export type CreemProductEntity = {
  id?: string | undefined;
  name?: string | undefined;
  product_url?: string | undefined;
  [key: string]: unknown;
};

export type CreemSubscriptionEntity = {
  id?: string | undefined;
  status?: string | undefined;
  product?: CreemProductEntity | string | undefined;
  customer?: CreemCustomerEntity | string | undefined;
  metadata?: Record<string, unknown> | undefined;
  current_period_start_date?: Date | string | undefined;
  current_period_end_date?: Date | string | undefined;
  canceled_at?: Date | string | null | undefined;
  items?: { price_id?: string | undefined; units?: number | undefined }[] | undefined;
  [key: string]: unknown;
};

export type CreemWebhookData = {
  webhookEventType?: string | undefined;
  webhookId?: string | undefined;
  product?: CreemProductEntity | string | undefined;
  customer?: CreemCustomerEntity | string | undefined;
  subscription?: CreemSubscriptionEntity | undefined;
  metadata?: Record<string, unknown> | undefined;
  reason?: string | undefined;
  status?: string | undefined;
  id?: string | undefined;
  [key: string]: unknown;
};

export type CreemBillingCallbackName =
  | "onCheckoutCompleted"
  | "onSubscriptionActive"
  | "onSubscriptionTrialing"
  | "onSubscriptionCanceled"
  | "onSubscriptionPaid"
  | "onSubscriptionExpired"
  | "onSubscriptionUnpaid"
  | "onSubscriptionUpdate"
  | "onSubscriptionPastDue"
  | "onSubscriptionPaused"
  | "onGrantAccess"
  | "onRevokeAccess";

export type CreemBillingProviderOptions = {
  billing?: OpenMeterBillingAdapterOptions | undefined;
  ctx?:
    | GenericEndpointContext
    | ((data: CreemWebhookData) => GenericEndpointContext)
    | undefined;
  apply?: boolean | undefined;
  resolveCustomerIdOrKey?:
    | ((data: CreemWebhookData) => string | Promise<string>)
    | undefined;
  resolveSubject?:
    | ((data: CreemWebhookData) => string | Promise<string>)
    | undefined;
  resolveCustomerType?:
    | ((
        data: CreemWebhookData,
      ) => "user" | "organization" | (string & {}) | undefined)
    | undefined;
  resolvePlan?:
    | ((data: CreemWebhookData) => string | undefined | Promise<string | undefined>)
    | undefined;
  metadata?:
    | Record<string, unknown>
    | ((data: CreemWebhookData) => Record<string, unknown>)
    | undefined;
  onBillingEvent?:
    | ((
        event: OpenMeterBillingEvent,
        data: CreemWebhookData,
      ) => Promise<void> | void)
    | undefined;
};

export type CreemBillingProvider = OpenMeterBillingProvider & {
  callbacks: Record<
    CreemBillingCallbackName,
    (data: CreemWebhookData) => Promise<void>
  >;
  toBillingEvent: (
    callbackName: CreemBillingCallbackName,
    data: CreemWebhookData,
  ) => Promise<OpenMeterBillingEvent>;
  handleWebhookEvent: (
    callbackName: CreemBillingCallbackName,
    data: CreemWebhookData,
  ) => Promise<OpenMeterBillingEvent>;
};

const callbackEventTypes: Record<
  CreemBillingCallbackName,
  OpenMeterBillingEvent["type"]
> = {
  onCheckoutCompleted: "checkout.completed",
  onSubscriptionActive: "subscription.active",
  onSubscriptionTrialing: "trial.started",
  onSubscriptionCanceled: "subscription.canceled",
  onSubscriptionPaid: "invoice.paid",
  onSubscriptionExpired: "subscription.expired",
  onSubscriptionUnpaid: "subscription.unpaid",
  onSubscriptionUpdate: "subscription.updated",
  onSubscriptionPastDue: "subscription.past_due",
  onSubscriptionPaused: "subscription.paused",
  onGrantAccess: "subscription.active",
  onRevokeAccess: "subscription.revoked",
};

const grantReasonEventTypes: Record<string, OpenMeterBillingEvent["type"]> = {
  subscription_active: "subscription.active",
  subscription_trialing: "trial.started",
  subscription_paid: "invoice.paid",
};

const revokeReasonEventTypes: Record<string, OpenMeterBillingEvent["type"]> = {
  subscription_paused: "subscription.paused",
  subscription_expired: "subscription.expired",
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

function numberField(record: Record<string, unknown> | undefined, field: string) {
  const value = record?.[field];
  return typeof value === "number" ? value : undefined;
}

function getSubscription(data: CreemWebhookData) {
  return asRecord(data.subscription) ?? data;
}

function getMetadata(data: CreemWebhookData) {
  return (
    asRecord(data.metadata) ??
    asRecord(getSubscription(data).metadata) ??
    undefined
  );
}

function getReferenceId(data: CreemWebhookData) {
  const metadata = getMetadata(data);
  const subscription = getSubscription(data);
  return (
    stringField(metadata, "referenceId") ??
    stringField(metadata, "reference_id") ??
    stringField(metadata, "userId") ??
    stringField(metadata, "organizationId") ??
    stringField(data, "referenceId") ??
    stringField(data, "reference_id") ??
    stringField(subscription, "referenceId") ??
    stringField(subscription, "reference_id")
  );
}

function getSubscriptionId(data: CreemWebhookData) {
  const subscription = getSubscription(data);
  return stringField(subscription, "id") ?? stringField(data, "id");
}

function getProduct(data: CreemWebhookData) {
  const subscription = getSubscription(data);
  return asRecord(data.product) ?? asRecord(subscription.product);
}

function getProductName(data: CreemWebhookData) {
  const product = getProduct(data);
  const subscription = getSubscription(data);
  return (
    stringField(product, "name") ??
    stringField(product, "id") ??
    stringField(subscription, "product") ??
    stringField(data, "productId") ??
    stringField(data, "product_id")
  );
}

function getCustomer(data: CreemWebhookData) {
  const subscription = getSubscription(data);
  return asRecord(data.customer) ?? asRecord(subscription.customer);
}

function getCustomerId(data: CreemWebhookData) {
  const customer = getCustomer(data);
  const subscription = getSubscription(data);
  return (
    stringField(customer, "id") ??
    stringField(subscription, "customer") ??
    stringField(data, "customerId") ??
    stringField(data, "customer_id")
  );
}

function getFirstItem(data: CreemWebhookData) {
  const items = getSubscription(data).items;
  return Array.isArray(items) ? asRecord(items[0]) : undefined;
}

function getEventType(
  callbackName: CreemBillingCallbackName,
  data: CreemWebhookData,
) {
  if (callbackName === "onGrantAccess" && data.reason) {
    return grantReasonEventTypes[data.reason] ?? callbackEventTypes[callbackName];
  }
  if (callbackName === "onRevokeAccess" && data.reason) {
    return revokeReasonEventTypes[data.reason] ?? callbackEventTypes[callbackName];
  }
  return callbackEventTypes[callbackName];
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
  options: CreemBillingProviderOptions,
  data: CreemWebhookData,
) {
  if (typeof options.ctx === "function") return options.ctx(data);
  return options.ctx ?? createFallbackContext();
}

export const creemBillingProvider = (
  options: CreemBillingProviderOptions = {},
) => {
  async function toBillingEvent(
    callbackName: CreemBillingCallbackName,
    data: CreemWebhookData,
  ): Promise<OpenMeterBillingEvent> {
    const metadata =
      typeof options.metadata === "function"
        ? options.metadata(data)
        : options.metadata;
    const referenceId = getReferenceId(data);
    const customerIdOrKey = options.resolveCustomerIdOrKey
      ? await options.resolveCustomerIdOrKey(data)
      : referenceId ?? getCustomerId(data);

    if (!customerIdOrKey) {
      throw new Error(
        "Creem billing event could not resolve customerIdOrKey. Provide resolveCustomerIdOrKey.",
      );
    }

    const subject = options.resolveSubject
      ? await options.resolveSubject(data)
      : customerIdOrKey;
    const plan = options.resolvePlan
      ? await options.resolvePlan(data)
      : getProductName(data);
    const subscription = getSubscription(data);
    const item = getFirstItem(data);

    return {
      type: getEventType(callbackName, data),
      provider: "creem",
      customerIdOrKey,
      subject,
      referenceId,
      customerType: options.resolveCustomerType?.(data),
      plan,
      subscriptionId: getSubscriptionId(data),
      metadata: {
        ...metadata,
        callbackName,
        creemEventType: data.webhookEventType,
        creemWebhookId: data.webhookId,
        creemCustomerId: getCustomerId(data),
        status: stringField(subscription, "status") ?? data.status,
        reason: data.reason,
        priceId: stringField(item, "price_id"),
        units: numberField(item, "units"),
      },
      raw: data,
    };
  }

  async function handleWebhookEvent(
    callbackName: CreemBillingCallbackName,
    data: CreemWebhookData,
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
    (Object.keys(callbackEventTypes) as CreemBillingCallbackName[]).map(
      (callbackName) => [
        callbackName,
        (data: CreemWebhookData) =>
          handleWebhookEvent(callbackName, data).then(() => undefined),
      ],
    ),
  ) as CreemBillingProvider["callbacks"];

  return {
    id: "creem",
    plugin: {
      id: "openmeter-creem-billing-provider",
      init(ctx) {
        if (!ctx.hasPlugin("openmeter") && !options.billing?.openmeterClient) {
          throw new Error(
            "creemBillingProvider requires openmeterPlugin() or billing.openmeterClient.",
          );
        }
      },
    } satisfies BetterAuthPlugin,
    callbacks,
    toBillingEvent,
    handleWebhookEvent,
  } satisfies CreemBillingProvider;
};

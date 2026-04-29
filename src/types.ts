import type { GenericEndpointContext, Session, User } from "better-auth";
import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";
import type { OpenMeter } from "@openmeter/sdk";

export type JsonObject = Record<string, unknown>;

export type OpenMeterClient = Pick<
  OpenMeter,
  "customers" | "events" | "portal"
>;

export type WithOpenMeterCustomerId = {
  openmeterCustomerId?: string | undefined;
};

export type OpenMeterCtxSession = {
  session: Session;
  user: User & WithOpenMeterCustomerId;
};

export type OpenMeterUsageEvent = {
  id?: string | undefined;
  specversion?: "1.0" | undefined;
  type: string;
  source?: string | undefined;
  subject?: string | undefined;
  time?: string | Date | undefined;
  data?: JsonObject | undefined;
  [key: string]: unknown;
};

export type OpenMeterAuthEventType =
  | "better-auth.user.created"
  | "better-auth.user.updated"
  | "better-auth.user.signed-in"
  | "better-auth.user.signed-up";

export type OpenMeterCustomer = Awaited<
  ReturnType<OpenMeter["customers"]["create"]>
>;

export type ResolveUserValue<T> = (params: {
  user: User & WithOpenMeterCustomerId;
  ctx?: GenericEndpointContext | undefined;
}) => T | Promise<T>;

export type OpenMeterOptions = {
  /**
   * Existing SDK client. Use this when you need custom fetch, headers, or a
   * self-hosted OpenMeter instance.
   */
  openmeterClient?: OpenMeterClient | undefined;
  /**
   * API key for OpenMeter Cloud or a protected self-hosted instance.
   */
  apiKey?: string | undefined;
  /**
   * Defaults to OpenMeter Cloud when only `apiKey` is supplied.
   */
  baseUrl?: string | undefined;
  /**
   * Defaults to true for client-facing endpoints.
   */
  requireSession?: boolean | undefined;
  /**
   * Create and link an OpenMeter customer when a Better Auth user is created.
   */
  createCustomerOnSignUp?: boolean | undefined;
  /**
   * Update the OpenMeter customer profile when the Better Auth user changes.
   */
  syncCustomerOnUserUpdate?: boolean | undefined;
  /**
   * Ingest auth lifecycle usage events through OpenMeter.
   */
  trackAuthEvents?: boolean | undefined;
  /**
   * Defaults to `better-auth`.
   */
  eventSource?: string | undefined;
  /**
   * Throw endpoint/database hook failures instead of logging and continuing.
   */
  failOnOpenMeterError?: boolean | undefined;
  /**
   * Optional Better Auth schema overrides.
   */
  schema?: BetterAuthPluginDBSchema | undefined;
  customer?: {
    /**
     * Defaults to the Better Auth user id.
     */
    resolveKey?: ResolveUserValue<string> | undefined;
    /**
     * Defaults to the same value as `resolveKey`.
     */
    resolveSubject?: ResolveUserValue<string> | undefined;
    /**
     * Defaults to user.name, user.email, then user.id.
     */
    resolveName?: ResolveUserValue<string> | undefined;
    /**
     * Additional customer metadata merged with Better Auth metadata.
     */
    metadata?:
      | JsonObject
      | ResolveUserValue<JsonObject | undefined>
      | undefined;
    /**
     * Optional default currency passed to OpenMeter customers.
     */
    currency?: string | undefined;
  } | undefined;
  events?: {
    /**
     * Enrich every ingested event before it is sent to OpenMeter.
     */
    enrich?:
      | ((
          event: OpenMeterUsageEvent,
          params: {
            user: User & WithOpenMeterCustomerId;
            ctx: GenericEndpointContext;
          },
        ) => OpenMeterUsageEvent | Promise<OpenMeterUsageEvent>)
      | undefined;
  } | undefined;
  callbacks?: {
    onCustomerSynced?:
      | ((
          params: {
            customer: OpenMeterCustomer;
            user: User & WithOpenMeterCustomerId;
          },
          ctx: GenericEndpointContext,
        ) => Promise<void> | void)
      | undefined;
    onEventIngested?:
      | ((
          params: {
            events: OpenMeterUsageEvent[];
            user?: (User & WithOpenMeterCustomerId) | undefined;
          },
          ctx: GenericEndpointContext,
        ) => Promise<void> | void)
      | undefined;
    onError?:
      | ((
          error: unknown,
          params: {
            operation: string;
            user?: (User & WithOpenMeterCustomerId) | undefined;
          },
          ctx?: GenericEndpointContext | undefined,
        ) => Promise<void> | void)
      | undefined;
  } | undefined;
};

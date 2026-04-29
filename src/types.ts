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

export type OpenMeterOrganization = {
  id: string;
  name?: string | undefined;
  slug?: string | undefined;
  openmeterCustomerId?: string | undefined;
  [key: string]: unknown;
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

export type OpenMeterCustomerCreate = Parameters<
  OpenMeter["customers"]["create"]
>[0];

export type OpenMeterCustomerProfile = Partial<
  Omit<OpenMeterCustomerCreate, "key" | "usageAttribution" | "metadata">
> & {
  metadata?: JsonObject | null | undefined;
};

export type ResolveUserValue<T> = (params: {
  user: User & WithOpenMeterCustomerId;
  ctx?: GenericEndpointContext | undefined;
}) => T | Promise<T>;

export type ResolveOrganizationValue<T> = (params: {
  organization: OpenMeterOrganization;
  user: User & WithOpenMeterCustomerId;
  ctx?: GenericEndpointContext | undefined;
}) => T | Promise<T>;

export type ResolveUserProfile = (params: {
  user: User & WithOpenMeterCustomerId;
  ctx?: GenericEndpointContext | undefined;
  defaults: OpenMeterCustomerProfile;
}) =>
  | OpenMeterCustomerProfile
  | undefined
  | Promise<OpenMeterCustomerProfile | undefined>;

export type ResolveOrganizationProfile = (params: {
  organization: OpenMeterOrganization;
  user: User & WithOpenMeterCustomerId;
  ctx?: GenericEndpointContext | undefined;
  defaults: OpenMeterCustomerProfile;
}) =>
  | OpenMeterCustomerProfile
  | undefined
  | Promise<OpenMeterCustomerProfile | undefined>;

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
     * Customize the OpenMeter customer profile payload. The returned fields are
     * merged over the plugin defaults. Use `resolveKey` and `resolveSubject`
     * for identity; profile cannot change customer key or usage attribution.
     */
    resolveProfile?:
      | ResolveUserProfile
      | undefined;
    /**
     * Optional default currency passed to OpenMeter customers.
     */
    currency?: string | undefined;
  } | undefined;
  organization?:
    | {
        /**
         * Enables organization-scoped OpenMeter customers and endpoints.
         * Requires Better Auth's organization plugin.
         */
        enabled: true;
        /**
         * Optional org roles allowed to call organization-scoped endpoints.
         * Omit to allow any organization member.
         */
        allowedRoles?: string[] | undefined;
        /**
         * Create and link an OpenMeter customer when an organization is created.
         */
        createCustomerOnOrganizationCreate?: boolean | undefined;
        /**
         * Update the OpenMeter customer profile when an organization changes.
         */
        syncCustomerOnOrganizationUpdate?: boolean | undefined;
        /**
         * Defaults to the Better Auth organization id.
         */
        resolveKey?: ResolveOrganizationValue<string> | undefined;
        /**
         * Defaults to the same value as `resolveKey`.
         */
        resolveSubject?: ResolveOrganizationValue<string> | undefined;
        /**
         * Defaults to organization.name, organization.slug, then organization.id.
         */
        resolveName?: ResolveOrganizationValue<string> | undefined;
        /**
         * Additional customer metadata merged with Better Auth organization metadata.
         */
        metadata?:
          | JsonObject
          | ResolveOrganizationValue<JsonObject | undefined>
          | undefined;
        /**
         * Customize the OpenMeter organization customer profile payload. The
         * returned fields are merged over the plugin defaults. Use `resolveKey`
         * and `resolveSubject` for identity.
         */
        resolveProfile?:
          | ResolveOrganizationProfile
          | undefined;
        /**
         * Optional default currency passed to OpenMeter organization customers.
         */
        currency?: string | undefined;
      }
    | undefined;
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
            organization?: OpenMeterOrganization | undefined;
          },
          ctx: GenericEndpointContext,
        ) => Promise<void> | void)
      | undefined;
    onEventIngested?:
      | ((
          params: {
            events: OpenMeterUsageEvent[];
            user?: (User & WithOpenMeterCustomerId) | undefined;
            organization?: OpenMeterOrganization | undefined;
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
            organization?: OpenMeterOrganization | undefined;
          },
          ctx?: GenericEndpointContext | undefined,
        ) => Promise<void> | void)
      | undefined;
  } | undefined;
};

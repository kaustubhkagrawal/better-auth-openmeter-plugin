import type { BetterAuthPlugin, HookEndpointContext } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import type { OpenMeterUsageEvent } from "../types";
import {
  assertOpenMeterPlugin,
  getOpenMeterClient,
  type OpenMeterAdapterOptions,
  withAdapterDefaults,
} from "./shared";

export type OpenMeterApiKey = {
  id: string;
  name?: string | null | undefined;
  start?: string | null | undefined;
  referenceId: string;
  configId?: string | undefined;
  remaining?: number | null | undefined;
  requestCount?: number | null | undefined;
  rateLimitEnabled?: boolean | null | undefined;
  rateLimitMax?: number | null | undefined;
  rateLimitTimeWindow?: number | null | undefined;
  permissions?: unknown;
  metadata?: Record<string, unknown> | null | undefined;
  [key: string]: unknown;
};

export type OpenMeterApiKeyAdapterOptions = OpenMeterAdapterOptions & {
  /**
   * Defaults to true. Set to false when this adapter gets an explicit client
   * and may be used without the core OpenMeter plugin.
   */
  requireOpenMeterPlugin?: boolean | undefined;
  /**
   * Defaults to true.
   */
  requireApiKeyPlugin?: boolean | undefined;
  /**
   * Defaults to `/api-key/verify`.
   */
  verifyPath?: string | undefined;
  /**
   * Defaults to `better-auth.api-key.verified`.
   */
  eventType?: string | undefined;
  /**
   * Resolve the OpenMeter subject for a verified key.
   */
  resolveSubject?:
    | ((
        params: {
          apiKey: OpenMeterApiKey;
          ctx: HookEndpointContext;
        },
      ) => string | Promise<string>)
    | undefined;
  /**
   * Return false to skip ingestion for a given key.
   */
  shouldIngest?:
    | ((
        params: {
          apiKey: OpenMeterApiKey;
          ctx: HookEndpointContext;
        },
      ) => boolean | Promise<boolean>)
    | undefined;
  /**
   * Customize the event before ingestion.
   */
  buildEvent?:
    | ((
        params: {
          apiKey: OpenMeterApiKey;
          subject: string;
          ctx: HookEndpointContext;
        },
      ) => OpenMeterUsageEvent | Promise<OpenMeterUsageEvent>)
    | undefined;
  /**
   * Called after successful ingestion.
   */
  onEventIngested?:
    | ((
        params: {
          event: OpenMeterUsageEvent;
          apiKey: OpenMeterApiKey;
        },
        ctx: HookEndpointContext,
      ) => Promise<void> | void)
    | undefined;
  /**
   * Called when ingestion fails. Errors are logged and swallowed unless
   * `throwOnError` is true.
   */
  onError?:
    | ((
        error: unknown,
        params: {
          apiKey?: OpenMeterApiKey | undefined;
          operation: string;
        },
        ctx: HookEndpointContext,
      ) => Promise<void> | void)
    | undefined;
  throwOnError?: boolean | undefined;
};

function getVerifiedApiKey(ctx: HookEndpointContext) {
  const returned = ctx.context.returned as
    | {
        valid?: boolean;
        key?: OpenMeterApiKey | null;
      }
    | undefined;

  if (!returned?.valid || !returned.key) return null;
  return returned.key;
}

function getDefaultSubject(apiKey: OpenMeterApiKey) {
  const metadataSubject = apiKey.metadata?.openmeterSubject;
  return typeof metadataSubject === "string"
    ? metadataSubject
    : apiKey.referenceId;
}

function buildDefaultEvent(
  apiKey: OpenMeterApiKey,
  subject: string,
  options: OpenMeterApiKeyAdapterOptions,
) {
  return withAdapterDefaults(
    {
      type: options.eventType ?? "better-auth.api-key.verified",
      subject,
      data: {
        apiKeyId: apiKey.id,
        apiKeyName: apiKey.name ?? undefined,
        apiKeyStart: apiKey.start ?? undefined,
        apiKeyConfigId: apiKey.configId,
        referenceId: apiKey.referenceId,
        remaining: apiKey.remaining,
        requestCount: apiKey.requestCount,
        rateLimitEnabled: apiKey.rateLimitEnabled,
        rateLimitMax: apiKey.rateLimitMax,
        rateLimitTimeWindow: apiKey.rateLimitTimeWindow,
        permissions: apiKey.permissions,
        metadata: apiKey.metadata ?? undefined,
      },
    },
    options,
  );
}

export const openmeterApiKeyAdapter = (
  options: OpenMeterApiKeyAdapterOptions = {},
) => {
  const requireOpenMeterPlugin = options.requireOpenMeterPlugin !== false;
  const requireApiKeyPlugin = options.requireApiKeyPlugin !== false;
  const verifyPath = options.verifyPath ?? "/api-key/verify";

  return {
    id: "openmeter-api-key-adapter",
    init(ctx) {
      if (requireOpenMeterPlugin) {
        assertOpenMeterPlugin(ctx);
      }
      if (requireApiKeyPlugin && !ctx.hasPlugin("api-key")) {
        throw new Error(
          "openmeterApiKeyAdapter requires @better-auth/api-key.",
        );
      }
    },
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === verifyPath,
          handler: createAuthMiddleware(async (ctx) => {
            const hookCtx = ctx as unknown as HookEndpointContext;
            const apiKey = getVerifiedApiKey(hookCtx);
            if (!apiKey) return;

            try {
              if (
                options.shouldIngest &&
                !(await options.shouldIngest({ apiKey, ctx: hookCtx }))
              ) {
                return;
              }

              const subject = options.resolveSubject
                ? await options.resolveSubject({ apiKey, ctx: hookCtx })
                : getDefaultSubject(apiKey);
              const event = options.buildEvent
                ? await options.buildEvent({ apiKey, subject, ctx: hookCtx })
                : buildDefaultEvent(apiKey, subject, options);
              const client = getOpenMeterClient(hookCtx, options);

              await client.events.ingest(event as never);
              await options.onEventIngested?.({ event, apiKey }, hookCtx);
            } catch (error) {
              await options.onError?.(
                error,
                { apiKey, operation: "api-key-verify-event" },
                hookCtx,
              );
              ctx.context.logger.error(
                `OpenMeter API key adapter failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              if (options.throwOnError) throw error;
            }
          }),
        },
      ],
    },
    options,
  } satisfies BetterAuthPlugin;
};

export const apiKeyAdapter = openmeterApiKeyAdapter;

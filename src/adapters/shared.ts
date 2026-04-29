import type {
  BetterAuthPlugin,
  GenericEndpointContext,
  HookEndpointContext,
} from "better-auth";
import { APIError } from "better-auth/api";
import type {
  OpenMeterClient,
  OpenMeterOptions,
  OpenMeterUsageEvent,
} from "../types";

export type OpenMeterAdapterContext =
  | GenericEndpointContext
  | HookEndpointContext;

export type OpenMeterAdapterOptions = {
  /**
   * Optional explicit client. If omitted, adapters read the client from
   * `openmeterPlugin()` via Better Auth's plugin registry.
   */
  openmeterClient?: OpenMeterClient | undefined;
  /**
   * Defaults to `better-auth`.
   */
  eventSource?: string | undefined;
};

export function getOpenMeterPlugin(ctx: OpenMeterAdapterContext) {
  return ctx.context.getPlugin?.("openmeter") as
    | (BetterAuthPlugin & { options?: OpenMeterOptions })
    | null
    | undefined;
}

export function getOpenMeterClient(
  ctx: OpenMeterAdapterContext,
  options?: OpenMeterAdapterOptions | undefined,
) {
  const client =
    options?.openmeterClient ?? getOpenMeterPlugin(ctx)?.options?.openmeterClient;

  if (!client) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message:
        "OpenMeter client is required. Add openmeterPlugin() before this adapter or pass openmeterClient.",
      code: "OPENMETER_CLIENT_NOT_FOUND",
    });
  }

  return client;
}

export function assertOpenMeterPlugin(ctx: {
  hasPlugin?: (pluginId: string) => boolean;
}) {
  if (!ctx.hasPlugin?.("openmeter")) {
    throw new Error("OpenMeter adapters require openmeterPlugin().");
  }
}

export function withAdapterDefaults(
  event: OpenMeterUsageEvent,
  options?: OpenMeterAdapterOptions | undefined,
) {
  return {
    specversion: "1.0" as const,
    source: options?.eventSource ?? "better-auth",
    ...event,
  };
}


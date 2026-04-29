import type { BetterAuthClientPlugin } from "better-auth/client";
import type { openmeter } from "./index";

export const openmeterClient = () => {
  return {
    id: "openmeter",
    $InferServerPlugin: {} as ReturnType<
      typeof openmeter<{
        openmeterClient: any;
      }>
    >,
    pathMethods: {
      "/openmeter/events/ingest": "POST",
      "/openmeter/customer/sync": "POST",
      "/openmeter/customer": "GET",
      "/openmeter/customer/access": "GET",
      "/openmeter/entitlements": "GET",
      "/openmeter/entitlement/value": "GET",
    },
  } satisfies BetterAuthClientPlugin;
};

export const openmeterClientPlugin = openmeterClient;

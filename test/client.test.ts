import { describe, expect, it } from "vitest";
import { openmeterClient, openmeterClientPlugin } from "../src/client";

describe("openmeterClient", () => {
  it("exposes Better Auth client path methods", () => {
    const plugin = openmeterClient();

    expect(plugin.id).toBe("openmeter");
    expect(plugin.pathMethods).toMatchObject({
      "/openmeter/events/ingest": "POST",
      "/openmeter/customer/sync": "POST",
      "/openmeter/customer": "GET",
      "/openmeter/customer/access": "GET",
      "/openmeter/entitlements": "GET",
      "/openmeter/entitlement/value": "GET",
    });
  });

  it("exports the compatibility alias", () => {
    expect(openmeterClientPlugin).toBe(openmeterClient);
  });
});

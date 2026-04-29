import { describe, expect, it } from "vitest";
import { openmeterQueryKeys } from "../src/react";

describe("openmeterQueryKeys", () => {
  it("creates stable query keys", () => {
    expect(openmeterQueryKeys.all).toEqual(["openmeter"]);
    expect(openmeterQueryKeys.customer()).toEqual(["openmeter", "customer"]);
    expect(openmeterQueryKeys.access()).toEqual([
      "openmeter",
      "customer",
      "access",
    ]);
    expect(openmeterQueryKeys.entitlements()).toEqual([
      "openmeter",
      "customer",
      "entitlements",
    ]);
    expect(openmeterQueryKeys.entitlementValue("ai_tokens")).toEqual([
      "openmeter",
      "customer",
      "entitlements",
      "value",
      "ai_tokens",
    ]);
  });
});

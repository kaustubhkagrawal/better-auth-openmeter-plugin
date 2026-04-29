import { describe, expect, it } from "vitest";
import { getSchema, organization, user } from "../src/schema";

describe("user schema", () => {
  it("extends user with openmeterCustomerId", () => {
    expect(user.user.fields.openmeterCustomerId).toMatchObject({
      type: "string",
      required: false,
    });
  });
});

describe("organization schema", () => {
  it("extends organization with openmeterCustomerId", () => {
    expect(organization.organization.fields.openmeterCustomerId).toMatchObject({
      type: "string",
      required: false,
    });
  });
});

describe("getSchema", () => {
  it("returns the OpenMeter user schema", () => {
    const schema = getSchema({ openmeterClient: {} as any });

    expect(schema).toHaveProperty("user");
    expect(schema.user.fields).toHaveProperty("openmeterCustomerId");
  });

  it("includes organization schema when organization mode is enabled", () => {
    const schema = getSchema({
      openmeterClient: {} as any,
      organization: { enabled: true },
    });

    expect(schema).toHaveProperty("organization");
    expect(schema.organization.fields).toHaveProperty("openmeterCustomerId");
  });

  it("merges schema overrides", () => {
    const schema = getSchema({
      openmeterClient: {} as any,
      schema: {
        user: {
          fields: {},
          modelName: "users",
        },
      },
    }) as any;

    expect(schema.user.modelName).toBe("users");
  });
});

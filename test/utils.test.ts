import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import type { OpenMeterOptions, OpenMeterUsageEvent } from "../src/types";
import {
  OPENMETER_ERROR_CODES,
  addDefaultSubject,
  authPathToEventType,
  createAPIError,
  normalizeUsageEvents,
  resolveOrganizationCustomerKey,
  resolveOrganizationCustomerMetadata,
  resolveOrganizationCustomerName,
  resolveOrganizationCustomerProfile,
  resolveOrganizationSubject,
  resolveCustomerKey,
  resolveCustomerMetadata,
  resolveCustomerName,
  resolveCustomerProfile,
  resolveSubject,
} from "../src/utils";

const user = {
  id: "user_123",
  email: "test@example.com",
  name: "Test User",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

const organization = {
  id: "org_123",
  name: "Acme Inc",
  slug: "acme",
} as any;

const ctx = {
  context: {
    logger: {
      error: () => undefined,
    },
  },
} as any;

describe("createAPIError", () => {
  it("returns an APIError with code", () => {
    const error = createAPIError("BAD_REQUEST", "Nope");

    expect(error).toBeInstanceOf(APIError);
    expect(error.status).toBe("BAD_REQUEST");
    expect(error.body).toMatchObject({ message: "Nope", code: "Nope" });
  });
});

describe("customer resolvers", () => {
  it("uses the user id by default for customer key and subject", async () => {
    const options: OpenMeterOptions = { openmeterClient: {} as any };

    await expect(resolveCustomerKey(options, user, ctx)).resolves.toBe(
      "user_123",
    );
    await expect(resolveSubject(options, user, ctx)).resolves.toBe("user_123");
  });

  it("supports custom customer resolvers", async () => {
    const options: OpenMeterOptions = {
      openmeterClient: {} as any,
      customer: {
        resolveKey: ({ user }) => `customer:${user.id}`,
        resolveSubject: ({ user }) => `subject:${user.id}`,
        resolveName: ({ user }) => user.email,
        metadata: { plan: "pro" },
      },
    };

    await expect(resolveCustomerKey(options, user, ctx)).resolves.toBe(
      "customer:user_123",
    );
    await expect(resolveSubject(options, user, ctx)).resolves.toBe(
      "subject:user_123",
    );
    await expect(resolveCustomerName(options, user, ctx)).resolves.toBe(
      "test@example.com",
    );
    await expect(resolveCustomerMetadata(options, user, ctx)).resolves.toMatchObject(
      {
        betterAuthUserId: "user_123",
        betterAuthEmail: "test@example.com",
        plan: "pro",
      },
    );
  });

  it("merges custom customer profile fields over defaults", async () => {
    const options: OpenMeterOptions = {
      openmeterClient: {} as any,
      customer: {
        currency: "USD",
        metadata: { plan: "pro" },
        resolveProfile: ({ defaults }) => ({
          description: "Primary workspace owner",
          primaryEmail: "billing@example.com",
          metadata: {
            ...defaults.metadata,
            region: "us",
          },
          billingAddress: {
            country: "US",
            postalCode: "94105",
          },
        }),
      },
    };

    await expect(resolveCustomerProfile(options, user, ctx)).resolves.toMatchObject(
      {
        name: "Test User",
        description: "Primary workspace owner",
        primaryEmail: "billing@example.com",
        currency: "USD",
        metadata: {
          betterAuthUserId: "user_123",
          betterAuthEmail: "test@example.com",
          plan: "pro",
          region: "us",
        },
        billingAddress: {
          country: "US",
          postalCode: "94105",
        },
      },
    );
  });
});

describe("organization customer resolvers", () => {
  it("uses the organization id by default for customer key and subject", async () => {
    const options: OpenMeterOptions = {
      openmeterClient: {} as any,
      organization: { enabled: true },
    };

    await expect(
      resolveOrganizationCustomerKey(options, organization, user, ctx),
    ).resolves.toBe("org_123");
    await expect(
      resolveOrganizationSubject(options, organization, user, ctx),
    ).resolves.toBe("org_123");
    await expect(
      resolveOrganizationCustomerName(options, organization, user, ctx),
    ).resolves.toBe("Acme Inc");
    await expect(
      resolveOrganizationCustomerMetadata(options, organization, user, ctx),
    ).resolves.toMatchObject({
      betterAuthOrganizationId: "org_123",
      betterAuthOrganizationSlug: "acme",
    });
  });

  it("supports custom organization resolvers", async () => {
    const options: OpenMeterOptions = {
      openmeterClient: {} as any,
      organization: {
        enabled: true,
        resolveKey: ({ organization }) => `customer:${organization.id}`,
        resolveSubject: ({ organization }) => `subject:${organization.id}`,
        resolveName: ({ organization }) => organization.slug!,
        metadata: { tier: "business" },
      },
    };

    await expect(
      resolveOrganizationCustomerKey(options, organization, user, ctx),
    ).resolves.toBe("customer:org_123");
    await expect(
      resolveOrganizationSubject(options, organization, user, ctx),
    ).resolves.toBe("subject:org_123");
    await expect(
      resolveOrganizationCustomerName(options, organization, user, ctx),
    ).resolves.toBe("acme");
    await expect(
      resolveOrganizationCustomerMetadata(options, organization, user, ctx),
    ).resolves.toMatchObject({
      betterAuthOrganizationId: "org_123",
      betterAuthOrganizationSlug: "acme",
      tier: "business",
    });
  });
});

describe("normalizeUsageEvents", () => {
  it("normalizes a single event", () => {
    expect(normalizeUsageEvents({ type: "tokens", data: { tokens: 10 } })).toEqual(
      [
        {
          specversion: "1.0",
          type: "tokens",
          data: { tokens: 10 },
        },
      ],
    );
  });

  it("normalizes a wrapped event array", () => {
    const event: OpenMeterUsageEvent = { type: "api-call" };

    expect(normalizeUsageEvents({ events: [event] })).toHaveLength(1);
  });

  it("throws on missing type", () => {
    expect(() => normalizeUsageEvents({ data: {} } as any)).toThrow(
      OPENMETER_ERROR_CODES.INVALID_EVENT,
    );
  });

  it("merges custom organization customer profile fields over defaults", async () => {
    const options: OpenMeterOptions = {
      openmeterClient: {} as any,
      organization: {
        enabled: true,
        currency: "EUR",
        metadata: { tier: "business" },
        resolveProfile: ({ defaults, organization }) => ({
          name: `${defaults.name} (${organization.slug})`,
          description: "Organization customer",
          metadata: {
            profile: "configured",
          },
        }),
      },
    };

    await expect(
      resolveOrganizationCustomerProfile(options, organization, user, ctx),
    ).resolves.toMatchObject({
      name: "Acme Inc (acme)",
      description: "Organization customer",
      currency: "EUR",
      metadata: {
        betterAuthOrganizationId: "org_123",
        betterAuthOrganizationSlug: "acme",
        tier: "business",
        profile: "configured",
      },
    });
  });
});

describe("addDefaultSubject", () => {
  it("adds source and subject while preserving explicit fields", async () => {
    const events = await addDefaultSubject(
      [{ type: "tokens", subject: "custom-subject", source: "gateway" }],
      { openmeterClient: {} as any },
      user,
      ctx,
    );

    expect(events[0]).toMatchObject({
      type: "tokens",
      subject: "custom-subject",
      source: "gateway",
    });
  });
});

describe("authPathToEventType", () => {
  it("maps sign-up and sign-in paths", () => {
    expect(authPathToEventType("/sign-up/email")).toBe(
      "better-auth.user.signed-up",
    );
    expect(authPathToEventType("/sign-in/email")).toBe(
      "better-auth.user.signed-in",
    );
    expect(authPathToEventType("/session")).toBeNull();
  });
});

# better-auth-openmeter-plugin

OpenMeter usage metering and entitlement helpers for Better Auth.

## Install

```sh
npm install better-auth-openmeter-plugin @openmeter/sdk
```

## Server Setup

```ts
import { betterAuth } from "better-auth";
import { openmeterPlugin } from "better-auth-openmeter-plugin";

export const auth = betterAuth({
  plugins: [
    openmeterPlugin({
      apiKey: process.env.OPENMETER_API_KEY!,
      baseUrl: "https://openmeter.cloud",
      createCustomerOnSignUp: true,
      syncCustomerOnUserUpdate: true,
      trackAuthEvents: true,
      customer: {
        resolveKey: ({ user }) => user.id,
        resolveSubject: ({ user }) => user.id,
      },
    }),
  ],
});
```

You can also pass a preconfigured SDK client:

```ts
import { OpenMeter } from "@openmeter/sdk";
import { openmeterPlugin } from "better-auth-openmeter-plugin";

openmeterPlugin({
  openmeterClient: new OpenMeter({
    baseUrl: "http://127.0.0.1:8888",
  }),
});
```

## Client Setup

```ts
import { createAuthClient } from "better-auth/client";
import { openmeterClientPlugin } from "better-auth-openmeter-plugin/client";

export const authClient = createAuthClient({
  plugins: [openmeterClientPlugin()],
});
```

## What It Adds

- `openmeterCustomerId` on the Better Auth `user` schema
- optional `openmeterCustomerId` on the Better Auth `organization` schema
- optional OpenMeter customer creation after Better Auth user creation
- optional OpenMeter customer sync after Better Auth user updates
- optional OpenMeter customer creation/sync for Better Auth organizations
- optional auth lifecycle event ingestion
- authenticated endpoints for user and organization usage events, customers,
  access, and entitlements
- optional React Query hooks from `better-auth-openmeter-plugin/react`

Run your Better Auth migration/generation step after enabling the plugin so the
`openmeterCustomerId` field exists in your database.

## Organization Support

Organization support is optional. Enable it only when you also use Better Auth's
organization plugin.

```ts
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { openmeterPlugin } from "better-auth-openmeter-plugin";

export const auth = betterAuth({
  plugins: [
    organization(),
    openmeterPlugin({
      apiKey: process.env.OPENMETER_API_KEY!,
      organization: {
        enabled: true,
        allowedRoles: ["owner", "admin"],
        createCustomerOnOrganizationCreate: true,
        syncCustomerOnOrganizationUpdate: true,
        resolveKey: ({ organization }) => organization.id,
        resolveSubject: ({ organization }) => organization.id,
      },
    }),
  ],
});
```

When `organization.enabled` is true, the plugin checks that the Better Auth
organization plugin is installed. Organization endpoints require
`organizationId` and use Better Auth's organization-role middleware.

```ts
await authClient.openmeter.organization.events.ingest({
  organizationId: "org_123",
  type: "ai-tokens",
  data: { model: "gpt-4.1", tokens: 100 },
});

const access = await authClient.openmeter.organization.customer.access({
  query: { organizationId: "org_123" },
});
```

## Usage Events

OpenMeter ingests CloudEvents-style usage events. The plugin defaults missing
`source` to `better-auth` and missing `subject` to the resolved customer subject.

```ts
await authClient.openmeter.events.ingest({
  type: "ai-tokens",
  data: {
    model: "gpt-4.1",
    kind: "output",
    tokens: 850,
  },
});

await authClient.openmeter.events.ingest({
  events: [
    {
      type: "api-request",
      data: { route: "/v1/messages", duration_ms: 240 },
    },
    {
      type: "ai-tokens",
      data: { model: "gpt-4.1", tokens: 1200 },
    },
  ],
});
```

## Entitlements

The plugin uses OpenMeter's customer-scoped entitlement APIs.

```ts
const { data, error } = await authClient.openmeter.entitlement.value({
  query: {
    featureKey: "gpt_4_tokens",
  },
});

if (!error && data?.hasAccess) {
  // allow feature usage
}
```

## Adapters

The core plugin stays focused on OpenMeter customers, subjects, usage events,
and entitlements. Optional adapters integrate other Better Auth plugins without
coupling every provider into the core.

### API Key Adapter

Use the API key adapter with `@better-auth/api-key` to meter successful API key
verification calls.

```ts
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { openmeterPlugin } from "better-auth-openmeter-plugin";
import { openmeterApiKeyAdapter } from "better-auth-openmeter-plugin/adapters/api-key";

export const auth = betterAuth({
  plugins: [
    apiKey(),
    openmeterPlugin({
      apiKey: process.env.OPENMETER_API_KEY!,
    }),
    openmeterApiKeyAdapter({
      resolveSubject: ({ apiKey }) =>
        typeof apiKey.metadata?.openmeterSubject === "string"
          ? apiKey.metadata.openmeterSubject
          : apiKey.referenceId,
    }),
  ],
});
```

By default, the adapter listens to `/api-key/verify` and ingests
`better-auth.api-key.verified` with API key id, name, owner reference, remaining
count, rate-limit fields, permissions, and metadata.

### Billing Adapter

Payment gateways should integrate through one billing category instead of
duplicating OpenMeter entitlement logic per provider.

```ts
import {
  applyOpenMeterBillingEvent,
  openmeterBillingAdapter,
} from "better-auth-openmeter-plugin/adapters/billing";

openmeterBillingAdapter({
  mapPlanToEntitlements(event) {
    if (event.plan !== "pro") return [];

    return [
      {
        featureKey: "ai_tokens",
        type: "metered",
        amount: 100000,
      },
    ];
  },
});
```

Provider packages should translate gateway-specific callbacks or webhooks into
generic billing events:

```ts
await applyOpenMeterBillingEvent(
  {
    type: "subscription.active",
    provider: "stripe",
    customerIdOrKey: "cus_123",
    subject: "org_123",
    referenceId: "org_123",
    customerType: "organization",
    plan: "pro",
    subscriptionId: "sub_123",
  },
  ctx,
  billingOptions,
);
```

This is the intended path for Stripe, Razorpay, Polar, and custom billing
providers. Polar already has usage-metering features, so only bridge it when
OpenMeter is the source of truth for entitlements.

### Razorpay Billing Provider

The Razorpay provider is a callback bridge for
`better-auth-razorpay-plugin`. It does not add a hard dependency on Razorpay;
wire its callbacks into the Razorpay subscription callbacks you already pass.

```ts
import { betterAuth } from "better-auth";
import { openmeterPlugin } from "better-auth-openmeter-plugin";
import { openmeterBillingAdapter } from "better-auth-openmeter-plugin/adapters/billing";
import { razorpayBillingProvider } from "better-auth-openmeter-plugin/adapters/razorpay";
import { razorpayPlugin } from "better-auth-razorpay-plugin";

const razorpayProvider = razorpayBillingProvider({
  billing: {
    openmeterClient,
    mapPlanToEntitlements(event) {
      if (event.plan !== "pro") return [];

      return [
        {
          featureKey: "ai_tokens",
          type: "metered",
          amount: 100000,
        },
      ];
    },
  },
  resolveCustomerIdOrKey: ({ subscription }) => subscription.referenceId,
  resolveSubject: ({ subscription }) => subscription.referenceId,
});

export const auth = betterAuth({
  plugins: [
    openmeterPlugin({ openmeterClient }),
    openmeterBillingAdapter({ provider: razorpayProvider }),
    razorpayPlugin({
      // ...
      subscription: {
        enabled: true,
        plans: [{ name: "pro", planId: "plan_..." }],
        ...razorpayProvider.callbacks,
      },
    }),
  ],
});
```

The provider maps Razorpay callbacks to generic billing events:
`onSubscriptionActivated` becomes `subscription.active`, charged/renewed
callbacks become `invoice.paid`, cancellation becomes `subscription.canceled`,
and status changes become `subscription.updated`.

### Stripe Billing Provider

The Stripe provider is a callback bridge for `@better-auth/stripe`.

```ts
import { stripe } from "@better-auth/stripe";
import { openmeterBillingAdapter } from "better-auth-openmeter-plugin/adapters/billing";
import { stripeBillingProvider } from "better-auth-openmeter-plugin/adapters/stripe";

const stripeProvider = stripeBillingProvider({
  billing: {
    openmeterClient,
    mapPlanToEntitlements(event) {
      if (event.plan !== "pro") return [];
      return [{ featureKey: "ai_tokens", type: "metered", amount: 100000 }];
    },
  },
});

betterAuth({
  plugins: [
    openmeterPlugin({ openmeterClient }),
    openmeterBillingAdapter({ provider: stripeProvider }),
    stripe({
      stripeClient,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
      subscription: {
        enabled: true,
        plans: [{ name: "pro", priceId: "price_..." }],
        ...stripeProvider.callbacks,
      },
    }),
  ],
});
```

The provider maps `onSubscriptionComplete` to `subscription.active`,
`onSubscriptionCreated` to `subscription.created`, update/cancel/delete
callbacks to their equivalent generic billing events.

### Polar Billing Provider

The Polar provider bridges `@polar-sh/better-auth` webhook callbacks into
OpenMeter billing events. Use this only when OpenMeter is the source of truth
for usage and entitlements; Polar also has its own usage plugin.

```ts
import { polar, webhooks } from "@polar-sh/better-auth";
import { openmeterBillingAdapter } from "better-auth-openmeter-plugin/adapters/billing";
import { polarBillingProvider } from "better-auth-openmeter-plugin/adapters/polar";

const polarProvider = polarBillingProvider({
  billing: {
    openmeterClient,
    mapPlanToEntitlements(event) {
      if (event.plan !== "pro") return [];
      return [{ featureKey: "ai_tokens", type: "metered", amount: 100000 }];
    },
  },
});

betterAuth({
  plugins: [
    openmeterPlugin({ openmeterClient }),
    openmeterBillingAdapter({ provider: polarProvider }),
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        webhooks({
          secret: process.env.POLAR_WEBHOOK_SECRET!,
          ...polarProvider.callbacks,
        }),
      ],
    }),
  ],
});
```

The provider reads `referenceId` from Polar metadata when present. Provide
`resolveCustomerIdOrKey` if your Polar payloads use a different convention.

## React Query Helpers

```tsx
import {
  useIngestOpenMeterEvent,
  useOpenMeterEntitlementValue,
} from "better-auth-openmeter-plugin/react";

export function TokenButton({ authClient }: { authClient: any }) {
  const entitlement = useOpenMeterEntitlementValue(authClient, "gpt_4_tokens");
  const ingest = useIngestOpenMeterEvent(authClient);

  return (
    <button
      type="button"
      disabled={!entitlement.data?.hasAccess || ingest.isPending}
      onClick={() =>
        ingest.mutate({
          type: "ai-tokens",
          data: { model: "gpt-4.1", tokens: 100 },
        })
      }
    >
      Generate
    </button>
  );
}
```

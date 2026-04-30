# better-auth-openmeter-plugin

[![npm version](https://img.shields.io/npm/v/better-auth-openmeter-plugin.svg)](https://www.npmjs.com/package/better-auth-openmeter-plugin)
[![license](https://img.shields.io/npm/l/better-auth-openmeter-plugin.svg)](https://github.com/kaustubhkagrawal/better-auth-openmeter-plugin/blob/main/LICENSE)
[![types](https://img.shields.io/npm/types/better-auth-openmeter-plugin.svg)](https://www.npmjs.com/package/better-auth-openmeter-plugin)

Better Auth plugin for OpenMeter usage metering, entitlements, API key
tracking, organization customers, React hooks, and billing provider bridges for
Stripe, Polar, Razorpay, Creem, Dodo Payments, and Autumn.

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
        resolveProfile: ({ user, defaults }) => ({
          ...defaults,
          description: `Better Auth user ${user.id}`,
          billingAddress: {
            country: "US",
          },
          metadata: {
            ...defaults.metadata,
            source: "better-auth",
          },
        }),
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

## Customer Identity and Profile Sync

OpenMeter generates the canonical customer `id`. The plugin stores that value in
Better Auth as `openmeterCustomerId` after the first successful sync.

Use `resolveKey` to choose the stable OpenMeter customer key. It defaults to the
Better Auth user id, but you can return another deterministic value such as
`customer:${user.id}`. Use `resolveSubject` to choose the OpenMeter usage
subject. It defaults to the same value as `resolveKey`.

The plugin syncs these user customer fields by default:

- `name` from `user.name`, `user.email`, then `user.id`
- `primaryEmail` from `user.email`
- `usageAttribution.subjectKeys` from `resolveSubject`
- `metadata.betterAuthUserId` and `metadata.betterAuthEmail`
- optional `currency`

Use `customer.resolveProfile` to customize OpenMeter customer profile fields
such as `description`, `primaryEmail`, `billingAddress`, `currency`, and
`metadata`. Profile fields are merged over the defaults; identity still comes
from `resolveKey` and `resolveSubject`.

Common identity policies:

```ts
openmeterPlugin({
  openmeterClient,
  customer: {
    // Default: one OpenMeter customer per Better Auth user.
    resolveKey: ({ user }) => user.id,
    resolveSubject: ({ user }) => user.id,
  },
});

openmeterPlugin({
  openmeterClient,
  customer: {
    // Namespaced key when OpenMeter also receives customers from other systems.
    resolveKey: ({ user }) => `user:${user.id}`,
    resolveSubject: ({ user }) => `user:${user.id}`,
  },
});
```

Use the OpenMeter generated `id` only as the stored `openmeterCustomerId`.
Prefer a deterministic key for lookups and integration events so sync can be
replayed safely.

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
        resolveProfile: ({ organization, defaults }) => ({
          ...defaults,
          description: `Workspace ${organization.slug}`,
          metadata: {
            ...defaults.metadata,
            workspaceSlug: organization.slug,
          },
        }),
      },
    }),
  ],
});
```

When `organization.enabled` is true, the plugin checks that the Better Auth
organization plugin is installed. Organization endpoints require
`organizationId` and use Better Auth's organization-role middleware.
Organization customer sync defaults to `name`, `usageAttribution.subjectKeys`,
`metadata.betterAuthOrganizationId`, `metadata.betterAuthOrganizationSlug`, and
optional `currency`; use `organization.resolveProfile` for the rest of the
OpenMeter customer profile.

For organization-first billing, keep the same organization key everywhere:

```ts
openmeterPlugin({
  openmeterClient,
  organization: {
    enabled: true,
    resolveKey: ({ organization }) => `org:${organization.id}`,
    resolveSubject: ({ organization }) => `org:${organization.id}`,
  },
});
```

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

Billing providers should resolve `customerIdOrKey` to the same value your core
plugin returns from `customer.resolveKey` or `organization.resolveKey`. Gateway
customer IDs such as Stripe `cus_...` or Razorpay customer IDs are usually best
kept in event metadata unless you intentionally key OpenMeter customers by the
gateway customer ID.

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

### Creem Billing Provider

The Creem provider bridges the official `@creem_io/better-auth` webhook and
access-control callbacks into OpenMeter billing events. Use the event-specific
callbacks when you want a direct webhook mirror, or the high-level
`onGrantAccess` / `onRevokeAccess` callbacks when Creem should decide whether a
subscription currently grants access.

```ts
import { creem } from "@creem_io/better-auth";
import { openmeterBillingAdapter } from "better-auth-openmeter-plugin/adapters/billing";
import { creemBillingProvider } from "better-auth-openmeter-plugin/adapters/creem";

const creemProvider = creemBillingProvider({
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
    openmeterBillingAdapter({ provider: creemProvider }),
    creem({
      apiKey: process.env.CREEM_API_KEY!,
      webhookSecret: process.env.CREEM_WEBHOOK_SECRET!,
      persistSubscriptions: true,
      ...creemProvider.callbacks,
    }),
  ],
});
```

The provider reads `referenceId` from Creem metadata by default and maps
subscription callbacks to generic events such as `subscription.active`,
`invoice.paid`, `subscription.canceled`, and `subscription.expired`.

### Dodo Payments Billing Provider

The Dodo provider bridges `@dodopayments/better-auth` webhook callbacks into
OpenMeter billing events. Dodo's webhooks plugin can invoke both `onPayload` and
granular handlers for the same webhook, so the default spreadable `callbacks`
object intentionally contains only granular handlers. Use `dodoProvider.onPayload`
by itself if you prefer catch-all ingestion.

```ts
import { dodopayments, checkout, portal, webhooks } from "@dodopayments/better-auth";
import DodoPayments from "dodopayments";
import { openmeterBillingAdapter } from "better-auth-openmeter-plugin/adapters/billing";
import { dodoBillingProvider } from "better-auth-openmeter-plugin/adapters/dodo";

const dodoProvider = dodoBillingProvider({
  billing: {
    openmeterClient,
    mapPlanToEntitlements(event) {
      if (event.plan !== "pdt_pro") return [];
      return [{ featureKey: "ai_tokens", type: "metered", amount: 100000 }];
    },
  },
});

betterAuth({
  plugins: [
    openmeterPlugin({ openmeterClient }),
    openmeterBillingAdapter({ provider: dodoProvider }),
    dodopayments({
      client: new DodoPayments({ bearerToken: process.env.DODO_PAYMENTS_API_KEY! }),
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: [{ productId: "pdt_pro", slug: "pro" }],
          successUrl: "/dashboard",
          authenticatedUsersOnly: true,
        }),
        portal(),
        webhooks({
          webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_SECRET!,
          ...dodoProvider.callbacks,
        }),
      ],
    }),
  ],
});
```

The provider reads `referenceId` from webhook metadata by default and maps Dodo
payment/subscription callbacks to generic events such as `invoice.paid`,
`subscription.active`, `subscription.updated`, and `subscription.canceled`.

### Autumn Billing Provider

Autumn's Better Auth plugin is not webhook-driven. It resolves a customer,
then exposes billing, check, track, and portal endpoints through Better Auth.
The OpenMeter adapter therefore focuses on the stable integration points:
sharing the same user/organization customer identity and explicitly mirroring
Autumn billing state into OpenMeter after your attach/update flow confirms the
state you want OpenMeter to reflect.

```ts
import { autumn } from "autumn-js/better-auth";
import { organization } from "better-auth/plugins";
import { openmeterBillingAdapter } from "better-auth-openmeter-plugin/adapters/billing";
import { autumnBillingProvider } from "better-auth-openmeter-plugin/adapters/autumn";

const autumnProvider = autumnBillingProvider({
  customerScope: "organization",
  billing: {
    openmeterClient,
    mapPlanToEntitlements(event) {
      if (event.plan !== "pro") return [];
      return [{ featureKey: "ai_tokens", type: "metered", amount: 100000 }];
    },
  },
});

export const auth = betterAuth({
  plugins: [
    organization(),
    openmeterPlugin({
      openmeterClient,
      organization: { enabled: true },
    }),
    openmeterBillingAdapter({ provider: autumnProvider }),
    autumn({
      customerScope: "organization",
      identify: autumnProvider.identify,
    }),
  ],
});

// After an Autumn attach/update/check flow confirms the customer should have
// access, mirror that state into OpenMeter:
await autumnProvider.handleBillingState({
  type: "subscription.active",
  identity: { session, organization },
  productId: "pro",
  subscriptionId: "sub_...",
});
```

If Autumn is your entitlement source of truth, use this adapter only for shared
identity and audit events. If OpenMeter is the entitlement source of truth, call
`handleBillingState` at the point where your application has confirmed the
Autumn state to mirror.

## Migration and Backfill

After enabling the plugin, run your Better Auth migration/generation step so
`openmeterCustomerId` exists on `user` and, when organization support is enabled,
on `organization`.

New users and organizations can be created automatically with
`createCustomerOnSignUp` and `createCustomerOnOrganizationCreate`. Existing rows
need a one-time backfill. Use your application's server-side auth context or
database job to iterate users/organizations and call the sync endpoints with
authenticated headers for the relevant user:

```ts
for (const user of users) {
  await fetch(`${baseUrl}/api/auth/openmeter/customer/sync`, {
    method: "POST",
    headers: await authenticatedHeadersForUser(user.id),
  });
}

for (const organization of organizations) {
  await fetch(`${baseUrl}/api/auth/openmeter/organization/customer/sync`, {
    method: "POST",
    headers: {
      ...(await authenticatedHeadersForUser(organization.ownerId)),
      "content-type": "application/json",
    },
    body: JSON.stringify({ organizationId: organization.id }),
  });
}
```

Backfill is idempotent when `resolveKey` is deterministic: OpenMeter is looked
up by key, then created or updated, and the generated OpenMeter `id` is stored
back as `openmeterCustomerId`.

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

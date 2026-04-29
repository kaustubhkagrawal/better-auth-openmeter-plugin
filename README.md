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
- optional OpenMeter customer creation after Better Auth user creation
- optional OpenMeter customer sync after Better Auth user updates
- optional auth lifecycle event ingestion
- authenticated endpoints for usage events, current customer, access, and entitlements
- optional React Query hooks from `better-auth-openmeter-plugin/react`

Run your Better Auth migration/generation step after enabling the plugin so the
`openmeterCustomerId` field exists in your database.

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

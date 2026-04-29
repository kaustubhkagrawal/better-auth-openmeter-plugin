import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/client.ts",
    "src/react.ts",
    "src/adapters/index.ts",
    "src/adapters/api-key.ts",
    "src/adapters/billing.ts",
    "src/adapters/razorpay.ts",
    "src/adapters/stripe.ts",
    "src/adapters/polar.ts",
    "src/adapters/creem.ts",
    "src/adapters/dodo.ts",
    "src/adapters/autumn.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "better-auth",
    "better-auth/api",
    "better-auth/client",
    "react",
    "@tanstack/react-query",
  ],
});

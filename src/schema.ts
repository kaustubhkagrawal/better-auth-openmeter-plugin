import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";
import { mergeSchema } from "better-auth/db";
import type { OpenMeterOptions } from "./types";

export const user = {
  user: {
    fields: {
      openmeterCustomerId: {
        type: "string",
        required: false,
      },
    },
  },
} satisfies BetterAuthPluginDBSchema;

export const getSchema = <O extends OpenMeterOptions>(
  options: O,
): typeof user => {
  return mergeSchema(user, options.schema) as typeof user;
};

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

export const organization = {
  organization: {
    fields: {
      openmeterCustomerId: {
        type: "string",
        required: false,
      },
    },
  },
} satisfies BetterAuthPluginDBSchema;

type GetSchemaResult<O extends OpenMeterOptions> = typeof user &
  (O["organization"] extends { enabled: true } ? typeof organization : {});

export const getSchema = <O extends OpenMeterOptions>(
  options: O,
): GetSchemaResult<O> => {
  const baseSchema = options.organization?.enabled
    ? { ...user, ...organization }
    : user;

  return mergeSchema(baseSchema, options.schema) as GetSchemaResult<O>;
};

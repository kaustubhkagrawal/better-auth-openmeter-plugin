import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { OpenMeterUsageEvent } from "./types";

type OpenMeterAuthClient = {
  openmeter: {
    events: {
      ingest: (body: any) => Promise<any>;
    };
    customer: {
      sync: (body?: any) => Promise<any>;
      get: () => Promise<any>;
      access: () => Promise<any>;
    };
    entitlements: {
      list: () => Promise<any>;
    };
    entitlement: {
      value: (query: any) => Promise<any>;
    };
  };
};

export const openmeterQueryKeys = {
  all: ["openmeter"] as const,
  customer: () => [...openmeterQueryKeys.all, "customer"] as const,
  access: () => [...openmeterQueryKeys.customer(), "access"] as const,
  entitlements: () => [...openmeterQueryKeys.customer(), "entitlements"] as const,
  entitlementValue: (featureKey: string) =>
    [...openmeterQueryKeys.entitlements(), "value", featureKey] as const,
};

function unwrap<T>(result: { data?: T; error?: unknown } | T): T {
  if (
    result &&
    typeof result === "object" &&
    ("data" in result || "error" in result)
  ) {
    const value = result as { data?: T; error?: unknown };
    if (value.error) throw value.error;
    return value.data as T;
  }

  return result as T;
}

export function useOpenMeterCustomer<TData = unknown>(
  authClient: OpenMeterAuthClient,
  options?: {
    queryOptions?: Omit<UseQueryOptions<TData, Error>, "queryKey" | "queryFn">;
  },
) {
  return useQuery<TData, Error>({
    queryKey: openmeterQueryKeys.customer(),
    queryFn: async () => unwrap<TData>(await authClient.openmeter.customer.get()),
    ...options?.queryOptions,
  });
}

export function useOpenMeterCustomerAccess<TData = unknown>(
  authClient: OpenMeterAuthClient,
  options?: {
    queryOptions?: Omit<UseQueryOptions<TData, Error>, "queryKey" | "queryFn">;
  },
) {
  return useQuery<TData, Error>({
    queryKey: openmeterQueryKeys.access(),
    queryFn: async () =>
      unwrap<TData>(await authClient.openmeter.customer.access()),
    ...options?.queryOptions,
  });
}

export function useOpenMeterEntitlements<TData = unknown>(
  authClient: OpenMeterAuthClient,
  options?: {
    queryOptions?: Omit<UseQueryOptions<TData, Error>, "queryKey" | "queryFn">;
  },
) {
  return useQuery<TData, Error>({
    queryKey: openmeterQueryKeys.entitlements(),
    queryFn: async () =>
      unwrap<TData>(await authClient.openmeter.entitlements.list()),
    ...options?.queryOptions,
  });
}

export function useOpenMeterEntitlementValue<TData = unknown>(
  authClient: OpenMeterAuthClient,
  featureKey: string,
  options?: {
    queryOptions?: Omit<UseQueryOptions<TData, Error>, "queryKey" | "queryFn">;
  },
) {
  return useQuery<TData, Error>({
    queryKey: openmeterQueryKeys.entitlementValue(featureKey),
    queryFn: async () =>
      unwrap<TData>(
        await authClient.openmeter.entitlement.value({
          query: { featureKey },
        }),
      ),
    enabled: Boolean(featureKey),
    ...options?.queryOptions,
  });
}

export function useSyncOpenMeterCustomer<TData = unknown>(
  authClient: OpenMeterAuthClient,
  options?: UseMutationOptions<TData, Error, { metadata?: Record<string, unknown> }>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body) =>
      unwrap<TData>(await authClient.openmeter.customer.sync(body)),
    onSuccess: async (data, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({
        queryKey: openmeterQueryKeys.customer(),
      });
      await options?.onSuccess?.(data, variables, onMutateResult, context);
    },
    ...options,
  });
}

export function useIngestOpenMeterEvent<TData = { ok: true }>(
  authClient: OpenMeterAuthClient,
  options?: UseMutationOptions<
    TData,
    Error,
    OpenMeterUsageEvent | { events: OpenMeterUsageEvent[] }
  >,
) {
  return useMutation({
    mutationFn: async (body) =>
      unwrap<TData>(await authClient.openmeter.events.ingest(body)),
    ...options,
  });
}

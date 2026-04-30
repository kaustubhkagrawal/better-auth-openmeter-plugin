import type { BillingCatalog } from "./types";
import { assertValidBillingCatalog } from "./validate";

export function defineBillingCatalog<const TCatalog extends BillingCatalog>(
  catalog: TCatalog,
) {
  assertValidBillingCatalog(catalog);
  return catalog;
}

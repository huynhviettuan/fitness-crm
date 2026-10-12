import "server-only";
import { listContracts, listContractStaff } from "@/lib/api/contracts";
import { listPromotions } from "@/lib/api/promotions";
import { getService, listServices } from "@/lib/api/services";
import type { ServiceChoice } from "./contract-form";

/**
 * What the contract form offers for a customer of `branchId` (FR-CON-001): the services on sale there with their
 * quick-pick counts, the promotions on offer, the staff who can be named, and the customer's earlier contracts.
 */
export async function loadContractFormData(customerId: string, branchId: string) {
  const [onSale, promotions, staff, previous] = await Promise.all([
    listServices({ onSale: true, branchId }),
    listPromotions({ kind: "PROMOTION", onOffer: true }),
    listContractStaff(branchId),
    listContracts({ customerId, pageSize: 100 }),
  ]);
  const services: ServiceChoice[] = await Promise.all(
    onSale.map(async (service) => ({
      id: service.id,
      name: service.name,
      kind: service.kind,
      isGroup: service.isGroup,
      maxMembers: service.maxMembers,
      quickPackages: (await getService(service.id)).quickPackages,
    })),
  );
  return {
    services,
    promotions: promotions.map(({ id, name }) => ({ id, name })),
    staff,
    previousContracts: previous.items.map((contract) => ({
      id: contract.id,
      label: `${contract.contractCode} · ${contract.packageName}`,
    })),
  };
}

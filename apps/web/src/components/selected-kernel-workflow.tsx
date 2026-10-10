"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { KernelWorkflowRunner } from "@/components/kernel-workflow-runner";
import { runtimeCatalog } from "@/lib/runtime-catalog.generated";

type SelectedKernelWorkflowProps = {
  product: string;
  children: ReactNode;
};

/**
 * A selected network must use the Kernel boundary. The legacy product UI is
 * rendered only when a visitor opens the product directly, without a routed
 * workflow selection.
 */
export function SelectedKernelWorkflow({ product, children }: SelectedKernelWorkflowProps) {
  return (
    <Suspense fallback={<>{children}</>}>
      <SelectedKernelWorkflowInner product={product}>{children}</SelectedKernelWorkflowInner>
    </Suspense>
  );
}

function SelectedKernelWorkflowInner({ product, children }: SelectedKernelWorkflowProps) {
  const searchParams = useSearchParams();
  const capability = searchParams.get("action");
  const network = searchParams.get("network");

  if (!capability || !network) return <>{children}</>;

  return (
    <KernelWorkflowRunner
      product={product}
      capability={capability}
      network={network}
      networkLabel={runtimeCatalog.networks.find((entry) => entry.id === network)?.label ?? network}
    />
  );
}

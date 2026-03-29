import { Suspense, lazy } from "react";

import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "./DiffPanelShell";

const DiffPanel = lazy(() => import("./DiffPanel"));

function DiffLoadingFallback({ mode }: { mode: DiffPanelMode }) {
  return (
    <DiffPanelShell mode={mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
}

export function ThreadDiffWorkspace({ mode = "inline" }: { mode?: DiffPanelMode }) {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={mode} />}>
        <DiffPanel mode={mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
}

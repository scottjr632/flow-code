import type { ProjectDiagnostic } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceProblemsPanel } from "./WorkspaceEditorSurface";

const SAMPLE_DIAGNOSTIC: ProjectDiagnostic = {
  relativePath: "apps/web/src/components/WorkspaceEditorSurface.tsx",
  severity: "error",
  message: "Expected problems panel to collapse.",
  startLine: 12,
  startColumn: 4,
  endLine: 12,
  endColumn: 18,
};

describe("WorkspaceProblemsPanel", () => {
  it("renders the diagnostics list when expanded", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceProblemsPanel
        diagnostics={[SAMPLE_DIAGNOSTIC]}
        activeRelativePath={SAMPLE_DIAGNOSTIC.relativePath}
        open
        onToggleOpen={vi.fn()}
        onSelectDiagnostic={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Collapse problems panel");
    expect(markup).toContain("1 problem");
    expect(markup).toContain(SAMPLE_DIAGNOSTIC.relativePath);
    expect(markup).toContain(SAMPLE_DIAGNOSTIC.message);
    expect(markup).toContain("12:4");
  });

  it("hides the diagnostics list when collapsed", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceProblemsPanel
        diagnostics={[SAMPLE_DIAGNOSTIC]}
        activeRelativePath={null}
        open={false}
        onToggleOpen={vi.fn()}
        onSelectDiagnostic={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Expand problems panel");
    expect(markup).toContain("1 problem");
    expect(markup).not.toContain(SAMPLE_DIAGNOSTIC.message);
    expect(markup).not.toContain("12:4");
  });
});

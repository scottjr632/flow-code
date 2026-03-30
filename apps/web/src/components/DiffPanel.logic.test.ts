import { describe, expect, it } from "vitest";
import { TurnId } from "@t3tools/contracts";
import {
  expandCollapsedFileKey,
  resolveTurnChipLabel,
  toggleCollapsedFileKey,
} from "./DiffPanel.logic";
import type { TurnDiffSummary } from "../types";

function makeTurnDiffSummary(
  turnId: string,
  overrides?: Partial<TurnDiffSummary>,
): TurnDiffSummary {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    completedAt: "2026-03-29T12:00:00.000Z",
    files: [],
    ...overrides,
  };
}

describe("resolveTurnChipLabel", () => {
  it("returns Last turn for the latest turn chip", () => {
    const latestTurnId = TurnId.makeUnsafe("turn-2");

    expect(
      resolveTurnChipLabel(
        makeTurnDiffSummary("turn-2", { checkpointTurnCount: 2 }),
        latestTurnId,
        {},
      ),
    ).toBe("Last turn");
  });

  it("returns the numbered label for older turns", () => {
    expect(
      resolveTurnChipLabel(makeTurnDiffSummary("turn-1", { checkpointTurnCount: 1 }), null, {}),
    ).toBe("Turn 1");
  });

  it("falls back to inferred checkpoint counts", () => {
    const turnId = TurnId.makeUnsafe("turn-3");

    expect(
      resolveTurnChipLabel(makeTurnDiffSummary("turn-3"), null, {
        [turnId]: 3,
      }),
    ).toBe("Turn 3");
  });
});

describe("toggleCollapsedFileKey", () => {
  it("adds a file when it is expanded", () => {
    expect(toggleCollapsedFileKey(new Set<string>(), "src/app.tsx")).toEqual(
      new Set(["src/app.tsx"]),
    );
  });

  it("removes a file when it is already collapsed", () => {
    expect(toggleCollapsedFileKey(new Set(["src/app.tsx"]), "src/app.tsx")).toEqual(new Set());
  });
});

describe("expandCollapsedFileKey", () => {
  it("removes the matching file from the collapsed set", () => {
    expect(expandCollapsedFileKey(new Set(["src/a.ts", "src/b.ts"]), "src/a.ts")).toEqual(
      new Set(["src/b.ts"]),
    );
  });

  it("returns the same set when no expansion is needed", () => {
    const collapsedFileKeys = new Set(["src/a.ts"]);

    expect(expandCollapsedFileKey(collapsedFileKeys, "src/b.ts")).toBe(collapsedFileKeys);
    expect(expandCollapsedFileKey(collapsedFileKeys, null)).toBe(collapsedFileKeys);
  });
});

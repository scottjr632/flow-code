import { type TurnId } from "@t3tools/contracts";
import { memo } from "react";
import { type TurnDiffFileChange } from "../../types";
import { FileTree, toFileTreeEntries } from "../FileTree";

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const { files, allDirectoriesExpanded, onOpenTurnDiff, resolvedTheme, turnId } = props;
  return (
    <FileTree
      entries={toFileTreeEntries(files)}
      resolvedTheme={resolvedTheme}
      allDirectoriesExpanded={allDirectoriesExpanded}
      onSelectFile={(filePath) => onOpenTurnDiff(turnId, filePath)}
    />
  );
});

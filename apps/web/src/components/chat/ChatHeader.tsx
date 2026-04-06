import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { DiffIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  activeProjectIsHome: boolean;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  activeProjectIsHome,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden sm:gap-2">
        <SidebarTrigger className="size-6.5 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground sm:text-sm"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge
            variant="outline"
            className="min-w-0 shrink overflow-hidden border-border/65 bg-muted/12 px-2 py-0 font-medium text-[11px] text-muted-foreground shadow-none"
          >
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !activeProjectIsHome && !isGitRepo && (
          <Badge
            variant="outline"
            className="shrink-0 border-amber-600/30 bg-amber-500/6 px-1.5 py-0 text-[9px] uppercase tracking-[0.08em] text-amber-700 shadow-none"
          >
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5 @3xl/header-actions:gap-2">
        {activeProjectScripts && !activeProjectIsHome && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {activeProjectName && !activeProjectIsHome && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && !activeProjectIsHome && (
          <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal tab"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? activeProjectIsHome
                ? "Terminal is unavailable in Home."
                : "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal tab (${terminalToggleShortcutLabel})`
                : "Toggle terminal tab"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle review tab"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!activeProjectName
              ? "Review tab is unavailable until this thread has an active project."
              : activeProjectIsHome
                ? "Review tab is unavailable in Home."
                : !isGitRepo
                  ? "Review tab is unavailable because this project is not a git repository."
                  : diffToggleShortcutLabel
                    ? `Toggle review tab (${diffToggleShortcutLabel})`
                    : "Toggle review tab"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});

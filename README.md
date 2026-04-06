# Flow

Flow is a minimal web GUI for coding agents.

Flow is a fork of `t3code`, created to take the base app in a more experimental direction with Codex-first orchestration, workspace and work-item management, integrated terminals, and in-app review/editing surfaces.

Flow is experimental and moves quickly. Expect rough edges, behavior changes, and incomplete features.

## What Flow includes

- Server-side workspace and work-item persistence, including new projections/migrations and a dedicated work surface in the web app.
- Flow-specific work board integration for Codex, including the `flow_add_work_item` dynamic tool and orchestration updates that attach agent-created tasks to projects/workspaces.
- A workspace editor stack with project file APIs, in-app file opening, a code editor surface, and TypeScript LSP support.
- Project/workspace-scoped terminals in addition to thread terminals.
- Expanded review UX with a diff workspace, review file tree, collapsible diff files, inline diff comments, and pending diff-comment composer state.
- Workspace/session navigation changes such as workspace tabs, command palette work, cross-session references, terminal-log references, and additional keyboard shortcut handling.
- Project diagnostics and project metadata support, including project favicon/file helpers, system-project handling, and workspace ignore behavior.
- Fork-specific desktop/marketing/branding changes, including updated app assets, desktop launcher/menu behavior, and release/workflow tweaks.
- Removal of the upstream server telemetry/analytics module from this fork.

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for Flow to work.

Current CLI entrypoint:

```bash
npx t3
```

You can also just install the desktop app. It's cooler.

Install the [desktop app from the Releases page](https://github.com/scottjr632/flow-code/releases)

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

## Contributions

We are not accepting contributions at this time.

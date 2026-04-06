# Flow

Flow is a minimal web GUI for coding agents.

This repository is a fork of `t3code` with a different product focus and a growing set of Flow-specific features. Internally, you will still see `t3code` / `@t3tools` names in package metadata and parts of the codebase, but the product-facing name for this fork is Flow.

## Fork status

Flow started from `t3code` and keeps the same monorepo foundation, but this fork is intentionally evolving in a different direction.

Compared with upstream [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) `main`, this fork currently adds or changes:

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

Flow currently still uses the existing `t3` package/CLI entrypoint from the forked codebase:

```bash
npx t3
```

You can also just install the desktop app. It's cooler.

Install the [desktop app from this fork's Releases page](https://github.com/scottjr632/flow-code/releases)

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

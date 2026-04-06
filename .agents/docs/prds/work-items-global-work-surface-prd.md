# Work Items Global Work Surface PRD

## Problem Statement

Flow currently centers all durable work around chat threads. That works for active execution, but it is too narrow for lightweight task capture and tracking. A user cannot maintain a simple backlog of work that exists before a thread starts, continue tracking that work after a thread ends, or move work between `todo`, `in_progress`, and `done` without overloading thread lifecycle semantics.

The desired feature is a lightweight work-tracking surface inside Flow that supports both manual and agent-assisted task management. Users should be able to add a task manually, or ask an agent in chat to add a task to the board, while keeping the actual task model distinct from thread runtime state. Users should then be able to start work from a task by launching either a local thread or a workspace thread, and Flow should link the task to the spawned thread and move it into `in_progress` only after launch succeeds.

The feature must remain lightweight, predictable, and durable across reconnects, app restarts, and partial failures. It must fit Flow's existing project, workspace, and orchestration architecture rather than becoming an ad hoc client-only board.

## Solution

Add a first-class `work item` entity to Flow's orchestration domain and expose it through a new global `Work` surface in the web app. Work items are owned by a real non-home project, may optionally reference a workspace, may optionally reference a single linked thread, and carry an explicit status that is independent from thread/session lifecycle.

The `Work` surface lives at a global application route and presents the same project-owned work items in two views: a kanban board and a denser list view. The surface supports filtering to all projects or a single project, and it stores the selected view and project filter in the URL for restoration and sharing.

Users can create, edit, move, delete, and reorder work items from the UI. Agents can perform CRUD operations through a Flow-owned work-item tool surface, but that tool surface remains intentionally narrow and strict: it operates on exact IDs and explicit project references, with no fuzzy matching or hidden thread-launch side effects.

Launching work from an item remains a user-only Flow action. A user can start a local thread or a workspace thread from a work item. Flow remembers the most recently used launch mode per project, defaulting to `local` if there is no stored preference. After a thread is created successfully, Flow updates the work item to set the linked thread, set the status to `in_progress`, and persist any workspace context. If launch succeeds but item linking fails, Flow surfaces the split outcome clearly and provides a retry path for the item update.

The feature should be implemented in one pass, but the design must preserve clear internal boundaries so that orchestration, persistence, UI presentation, and agent tooling can be reasoned about independently.

## User Stories

1. As a Flow user, I want to create a work item manually, so that I can capture work before I am ready to open a thread.
2. As a Flow user, I want to open a global `Work` surface, so that I can manage tasks without navigating project by project in the thread sidebar.
3. As a Flow user, I want the global `Work` surface to show tasks across all projects, so that I can see my broader backlog in one place.
4. As a Flow user, I want to filter the `Work` surface to a single project, so that I can focus on one codebase at a time.
5. As a Flow user, I want to switch between board and list presentations, so that I can use either kanban-style management or denser scanning depending on the situation.
6. As a Flow user, I want a kanban board with `Todo`, `In Progress`, and `Done` columns, so that task movement is visually simple.
7. As a Flow user, I want a list view grouped by status, so that I can scan many tasks quickly without using the board.
8. As a Flow user, I want work items to belong to a real project, so that task ownership and launch context are explicit.
9. As a Flow user, I do not want work items owned by the `home` system project, so that `home` remains a control surface rather than a source of durable project work.
10. As a Flow user, I want agents in `home` chats to still manage work items for real projects, so that I can use a central planning chat without tying tasks to `home`.
11. As a Flow user, I want each work item to have a short title, so that cards and rows are easy to scan.
12. As a Flow user, I want each work item to optionally have notes, so that I can capture extra context without over-modeling metadata.
13. As a Flow user, I want each work item to optionally reference a workspace, so that tasks can carry worktree context before a thread starts.
14. As a Flow user, I want each work item to optionally reference a linked thread, so that I can jump from planning to execution.
15. As a Flow user, I want a work item to exist without a linked thread, so that backlog capture is natural.
16. As a Flow user, I want a work item to remain meaningful after a linked thread is archived or closed, so that execution lifecycle does not erase task tracking.
17. As a Flow user, I want work-item status to be explicit rather than derived from thread state, so that `done` means task completion, not merely session inactivity.
18. As a Flow user, I want a newly created work item to default to `todo`, so that backlog capture is frictionless.
19. As a Flow user, I want starting a thread from a work item to move it to `in_progress`, so that task progress changes when execution actually begins.
20. As a Flow user, I want a work item to remain linked to its thread even if I move it back to `todo` or forward to `done`, so that traceability is preserved.
21. As a Flow user, I want to move work items manually between `todo`, `in_progress`, and `done`, so that I stay in control of task state.
22. As a Flow user, I want drag-and-drop ordering within a status column, so that I can prioritize work visually.
23. As a Flow user, I want cross-column drag-and-drop to persist, so that moving a task changes both status and ordering reliably.
24. As a Flow user, I want list ordering to be stable and predictable, so that board and list views reflect the same underlying priorities.
25. As a Flow user, I want work-item order to persist across reconnects and restarts, so that the board does not reshuffle unexpectedly.
26. As a Flow user, I want the `Work` page URL to remember the chosen view and project filter, so that refreshes and direct links restore the same context.
27. As a Flow user, I want to start a local thread from a work item, so that I can begin work quickly without creating a worktree.
28. As a Flow user, I want to start a workspace thread from a work item, so that I can begin isolated branch-based work when needed.
29. As a Flow user, I want Flow to remember the last launch mode I used for each project, so that repeated launch behavior matches my working style.
30. As a Flow user, I want the default launch mode for a project with no prior preference to be `local`, so that the lightweight path is the default.
31. As a Flow user, I want an item that already carries a workspace reference to launch using that workspace context by default, so that worktree-based tasks preserve their intended environment.
32. As a Flow user, I want a linked thread indicator on a card or row, so that I can tell which work items already have execution context.
33. As a Flow user, I want to open the linked thread directly from a work item, so that switching from planning to execution is fast.
34. As a Flow user, I want the UI to clearly distinguish project ownership in the global view, so that cross-project tasks remain understandable.
35. As a Flow user, I want to create a work item from the UI without navigating into a thread first, so that the feature feels like a real planning surface.
36. As a Flow user, I want editing a work item to be lightweight, so that the feature remains closer to a board than a heavyweight issue tracker.
37. As a Flow user, I want deleting a work item to remove it from active views without hard-destroying history, so that accidental deletion remains recoverable at the data-model level.
38. As a Flow user, I want a split failure during thread launch and item linking to be explained clearly, so that I understand when a thread exists but the item update did not complete.
39. As a Flow user, I want a retry action when item linking fails after thread creation, so that recovery is direct and does not require manual data repair.
40. As a Flow user, I want work-item state to survive reconnects and session restarts, so that planning data is at least as durable as thread data.
41. As an agent user, I want to ask an agent to add a task to the board, so that I can capture work conversationally.
42. As an agent user, I want to ask an agent to move an item to `done`, so that conversational planning can update the same system as manual interactions.
43. As an agent user, I want agent CRUD to use strict IDs and explicit project references, so that mutations are reliable and do not silently affect the wrong task.
44. As an agent user, I want the agent to list or inspect work items before mutating them when needed, so that ambiguity is resolved in the conversation rather than guessed by the backend.
45. As an agent user, I want ambiguous requests from a `home` chat to require project resolution, so that work is never silently attached to the wrong project.
46. As a system maintainer, I want work items modeled in orchestration alongside projects, workspaces, and threads, so that persistence and synchronization behavior remain consistent.
47. As a system maintainer, I want work-item commands and events to be explicit and testable, so that domain invariants stay clear under load and during failures.
48. As a system maintainer, I want workspace references on work items validated against the owning project, so that cross-project corruption is prevented.
49. As a system maintainer, I want linked thread references validated, so that work items cannot point at unknown or deleted threads.
50. As a system maintainer, I want the work-item tool surface to remain CRUD-only in v1, so that thread-launch side effects do not leak into agent tooling prematurely.
51. As a system maintainer, I want the board and list views to be projections of the same underlying data, so that UI complexity does not create conflicting state models.
52. As a system maintainer, I want work-item ordering stored as simple persisted rank metadata, so that board interactions stay lightweight but durable.
53. As a system maintainer, I want the implementation to preserve deep module boundaries between domain, persistence, UI state, UI presentation, and tool exposure, so that the feature remains maintainable as Flow evolves.

## Implementation Decisions

- Add a first-class `work item` aggregate to the orchestration domain rather than extending `thread`.
- Keep work items project-owned. Each work item must belong to exactly one real non-home project.
- Allow `workspaceId` to be nullable, and validate that any provided workspace belongs to the same owning project.
- Allow `linkedThreadId` to be nullable, with v1 cardinality of zero or one linked thread per item.
- Keep work-item `status` explicit and independent from thread/session/archive state.
- Support exactly three statuses in v1: `todo`, `in_progress`, and `done`.
- Move a work item to `in_progress` automatically only after a user-initiated thread launch succeeds and the item update is dispatched.
- Preserve `linkedThreadId` when status changes later, including moves back to `todo` or forward to `done`.
- Model ordering with a persisted `rank` field scoped to the owning `projectId` and `status`.
- Support reorder within a status bucket and reassignment of rank when an item moves between status buckets.
- Treat delete as soft delete in the domain and projection model.
- Include work items directly in the orchestration read model rather than storing them in web-only state.
- Extend the projection persistence layer with dedicated projected work-item storage and indexing optimized for project, status, and rank queries.
- Expose a global `Work` route in the web app rather than mixing work items into the existing thread sidebar hierarchy.
- Keep work items project-owned even though the `Work` route is global. The global surface is an aggregate view over project-owned items.
- Store `view=board|list` and `projectId` selection in the `Work` route URL so the page is restorable and linkable.
- Exclude the `home` system project from work-item ownership.
- Allow agents operating in `home` chats to manage work items for real projects, but require explicit project selection for create operations.
- Keep work-item metadata intentionally narrow in v1: title, optional notes, optional workspace reference, optional linked thread reference, status, source, rank, timestamps, and soft-delete state.
- Include a lightweight `source` field for at least `manual` and `agent`.
- Exclude tags, priority, assignee, due date, custom fields, rich checklists, comments, and separate audit history UI from v1.
- Keep the agent-facing tool surface CRUD-only in v1.
- Require exact `itemId` for mutation operations other than create.
- Require explicit `projectId` for create, especially because the tool can be used from `home` chats where project context is not implicit.
- Do not implement fuzzy title matching or server-side ambiguity resolution for work-item mutations in v1.
- Resolve ambiguity in the agent conversation before tool mutation calls.
- Keep thread launch as a user-only Flow action rather than an agent tool in v1.
- Offer two launch paths from a work item: local thread and workspace thread.
- Remember the most recently used launch mode per project, defaulting to `local` when no preference exists.
- Use a non-atomic but predictable post-launch flow: create thread/workspace first, then update the work item with linked thread and status.
- If thread launch succeeds but item linking fails, surface the split outcome and offer an immediate retry for the item update.
- Do not auto-rollback a successfully created thread if item linking fails.
- Deliver the feature in one implementation pass, but preserve strong boundaries between domain, persistence, web-state mapping, presentation logic, launch integration, and agent tooling.
- Prefer deep modules with stable interfaces for:
  - work-item orchestration domain logic
  - projected work-item repository and query behavior
  - shared work-item UI state/selection logic
  - launch-from-item coordination
  - agent CRUD adapter logic

## Testing Decisions

- A good test should validate externally observable behavior and durable state transitions, not private implementation details.
- Domain tests should focus on command invariants, accepted transitions, rejected invalid references, and emitted event shapes.
- Projection tests should focus on read-model state after realistic event sequences, including create, update, move, reorder, delete, launch-link success, and partial-failure recovery paths.
- Web-state mapping tests should verify hydration of work items from the read model into the client store and consistency between board and list projections.
- UI logic tests should verify status grouping, ordering behavior, project filtering, URL state restoration, and launch-mode preference behavior.
- Interaction tests should verify that manual create/edit/move/delete/reorder flows mutate the expected observable state.
- Launch integration tests should verify that successful thread creation produces the subsequent item-link/status update and that failed item-link updates surface the correct recoverable split outcome.
- Agent tool tests should verify strict contract behavior, including rejection of ambiguous or invalid inputs and acceptance of explicit CRUD inputs.
- Similar prior art already exists in the codebase for orchestration decider tests, projector tests, projection-pipeline tests, store mapping tests, and focused UI logic tests; the work-item tests should follow the same style of validating behavior through public module interfaces and realistic event flows.
- The highest-priority modules to test are:
  - orchestration domain logic for work items
  - work-item projection behavior
  - web mapping and view-model logic for board/list rendering
  - launch-from-item coordination
  - agent CRUD contract validation

## Out of Scope

- Multiple linked threads per work item.
- Deriving work-item status from thread/session state.
- Work-item ownership by the `home` system project.
- Agent-driven thread launch or workspace creation from work items.
- Fuzzy mutation semantics such as “move the login thing” without prior item resolution.
- Bulk work-item operations.
- Tags, priority, assignee, due date, custom fields, or rich workflow configuration.
- Comments, user-facing audit history, or per-item activity feeds.
- Swimlanes, multiple boards per project, or advanced cross-project portfolio views beyond a global filterable page.
- Automatic rollback of created threads when post-launch item linking fails.
- Hidden or implicit project inference for work-item create commands issued from `home`.

## Further Notes

- The feature should feel lightweight in the UI even though it is modeled as a first-class orchestration entity. The user-facing experience should stay closer to a compact planning board than a heavyweight issue tracker.
- The one-pass delivery preference is acceptable, but the implementation should still proceed in a domain-first order so that UI, launch integration, and agent tooling all build on a stable core model.
- The board and list views should be treated as alternate presentations of the same data, not separate state containers.
- Reliability under reconnects, restarts, and partial failures is a core requirement; thread-launch side effects must not silently mutate task state before launch success is known.

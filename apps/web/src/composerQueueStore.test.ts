import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it, beforeEach } from "vitest";

import { selectQueuedComposerMessages, useComposerQueueStore } from "./composerQueueStore";

const THREAD_ID = ThreadId.makeUnsafe("thread-1");

describe("composerQueueStore", () => {
  beforeEach(() => {
    useComposerQueueStore.setState({
      queuedMessagesByThreadId: {},
    });
  });

  it("marks a queued message as failed and allows retrying it", () => {
    const store = useComposerQueueStore.getState();
    store.enqueueMessage(THREAD_ID, {
      id: "queue-1",
      threadId: THREAD_ID,
      createdAt: "2026-04-04T00:00:00.000Z",
      summary: "Queued message",
      text: "Queued message body",
      titleSeed: "Queued message",
      attachments: [],
      modelSelection: {
        provider: "codex",
        model: "gpt-5",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      status: "queued",
      error: null,
    });

    store.markQueuedMessageSending(THREAD_ID, "queue-1");
    store.markQueuedMessageFailed(THREAD_ID, "queue-1", "No provider session");

    expect(useComposerQueueStore.getState().queuedMessagesByThreadId[THREAD_ID]?.[0]).toMatchObject(
      {
        status: "failed",
        error: "No provider session",
      },
    );

    store.retryQueuedMessage(THREAD_ID, "queue-1");

    expect(useComposerQueueStore.getState().queuedMessagesByThreadId[THREAD_ID]?.[0]).toMatchObject(
      {
        status: "queued",
        error: null,
      },
    );
  });

  it("consumes a queued message without touching the rest of the queue", () => {
    const store = useComposerQueueStore.getState();
    for (const id of ["queue-1", "queue-2"]) {
      store.enqueueMessage(THREAD_ID, {
        id,
        threadId: THREAD_ID,
        createdAt: "2026-04-04T00:00:00.000Z",
        summary: id,
        text: id,
        titleSeed: id,
        attachments: [],
        modelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        status: "queued",
        error: null,
      });
    }

    store.consumeQueuedMessage(THREAD_ID, "queue-1");

    expect(useComposerQueueStore.getState().queuedMessagesByThreadId[THREAD_ID]).toMatchObject([
      {
        id: "queue-2",
      },
    ]);
  });

  it("returns a stable empty queue fallback for threads without queued messages", () => {
    const first = selectQueuedComposerMessages(useComposerQueueStore.getState(), THREAD_ID);
    const second = selectQueuedComposerMessages(useComposerQueueStore.getState(), THREAD_ID);

    expect(first).toBe(second);
    expect(first).toEqual([]);
  });
});

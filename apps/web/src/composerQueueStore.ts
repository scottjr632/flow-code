import {
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";

export interface QueuedComposerImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  previewUrl?: string;
}

export interface QueuedComposerMessage {
  id: string;
  threadId: ThreadId;
  createdAt: string;
  summary: string;
  text: string;
  titleSeed: string;
  attachments: QueuedComposerImageAttachment[];
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  status: "queued" | "sending" | "failed";
  error: string | null;
}

interface ComposerQueueStoreState {
  queuedMessagesByThreadId: Record<ThreadId, QueuedComposerMessage[]>;
  enqueueMessage: (threadId: ThreadId, message: QueuedComposerMessage) => void;
  markQueuedMessageSending: (threadId: ThreadId, messageId: string) => void;
  markQueuedMessageFailed: (threadId: ThreadId, messageId: string, error: string) => void;
  retryQueuedMessage: (threadId: ThreadId, messageId: string) => void;
  removeQueuedMessage: (threadId: ThreadId, messageId: string) => void;
  consumeQueuedMessage: (threadId: ThreadId, messageId: string) => void;
  clearThreadQueue: (threadId: ThreadId) => void;
}

const EMPTY_QUEUED_COMPOSER_MESSAGES: readonly QueuedComposerMessage[] = [];

function revokePreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

function revokeMessagePreviewUrls(message: QueuedComposerMessage): void {
  for (const attachment of message.attachments) {
    revokePreviewUrl(attachment.previewUrl);
  }
}

function removeQueuedMessageFromThread(
  queuedMessagesByThreadId: Record<ThreadId, QueuedComposerMessage[]>,
  threadId: ThreadId,
  messageId: string,
): Record<ThreadId, QueuedComposerMessage[]> {
  const existing = queuedMessagesByThreadId[threadId];
  if (!existing) {
    return queuedMessagesByThreadId;
  }
  const nextMessages = existing.filter((message) => message.id !== messageId);
  if (nextMessages.length === existing.length) {
    return queuedMessagesByThreadId;
  }
  if (nextMessages.length === 0) {
    const nextQueuedMessagesByThreadId = { ...queuedMessagesByThreadId };
    delete nextQueuedMessagesByThreadId[threadId];
    return nextQueuedMessagesByThreadId;
  }
  return {
    ...queuedMessagesByThreadId,
    [threadId]: nextMessages,
  };
}

export const useComposerQueueStore = create<ComposerQueueStoreState>((set) => ({
  queuedMessagesByThreadId: {},
  enqueueMessage: (threadId, message) => {
    if (threadId.length === 0) {
      return;
    }
    set((state) => ({
      queuedMessagesByThreadId: {
        ...state.queuedMessagesByThreadId,
        [threadId]: [...(state.queuedMessagesByThreadId[threadId] ?? []), message],
      },
    }));
  },
  markQueuedMessageSending: (threadId, messageId) => {
    if (threadId.length === 0 || messageId.length === 0) {
      return;
    }
    set((state) => {
      const existing = state.queuedMessagesByThreadId[threadId];
      if (!existing) {
        return state;
      }
      const messageIndex = existing.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) {
        return state;
      }
      const targetMessage = existing[messageIndex];
      if (!targetMessage || (targetMessage.status === "sending" && targetMessage.error === null)) {
        return state;
      }
      const nextMessages = [...existing];
      nextMessages[messageIndex] = {
        ...targetMessage,
        status: "sending",
        error: null,
      };
      return {
        queuedMessagesByThreadId: {
          ...state.queuedMessagesByThreadId,
          [threadId]: nextMessages,
        },
      };
    });
  },
  markQueuedMessageFailed: (threadId, messageId, error) => {
    if (threadId.length === 0 || messageId.length === 0) {
      return;
    }
    set((state) => {
      const existing = state.queuedMessagesByThreadId[threadId];
      if (!existing) {
        return state;
      }
      const messageIndex = existing.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) {
        return state;
      }
      const targetMessage = existing[messageIndex];
      if (!targetMessage) {
        return state;
      }
      const nextMessages = [...existing];
      nextMessages[messageIndex] = {
        ...targetMessage,
        status: "failed",
        error,
      };
      return {
        queuedMessagesByThreadId: {
          ...state.queuedMessagesByThreadId,
          [threadId]: nextMessages,
        },
      };
    });
  },
  retryQueuedMessage: (threadId, messageId) => {
    if (threadId.length === 0 || messageId.length === 0) {
      return;
    }
    set((state) => {
      const existing = state.queuedMessagesByThreadId[threadId];
      if (!existing) {
        return state;
      }
      const messageIndex = existing.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) {
        return state;
      }
      const targetMessage = existing[messageIndex];
      if (!targetMessage) {
        return state;
      }
      const nextMessages = [...existing];
      nextMessages[messageIndex] = {
        ...targetMessage,
        status: "queued",
        error: null,
      };
      return {
        queuedMessagesByThreadId: {
          ...state.queuedMessagesByThreadId,
          [threadId]: nextMessages,
        },
      };
    });
  },
  removeQueuedMessage: (threadId, messageId) => {
    if (threadId.length === 0 || messageId.length === 0) {
      return;
    }
    set((state) => {
      const existing = state.queuedMessagesByThreadId[threadId];
      const removedMessage = existing?.find((message) => message.id === messageId);
      if (!removedMessage) {
        return state;
      }
      revokeMessagePreviewUrls(removedMessage);
      return {
        queuedMessagesByThreadId: removeQueuedMessageFromThread(
          state.queuedMessagesByThreadId,
          threadId,
          messageId,
        ),
      };
    });
  },
  consumeQueuedMessage: (threadId, messageId) => {
    if (threadId.length === 0 || messageId.length === 0) {
      return;
    }
    set((state) => ({
      queuedMessagesByThreadId: removeQueuedMessageFromThread(
        state.queuedMessagesByThreadId,
        threadId,
        messageId,
      ),
    }));
  },
  clearThreadQueue: (threadId) => {
    if (threadId.length === 0) {
      return;
    }
    set((state) => {
      const existing = state.queuedMessagesByThreadId[threadId];
      if (!existing) {
        return state;
      }
      for (const message of existing) {
        revokeMessagePreviewUrls(message);
      }
      const nextQueuedMessagesByThreadId = { ...state.queuedMessagesByThreadId };
      delete nextQueuedMessagesByThreadId[threadId];
      return {
        queuedMessagesByThreadId: nextQueuedMessagesByThreadId,
      };
    });
  },
}));

export function selectQueuedComposerMessages(
  state: Pick<ComposerQueueStoreState, "queuedMessagesByThreadId">,
  threadId: ThreadId,
): readonly QueuedComposerMessage[] {
  return state.queuedMessagesByThreadId[threadId] ?? EMPTY_QUEUED_COMPOSER_MESSAGES;
}

export function useComposerQueuedMessages(
  threadId: ThreadId,
): ReadonlyArray<QueuedComposerMessage> {
  return useComposerQueueStore((state) => selectQueuedComposerMessages(state, threadId));
}

export const THREAD_KEYBOARD_TRAVERSAL_MRU_LIMIT = 5;

export function reconcileThreadTraversalMruIds<T>(
  threadMruIds: readonly T[] | undefined,
  fallbackThreadIds: readonly T[],
): T[] {
  const nextThreadIds: T[] = [];

  for (const threadId of threadMruIds ?? []) {
    if (!fallbackThreadIds.includes(threadId) || nextThreadIds.includes(threadId)) {
      continue;
    }
    nextThreadIds.push(threadId);
    if (nextThreadIds.length >= THREAD_KEYBOARD_TRAVERSAL_MRU_LIMIT) {
      return nextThreadIds;
    }
  }

  for (const threadId of fallbackThreadIds) {
    if (nextThreadIds.includes(threadId)) {
      continue;
    }
    nextThreadIds.push(threadId);
    if (nextThreadIds.length >= THREAD_KEYBOARD_TRAVERSAL_MRU_LIMIT) {
      break;
    }
  }

  return nextThreadIds;
}

export function recordThreadTraversalDeparture<T>(
  threadMruIds: readonly T[] | undefined,
  fromThreadId: T,
  toThreadId: T,
): T[] {
  const nextThreadIds = (threadMruIds ?? []).filter(
    (threadId) => threadId !== fromThreadId && threadId !== toThreadId,
  );
  nextThreadIds.unshift(fromThreadId);
  return nextThreadIds.slice(0, THREAD_KEYBOARD_TRAVERSAL_MRU_LIMIT);
}

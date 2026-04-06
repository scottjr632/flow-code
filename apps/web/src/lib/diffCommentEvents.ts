export const CANCEL_ACTIVE_DIFF_COMMENT_EVENT = "flow:cancel_active_diff_comment";

export function requestCancelActiveDiffComment(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const event = new CustomEvent(CANCEL_ACTIVE_DIFF_COMMENT_EVENT, {
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

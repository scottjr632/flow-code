import { useEffect, useEffectEvent } from "react";

interface UseWindowKeydownListenerOptions {
  enabled?: boolean;
}

export function useWindowKeydownListener(
  handler: (event: KeyboardEvent) => void,
  options?: UseWindowKeydownListenerOptions,
) {
  const onKeyDown = useEffectEvent(handler);
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const listener = (event: KeyboardEvent) => {
      onKeyDown(event);
    };

    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [enabled]);
}

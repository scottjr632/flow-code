import * as Schema from "effect/Schema";
import * as Record from "effect/Record";
import { useCallback, useEffect, useRef, useState } from "react";

const isomorphicLocalStorage: Storage =
  typeof window !== "undefined"
    ? window.localStorage
    : (function () {
        const store = new Map<string, string>();
        return {
          clear: () => store.clear(),
          getItem: (_) => store.get(_) ?? null,
          key: (_) => Record.keys(store).at(_) ?? null,
          get length() {
            return store.size;
          },
          removeItem: (_) => store.delete(_),
          setItem: (_, value) => store.set(_, value),
        };
      })();

const decode = <T, E>(schema: Schema.Codec<T, E>, value: string) =>
  Schema.decodeSync(Schema.fromJsonString(schema))(value);

const encode = <T, E>(schema: Schema.Codec<T, E>, value: T) =>
  Schema.encodeSync(Schema.fromJsonString(schema))(value);

export const getLocalStorageItem = <T, E>(key: string, schema: Schema.Codec<T, E>): T | null => {
  const item = isomorphicLocalStorage.getItem(key);
  return item ? decode(schema, item) : null;
};

export const setLocalStorageItem = <T, E>(key: string, value: T, schema: Schema.Codec<T, E>) => {
  const valueToSet = encode(schema, value);
  isomorphicLocalStorage.setItem(key, valueToSet);
};

export const removeLocalStorageItem = (key: string) => {
  isomorphicLocalStorage.removeItem(key);
};

const LOCAL_STORAGE_CHANGE_EVENT = "flow:local_storage_change";

interface LocalStorageChangeDetail {
  key: string;
}

function dispatchLocalStorageChange(key: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LocalStorageChangeDetail>(LOCAL_STORAGE_CHANGE_EVENT, {
      detail: { key },
    }),
  );
}

export function useLocalStorage<T, E>(
  key: string,
  initialValue: T,
  schema: Schema.Codec<T, E>,
): [T, (value: T | ((val: T) => T)) => void] {
  // Get the initial value from localStorage or use the provided initialValue
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = getLocalStorageItem(key, schema);
      return item ?? initialValue;
    } catch (error) {
      console.error("[LOCALSTORAGE] Error:", error);
      return initialValue;
    }
  });
  const storedValueRef = useRef(storedValue);
  const initialValueRef = useRef(initialValue);
  const serializedValueRef = useRef<string | null>(
    storedValue === null ? null : encode(schema, storedValue),
  );

  // Return a wrapped version of useState's setter function that persists the new value to localStorage
  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        const previousValue = storedValueRef.current;
        const valueToStore =
          typeof value === "function" ? (value as (val: T) => T)(previousValue) : value;
        if (Object.is(previousValue, valueToStore)) {
          return;
        }
        storedValueRef.current = valueToStore;
        const serializedValue = valueToStore === null ? null : encode(schema, valueToStore);
        serializedValueRef.current = serializedValue;

        if (valueToStore === null) {
          removeLocalStorageItem(key);
        } else {
          isomorphicLocalStorage.setItem(key, serializedValue as string);
        }

        setStoredValue(valueToStore);
        queueMicrotask(() => dispatchLocalStorageChange(key));
      } catch (error) {
        console.error("[LOCALSTORAGE] Error:", error);
      }
    },
    [key, schema],
  );

  const prevKeyRef = useRef(key);

  useEffect(() => {
    storedValueRef.current = storedValue;
  }, [storedValue]);

  useEffect(() => {
    initialValueRef.current = initialValue;
  }, [initialValue]);

  // Re-sync from localStorage when key changes
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      try {
        const rawValue = isomorphicLocalStorage.getItem(key);
        const resolvedValue =
          rawValue === null ? initialValueRef.current : decode(schema, rawValue);
        storedValueRef.current = resolvedValue;
        serializedValueRef.current = rawValue;
        setStoredValue(resolvedValue);
      } catch (error) {
        console.error("[LOCALSTORAGE] Error:", error);
      }
    }
  }, [key, schema]);

  // Listen for storage events from other tabs AND custom events from the same tab
  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const rawValue = isomorphicLocalStorage.getItem(key);
        if (serializedValueRef.current === rawValue) {
          return;
        }
        const resolvedValue =
          rawValue === null ? initialValueRef.current : decode(schema, rawValue);
        storedValueRef.current = resolvedValue;
        serializedValueRef.current = rawValue;
        setStoredValue(resolvedValue);
      } catch (error) {
        console.error("[LOCALSTORAGE] Error:", error);
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key) {
        syncFromStorage();
      }
    };

    const handleLocalChange = (event: CustomEvent<LocalStorageChangeDetail>) => {
      if (event.detail.key === key) {
        syncFromStorage();
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);
    };
  }, [key, schema]);

  return [storedValue, setValue];
}

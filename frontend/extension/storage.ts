import { useCallback, useRef, useState } from "react";
export * from "pe-mantine-hooks";
const values = new Map<string, unknown>();
type StorageRuntime = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (data: Record<string, unknown>) => Promise<void>;
};
function extensionStorage() {
  return (globalThis as unknown as { chrome?: { storage?: { local?: StorageRuntime } } }).chrome?.storage?.local;
}
export async function initializeStorage(prompt: string) {
  try {
    const stored = await extensionStorage()?.get("pe.workspace-state");
    const data = stored?.["pe.workspace-state"];
    if (data && typeof data === "object") for (const [key, value] of Object.entries(data)) values.set(key, value);
  } catch {
    /* In-memory preferences remain available. */
  }
  values.set("pe.refine.draft", prompt);
}
export function readLocalStorageValue<T>({
  key,
  defaultValue,
}: {
  key: string;
  defaultValue?: T;
  [key: string]: unknown;
}): T {
  return (values.has(key) ? values.get(key) : defaultValue) as T;
}
export function useLocalStorage<T>({ key, defaultValue }: { key: string; defaultValue: T; [key: string]: unknown }) {
  const [value, setValue] = useState<T>(() => readLocalStorageValue({ key, defaultValue }));
  const valueRef = useRef(value);
  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      const previous = valueRef.current;
      const value = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
      valueRef.current = value;
      values.set(key, value);
      extensionStorage()
        ?.set({ "pe.workspace-state": Object.fromEntries(values) })
        .catch(() => {});
      setValue(value);
    },
    [key],
  );
  const remove = useCallback(() => {
    values.delete(key);
    valueRef.current = defaultValue;
    setValue(defaultValue);
    extensionStorage()
      ?.set({ "pe.workspace-state": Object.fromEntries(values) })
      .catch(() => {});
  }, [key, defaultValue]);
  return [value, update, remove] as const;
}

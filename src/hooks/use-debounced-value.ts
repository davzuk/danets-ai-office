"use client";

import { useDebounce } from "@reactuses/core";

/**
 * Debounce a value by a fixed delay. The returned value updates only
 * after the input has been stable for `delay` ms.
 *
 * Thin wrapper around `@reactuses/core`'s `useDebounce` so call sites
 * read like the more familiar lodash signature and the dependency is
 * introduced in one place (easy to swap out if we ever migrate off
 * `@reactuses/core`).
 *
 * Used for: search inputs, chat-send debouncing, copy-feedback timers.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  return useDebounce(value, delay);
}

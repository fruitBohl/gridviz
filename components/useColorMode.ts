import { useSyncExternalStore } from "react";
import type { ColorMode } from "@/lib/nem";

const DARK = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DARK);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useColorMode(): ColorMode {
  return useSyncExternalStore(
    subscribe,
    () => (window.matchMedia(DARK).matches ? "dark" : "light"),
    () => "light",
  );
}

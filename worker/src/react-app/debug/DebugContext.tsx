import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAdmin } from "../AdminContext";
import { DEBUG_FEATURES } from "./fixtures/index";

const STORAGE_KEY = "rcla_debug";

type Overrides = Record<string, string>; // feature key → fixture name

type DebugContextValue = {
  /** Returns mock data for a feature if an override is active, else null. */
  getOverride<T>(key: string): T | null;
  /** Set or clear (null) a named fixture for a feature. */
  setOverride(key: string, fixtureName: string | null): void;
  /** Currently active override names, keyed by feature. */
  overrides: Overrides;
};

const DebugContext = createContext<DebugContextValue>({
  getOverride: () => null,
  setOverride: () => {},
  overrides: {},
});

function readStorage(): Overrides {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeStorage(overrides: Overrides) {
  if (Object.keys(overrides).length === 0) {
    sessionStorage.removeItem(STORAGE_KEY);
  } else {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }
}

export function DebugProvider({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAdmin();
  const [overrides, setOverrides] = useState<Overrides>({});

  // Load from sessionStorage once admin status is known
  useEffect(() => {
    if (isAdmin) setOverrides(readStorage());
  }, [isAdmin]);

  const setOverride = useCallback(
    (key: string, fixtureName: string | null) => {
      if (!isAdmin) return;
      setOverrides((prev) => {
        const next = { ...prev };
        if (fixtureName === null) {
          delete next[key];
        } else {
          next[key] = fixtureName;
        }
        writeStorage(next);
        return next;
      });
    },
    [isAdmin],
  );

  const getOverride = useCallback(
    <T,>(key: string): T | null => {
      if (!isAdmin) return null;
      const fixtureName = overrides[key];
      if (!fixtureName) return null;
      const feature = DEBUG_FEATURES[key];
      if (!feature) return null;
      return (feature.options[fixtureName]?.data as T) ?? null;
    },
    [isAdmin, overrides],
  );

  return (
    <DebugContext.Provider value={{ getOverride, setOverride, overrides }}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug() {
  return useContext(DebugContext);
}

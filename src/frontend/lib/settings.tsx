import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { AppSettings } from "@shared/types";

interface SettingsCtxValue {
  settings: AppSettings | null;
  reload: () => Promise<void>;
}

const SettingsCtx = createContext<SettingsCtxValue>({ settings: null, reload: async () => {} });

const FALLBACK: AppSettings = {
  class_name: "加载中…",
  initial_score: 10,
  lottery_cost: 3,
  lottery_min_score: 3,
  preset_add: [],
  preset_deduct: [],
  webhook: {
    enabled: false,
    url: "",
    secret: "",
    events: { student: true, score: true, lottery: true, undo: true, settings: true, auth: true, system: true },
  },
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/system/settings");
      if (r.ok) setSettings((await r.json()) as AppSettings);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <SettingsCtx.Provider value={{ settings, reload }}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): AppSettings {
  return useContext(SettingsCtx).settings ?? FALLBACK;
}

export function useSettingsReload(): () => Promise<void> {
  return useContext(SettingsCtx).reload;
}

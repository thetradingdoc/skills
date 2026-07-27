export type FeatureFlag =
  | "icons_v2"
  | "three_d_enhancements"
  | "annotations"
  | "perf_hud"
  | "presence"
  | "ux_review_mode";

const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
  icons_v2: true,
  three_d_enhancements: true,
  annotations: true,
  perf_hud: false,
  presence: true,
  ux_review_mode: false,
};

export function isFlagEnabled(flag: FeatureFlag): boolean {
  if (typeof window === "undefined") return DEFAULT_FLAGS[flag];
  const raw = window.localStorage.getItem("arch_flags");
  if (!raw) return DEFAULT_FLAGS[flag];
  try {
    const parsed = JSON.parse(raw) as Partial<Record<FeatureFlag, boolean>>;
    return parsed[flag] ?? DEFAULT_FLAGS[flag];
  } catch {
    return DEFAULT_FLAGS[flag];
  }
}


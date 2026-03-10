import { LAYER_ORDER } from "../architecture/layerModel";

const LAYER_INDEX = new Map<string, number>(LAYER_ORDER.map((l, i) => [l, i]));

/** Logical breaks: add extra gap after these named layers. */
const BREAK_AFTER = new Set<string>([
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "Configuration",
]);
const BASE_SPACING = 3.2;
const BREAK_GAP = 0.6;

/**
 * Y elevation for a layer. index × 3.2 with extra gap at logical breaks.
 * Unknown layers default to the top (index 0) rather than being pushed to the bottom.
 */
export function layerIndexToY(layer: string): number {
  const idx = LAYER_INDEX.get(layer) ?? 0;
  let y = 0;
  for (let i = 0; i < idx; i++) {
    y += BASE_SPACING;
    if (BREAK_AFTER.has(LAYER_ORDER[i])) y += BREAK_GAP;
  }
  return y;
}

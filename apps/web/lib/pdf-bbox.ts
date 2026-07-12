export type BBoxNorm = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function bboxFromSourceMeta(
  meta: Record<string, unknown> | null | undefined
): BBoxNorm | null {
  if (!meta) return null;
  const norm = meta.bbox_norm;
  if (
    norm &&
    typeof norm === "object" &&
    "x" in norm &&
    "y" in norm &&
    "w" in norm &&
    "h" in norm
  ) {
    const n = norm as Record<string, unknown>;
    return {
      x: Number(n.x),
      y: Number(n.y),
      w: Number(n.w),
      h: Number(n.h),
    };
  }
  return null;
}

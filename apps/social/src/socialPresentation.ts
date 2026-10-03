export const appearanceScales = [0.9, 1, 1.15, 1.3] as const;
export type AppearanceScale = typeof appearanceScales[number];
export function checkedAppearanceScale(value: unknown): AppearanceScale {
  return appearanceScales.find(scale => String(scale) === String(value)) ?? 1;
}
export function socialLayout(width: number) {
  return { desktop: Number.isFinite(width) && width >= 900 };
}
export function messageDayBoundary(current: string, previous?: string): boolean {
  const date = new Date(current);
  if (!Number.isFinite(date.getTime())) return false;
  if (!previous) return true;
  const earlier = new Date(previous);
  return date.toDateString() !== earlier.toDateString();
}

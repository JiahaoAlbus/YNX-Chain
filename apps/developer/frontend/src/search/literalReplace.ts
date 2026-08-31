export type LiteralReplacementPlan = {
  files: Record<string, string>;
  changedPaths: string[];
  matches: number;
};

function literalPattern(query: string, matchCase: boolean) {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
}

export function buildLiteralReplacement(
  files: Record<string, string>,
  query: string,
  replacement: string,
  matchCase: boolean,
): LiteralReplacementPlan {
  if (!query) return { files, changedPaths: [], matches: 0 };
  const next: Record<string, string> = {},
    changedPaths: string[] = [];
  let matches = 0;
  for (const [path, content] of Object.entries(files)) {
    const count = [...content.matchAll(literalPattern(query, matchCase))].length;
    matches += count;
    if (count) changedPaths.push(path);
    next[path] = count ? content.replace(literalPattern(query, matchCase), () => replacement) : content;
  }
  return { files: next, changedPaths, matches };
}

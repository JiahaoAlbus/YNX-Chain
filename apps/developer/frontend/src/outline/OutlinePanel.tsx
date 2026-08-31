import { Braces, CircleDotDashed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { languageRequest } from "../runtime/client";

type OutlineItem = {
  name: string;
  detail: string;
  kind: number;
  line: number;
  column: number;
  depth: number;
};

type Props = {
  projectId: string;
  runtimeId?: string;
  files: Record<string, string>;
  activePath: string;
  language: string;
  onNavigate: (path: string, line: number, column: number) => void;
};

const symbolKinds = [
  "File", "Module", "Namespace", "Package", "Class", "Method", "Property",
  "Field", "Constructor", "Enum", "Interface", "Function", "Variable",
  "Constant", "String", "Number", "Boolean", "Array", "Object", "Key",
  "Null", "Enum member", "Struct", "Event", "Operator", "Type parameter",
];

function serverLanguage(language: string) {
  if (language === "javascript" || language === "typescript") return "typescript";
  if (["cpp", "python", "go", "rust", "java", "solidity"].includes(language))
    return language as "cpp" | "python" | "go" | "rust" | "java" | "solidity";
  return null;
}

function flattenSymbols(value: unknown, depth = 0, output: OutlineItem[] = []): OutlineItem[] {
  if (!Array.isArray(value) || output.length >= 500) return output;
  for (const item of value) {
    if (!item || typeof item !== "object" || output.length >= 500) continue;
    const symbol = item as Record<string, any>,
      range = symbol.selectionRange || symbol.range || symbol.location?.range,
      line = Number(range?.start?.line),
      column = Number(range?.start?.character);
    if (typeof symbol.name === "string" && Number.isInteger(line) && Number.isInteger(column))
      output.push({
        name: symbol.name.slice(0, 240),
        detail: typeof symbol.detail === "string" ? symbol.detail.slice(0, 240) : typeof symbol.containerName === "string" ? symbol.containerName.slice(0, 240) : "",
        kind: Number.isInteger(symbol.kind) ? symbol.kind : 1,
        line: line + 1,
        column: column + 1,
        depth: Math.min(depth, 12),
      });
    if (Array.isArray(symbol.children)) flattenSymbols(symbol.children, depth + 1, output);
  }
  return output;
}

export function OutlinePanel({ projectId, runtimeId, files, activePath, language, onNavigate }: Props) {
  const content = files[activePath] || "",
    targetLanguage = serverLanguage(language),
    [result, setResult] = useState<{ path: string; content: string; items: OutlineItem[]; error?: string }>();
  useEffect(() => {
    let cancelled = false;
    setResult(undefined);
    if (!activePath || !targetLanguage) return () => { cancelled = true; };
    const timer = setTimeout(() => {
      languageRequest(targetLanguage, files, activePath, "documentSymbols", undefined, undefined, { projectId, runtimeId })
        .then((value) => {
          if (!cancelled) setResult({ path: activePath, content, items: flattenSymbols(value.result) });
        })
        .catch((error) => {
          if (!cancelled) setResult({ path: activePath, content, items: [], error: error instanceof Error ? error.message : "Language server unavailable." });
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activePath, content, files, projectId, runtimeId, targetLanguage]);
  const items = useMemo(
    () => result?.path === activePath && result.content === content ? result.items : [],
    [activePath, content, result],
  );
  return (
    <section className="outline-panel" aria-label="Document outline">
      <header><strong>OUTLINE</strong><span>{items.length}</span></header>
      {!activePath ? <p>No active file.</p> : !targetLanguage ? <p>Outline requires a configured language server for this file.</p> : !result ? <p><CircleDotDashed size={13} /> Loading symbols from the language server…</p> : result.error ? <p>{result.error}</p> : items.length ? (
        <div className="outline-list" role="tree" aria-label={`Symbols in ${activePath}`}>
          {items.map((item, index) => (
            <button
              type="button"
              role="treeitem"
              aria-level={item.depth + 1}
              key={`${item.line}:${item.column}:${item.name}:${index}`}
              style={{ paddingInlineStart: `${8 + item.depth * 14}px` }}
              onClick={() => onNavigate(activePath, item.line, item.column)}
              title={`${symbolKinds[item.kind - 1] || "Symbol"} · ${activePath}:${item.line}:${item.column}`}
            >
              <Braces size={12} />
              <span><strong>{item.name}</strong>{item.detail && <small>{item.detail}</small>}</span>
              <em>{symbolKinds[item.kind - 1] || "Symbol"}</em>
            </button>
          ))}
        </div>
      ) : <p>No document symbols were returned for the current content.</p>}
    </section>
  );
}

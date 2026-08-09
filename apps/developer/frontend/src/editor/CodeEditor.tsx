import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "../../../node_modules/monaco-editor/esm/vs/editor/editor.api.js";
import "../../../node_modules/monaco-editor/esm/vs/basic-languages/monaco.contribution.js";
import "../../../node_modules/monaco-editor/esm/vs/language/css/monaco.contribution.js";
import "../../../node_modules/monaco-editor/esm/vs/language/html/monaco.contribution.js";
import "../../../node_modules/monaco-editor/esm/vs/language/json/monaco.contribution.js";
import "../../../node_modules/monaco-editor/esm/vs/language/typescript/monaco.contribution.js";
import EditorWorker from "../workers/editor.worker?worker";
import JsonWorker from "../workers/json.worker?worker";
import CssWorker from "../workers/css.worker?worker";
import HtmlWorker from "../workers/html.worker?worker";
import TsWorker from "../workers/typescript.worker?worker";
import { useEffect, useRef } from "react";
import { cppLanguageRequest, languageRequest } from "../runtime/client";
import type { InstalledExtension } from "../runtime/client";

self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less")
      return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor")
      return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

type Props = {
  files: Record<string, string>;
  activePath: string;
  activeContent: string;
  language: string;
  theme: "light" | "dark";
  extensions: InstalledExtension[];
  extensionTheme?: string;
  onChange: (value: string | undefined) => void;
  breakpoints: number[];
  debugLine?: number;
  onToggleBreakpoint: (line: number) => void;
  splitPath?: string;
  splitContent?: string;
  splitLanguage?: string;
  onSplitChange?: (value: string | undefined) => void;
  diffBase?: string;
};
export default function CodeEditor({
  files,
  activePath,
  activeContent,
  language,
  theme,
  extensions,
  extensionTheme,
  onChange,
  breakpoints,
  debugLine,
  onToggleBreakpoint,
  splitPath,
  splitContent,
  splitLanguage,
  onSplitChange,
  diffBase,
}: Props) {
  const selectedTheme = extensions
      .flatMap((extension) =>
        extension.manifest.contributes.themes.map((value) => ({
          extension,
          value,
        })),
      )
      .find(
        ({ extension, value }) =>
          `${extension.id}/${value.id}` === extensionTheme,
      ),
    editorTheme = selectedTheme
      ? `ynx-extension-${selectedTheme.extension.id}-${selectedTheme.value.id}`
      : theme === "dark"
        ? "vs-dark"
        : "vs",
    editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null),
    decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(
      null,
    );
  useEffect(() => {
    const provider = monaco.languages.registerCompletionItemProvider("cpp", {
      triggerCharacters: [".", ">", ":"],
      provideCompletionItems: async (model, position) => {
        const path = decodeURIComponent(model.uri.path).replace(/^\//, "");
        if (!Object.hasOwn(files, path)) return { suggestions: [] };
        try {
          const value = await cppLanguageRequest(files, path, "completion", {
              line: position.lineNumber - 1,
              character: position.column - 1,
            }),
            items = Array.isArray(value.result)
              ? value.result
              : value.result?.items || [];
          return {
            suggestions: items.slice(0, 200).map((item: any) => ({
              label: String(item.label).trim(),
              kind: Math.max(0, Math.min(27, Number(item.kind || 1) - 1)),
              insertText:
                item.textEdit?.newText ||
                item.insertText ||
                String(item.label).trim(),
              detail: item.detail,
              documentation:
                typeof item.documentation === "string"
                  ? item.documentation
                  : item.documentation?.value,
              sortText: item.sortText,
              filterText: item.filterText,
              range: item.textEdit?.range
                ? {
                    startLineNumber: item.textEdit.range.start.line + 1,
                    startColumn: item.textEdit.range.start.character + 1,
                    endLineNumber: item.textEdit.range.end.line + 1,
                    endColumn: item.textEdit.range.end.character + 1,
                  }
                : undefined,
            })),
          };
        } catch {
          return { suggestions: [] };
        }
      },
    });
    return () => provider.dispose();
  }, [files]);
  useEffect(() => {
    const disposables: monaco.IDisposable[] = [];
    for (const extension of extensions) {
      for (const language of extension.manifest.contributes.languages) {
        if (
          !monaco.languages
            .getLanguages()
            .some((item) => item.id === language.id)
        )
          monaco.languages.register({
            id: language.id,
            extensions: language.extensions,
            aliases: language.aliases,
          });
      }
      const snippets = extension.manifest.contributes.snippets;
      for (const language of new Set(snippets.map((item) => item.language))) {
        disposables.push(
          monaco.languages.registerCompletionItemProvider(language, {
            provideCompletionItems: (model, position) => {
              const word = model.getWordUntilPosition(position),
                range = {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endColumn: word.endColumn,
                };
              return {
                suggestions: snippets
                  .filter((item) => item.language === language)
                  .map((item) => ({
                    label: item.label,
                    detail: `${extension.manifest.displayName} · ${item.description}`,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: item.body.join("\n"),
                    insertTextRules:
                      monaco.languages.CompletionItemInsertTextRule
                        .InsertAsSnippet,
                    range,
                  })),
              };
            },
          }),
        );
      }
    }
    return () => disposables.forEach((disposable) => disposable.dispose());
  }, [extensions]);
  useEffect(() => {
    for (const extension of extensions)
      for (const custom of extension.manifest.contributes.themes)
        monaco.editor.defineTheme(
          `ynx-extension-${extension.id}-${custom.id}`,
          {
            base: custom.type === "dark" ? "vs-dark" : "vs",
            inherit: true,
            rules: [],
            colors: {
              "editor.background":
                custom.colors.editor || custom.colors.background,
              "editor.foreground": custom.colors.text,
              "editorLineNumber.foreground": custom.colors.muted,
              "editor.selectionBackground": custom.colors.accent,
            },
          },
        );
  }, [extensions]);
  useEffect(() => {
    const serverLanguage=language==="cpp"?"cpp":language==="typescript"||language==="javascript"?"typescript":language==="python"?"python":language==="go"?"go":language==="rust"?"rust":null;
    if (!serverLanguage || !activePath) return;
    const timer = setTimeout(() => {
      languageRequest(serverLanguage,files, activePath, "diagnostics")
        .then((value) => {
          const model = monaco.editor.getModel(
            monaco.Uri.parse(`file:///${activePath}`),
          );
          if (!model) return;
          monaco.editor.setModelMarkers(
            model,
            serverLanguage==="cpp"?"clangd":serverLanguage==="python"?"pyright":serverLanguage==="go"?"gopls":serverLanguage==="rust"?"rust-analyzer":"typescript-language-server",
            (value.result || []).map((diagnostic: any) => ({
              startLineNumber: diagnostic.range.start.line + 1,
              startColumn: diagnostic.range.start.character + 1,
              endLineNumber: diagnostic.range.end.line + 1,
              endColumn: diagnostic.range.end.character + 1,
              message: diagnostic.message,
              severity:
                diagnostic.severity === 1
                  ? monaco.MarkerSeverity.Error
                  : diagnostic.severity === 2
                    ? monaco.MarkerSeverity.Warning
                    : monaco.MarkerSeverity.Info,
              source: diagnostic.source || "clangd",
              code: String(diagnostic.code ?? ""),
            })),
          );
        })
        .catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [activePath, files, language]);
  useEffect(() => {
    decorations.current?.set([
      ...breakpoints.map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: "ynx-breakpoint",
          glyphMarginHoverMessage: {
            value: `Breakpoint ${activePath}:${line}`,
          },
        },
      })),
      ...(debugLine
        ? [
            {
              range: new monaco.Range(debugLine, 1, debugLine, 1),
              options: {
                isWholeLine: true,
                className: "ynx-debug-line",
                glyphMarginClassName: "ynx-debug-arrow",
              },
            },
          ]
        : []),
    ]);
  }, [activePath, breakpoints, debugLine]);
  if (diffBase !== undefined)
    return (
      <DiffEditor
        original={diffBase}
        modified={activeContent}
        language={language}
        theme={editorTheme}
        options={{ automaticLayout: true, readOnly: false }}
      />
    );
  return (
    <>
      <Editor
        path={`file:///${activePath}`}
        value={activeContent}
        language={language}
        theme={editorTheme}
        onChange={onChange}
        onMount={(editor) => {
          editorRef.current = editor;
          decorations.current = editor.createDecorationsCollection();
          editor.onMouseDown((event) => {
            if (
              event.target.type ===
                monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
              event.target.position
            )
              onToggleBreakpoint(event.target.position.lineNumber);
          });
        }}
        options={{
          automaticLayout: true,
          fontSize: 13,
          lineHeight: 20,
          minimap: { enabled: true },
          stickyScroll: { enabled: true },
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          quickSuggestions: { other: true, comments: false, strings: true },
          tabCompletion: "on",
          formatOnPaste: true,
          formatOnType: true,
          glyphMargin: true,
          padding: { top: 8 },
          scrollBeyondLastLine: false,
        }}
      />
      {splitPath && (
        <Editor
          path={`file:///${splitPath}`}
          value={splitContent}
          language={splitLanguage}
          theme={editorTheme}
          onChange={onSplitChange}
          options={{
            automaticLayout: true,
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
          }}
        />
      )}
    </>
  );
}

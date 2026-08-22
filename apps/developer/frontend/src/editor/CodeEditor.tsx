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
import { languageRequest } from "../runtime/client";
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
  projectId: string;
  runtimeId?: string;
  files: Record<string, string>;
  activePath: string;
  activeContent: string;
  language: string;
  theme: "light" | "dark";
  extensions: InstalledExtension[];
  extensionTheme?: string;
  onChange: (value: string | undefined) => void;
  onCursorChange?: (path: string, anchor: number, head: number) => void;
  readOnly?: boolean;
  breakpoints: number[];
  debugLine?: number;
  onToggleBreakpoint: (line: number) => void;
  splitPath?: string;
  splitContent?: string;
  splitLanguage?: string;
  onSplitChange?: (value: string | undefined) => void;
  diffBase?: string;
  fontSize: number;
  minimap: boolean;
  wordWrap: "off" | "on";
  onDiagnostics?: (path: string, content: string, problems: EditorProblem[]) => void;
  revealLocation?: { path: string; line: number; column: number; nonce: number };
};
export type EditorProblem = {
  message: string;
  severity: "error" | "warning" | "info";
  line: number;
  column: number;
  source: string;
  code: string;
};
export default function CodeEditor({
  projectId,
  runtimeId,
  files,
  activePath,
  activeContent,
  language,
  theme,
  extensions,
  extensionTheme,
  onChange,
  onCursorChange,
  readOnly = false,
  breakpoints,
  debugLine,
  onToggleBreakpoint,
  splitPath,
  splitContent,
  splitLanguage,
  onSplitChange,
  diffBase,
  fontSize,
  minimap,
  wordWrap,
  onDiagnostics,
  revealLocation,
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
    activePathRef = useRef(activePath),
    cursorCallbackRef = useRef(onCursorChange),
    diagnosticsCallbackRef = useRef(onDiagnostics),
    decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(
      null,
    );
  activePathRef.current = activePath;
  cursorCallbackRef.current = onCursorChange;
  diagnosticsCallbackRef.current = onDiagnostics;
  useEffect(() => {
    const disposables: monaco.IDisposable[] = [], context={projectId,runtimeId};
    for(const editorLanguage of ["cpp","typescript","javascript","python","go","rust","java","solidity"]){
      const serverLanguage=editorLanguage==="javascript"?"typescript":editorLanguage as "cpp"|"typescript"|"python"|"go"|"rust"|"java"|"solidity";
      disposables.push(monaco.languages.registerCompletionItemProvider(editorLanguage,{triggerCharacters:[".",">",":","/"],provideCompletionItems:async(model,position)=>{const path=modelPath(model.uri,files);if(!path)return{suggestions:[]};try{const value=await languageRequest(serverLanguage,files,path,"completion",lspPosition(position),undefined,context),items=Array.isArray(value.result)?value.result:value.result?.items||[];return{suggestions:items.slice(0,200).map((item:any)=>completionItem(item,position))}}catch{return{suggestions:[]}}}}));
      disposables.push(monaco.languages.registerDefinitionProvider(editorLanguage,{provideDefinition:async(model,position)=>{const path=modelPath(model.uri,files);if(!path)return[];try{return locations((await languageRequest(serverLanguage,files,path,"definition",lspPosition(position),undefined,context)).result,files)}catch{return[]}}}));
      disposables.push(monaco.languages.registerReferenceProvider(editorLanguage,{provideReferences:async(model,position)=>{const path=modelPath(model.uri,files);if(!path)return[];try{return locations((await languageRequest(serverLanguage,files,path,"references",lspPosition(position),undefined,context)).result,files)}catch{return[]}}}));
      disposables.push(monaco.languages.registerRenameProvider(editorLanguage,{provideRenameEdits:async(model,position,newName)=>{const path=modelPath(model.uri,files);if(!path)return{edits:[]};try{return workspaceEdit((await languageRequest(serverLanguage,files,path,"rename",lspPosition(position),newName,context)).result,files)}catch(error){return{edits:[],rejectReason:error instanceof Error?error.message:"Rename failed."}}}}));
      disposables.push(monaco.languages.registerDocumentFormattingEditProvider(editorLanguage,{provideDocumentFormattingEdits:async model=>{const path=modelPath(model.uri,files);if(!path)return[];try{return textEdits((await languageRequest(serverLanguage,files,path,"format",undefined,undefined,context)).result)}catch{return[]}}}));
    }
    return()=>disposables.forEach(value=>value.dispose());
  },[files,projectId,runtimeId]);
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
    const serverLanguage=language==="cpp"?"cpp":language==="typescript"||language==="javascript"?"typescript":language==="python"?"python":language==="go"?"go":language==="rust"?"rust":language==="java"?"java":language==="solidity"?"solidity":null;
    if (!serverLanguage || !activePath) {
      if (activePath) diagnosticsCallbackRef.current?.(activePath, files[activePath] || "", []);
      return;
    }
    const timer = setTimeout(() => {
      languageRequest(serverLanguage,files, activePath, "diagnostics",undefined,undefined,{projectId,runtimeId})
        .then((value) => {
          const model = monaco.editor.getModel(
            monaco.Uri.parse(`file:///${activePath}`),
          );
          if (!model) return;
          const markers: monaco.editor.IMarkerData[] = (value.result || []).map((diagnostic: any) => ({
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
            source: diagnostic.source || "language-server",
            code: String(diagnostic.code ?? ""),
          }));
          monaco.editor.setModelMarkers(
            model,
            serverLanguage==="cpp"?"clangd":serverLanguage==="python"?"pyright":serverLanguage==="go"?"gopls":serverLanguage==="rust"?"rust-analyzer":serverLanguage==="solidity"?"solidity-language-server":"typescript-language-server",
            markers,
          );
          diagnosticsCallbackRef.current?.(
            activePath,
            files[activePath] || "",
            markers.map((marker) => ({
              message: marker.message,
              severity: marker.severity === monaco.MarkerSeverity.Error ? "error" : marker.severity === monaco.MarkerSeverity.Warning ? "warning" : "info",
              line: marker.startLineNumber,
              column: marker.startColumn,
              source: marker.source || "language-server",
              code: typeof marker.code === "string" ? marker.code : marker.code?.value || "",
            })),
          );
        })
        .catch(() => diagnosticsCallbackRef.current?.(activePath, files[activePath] || "", []));
    }, 700);
    return () => clearTimeout(timer);
  }, [activePath, files, language, projectId, runtimeId]);
  useEffect(() => {
    if (!revealLocation || revealLocation.path !== activePath) return;
    const timer = setTimeout(() => {
      const editor = editorRef.current,
        model = editor?.getModel();
      if (!editor || !model) return;
      const lineNumber = Math.max(1, Math.min(model.getLineCount(), revealLocation.line)),
        column = Math.max(1, Math.min(model.getLineMaxColumn(lineNumber), revealLocation.column));
      editor.setPosition({ lineNumber, column });
      editor.revealPositionInCenter({ lineNumber, column });
      editor.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [activePath, revealLocation]);
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
        options={{ automaticLayout: true, readOnly }}
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
          editor.onDidChangeCursorSelection((event) => {
            const model = editor.getModel();
            if (!model) return;
            cursorCallbackRef.current?.(
              activePathRef.current,
              model.getOffsetAt(event.selection.getStartPosition()),
              model.getOffsetAt(event.selection.getEndPosition()),
            );
          });
        }}
        options={{
          automaticLayout: true,
          readOnly,
          fontSize,
          lineHeight: Math.round(fontSize * 1.55),
          minimap: { enabled: minimap },
          wordWrap,
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
            readOnly,
            fontSize,
            minimap: { enabled: false },
            wordWrap,
            scrollBeyondLastLine: false,
          }}
        />
      )}
    </>
  );
}

function lspPosition(value:monaco.Position){return{line:value.lineNumber-1,character:value.column-1}}
function lspRange(value:any):monaco.IRange{return{startLineNumber:Number(value?.start?.line||0)+1,startColumn:Number(value?.start?.character||0)+1,endLineNumber:Number(value?.end?.line||0)+1,endColumn:Number(value?.end?.character||0)+1}}
function modelPath(uri:monaco.Uri,files:Record<string,string>){const decoded=decodeURIComponent(uri.path).replace(/^\//,"");return Object.hasOwn(files,decoded)?decoded:Object.keys(files).find(path=>decoded.endsWith(`/${path}`))}
function resource(uri:string,files:Record<string,string>){try{const decoded=decodeURIComponent(new URL(uri).pathname);const path=Object.keys(files).find(value=>decoded.endsWith(`/${value}`));return path?monaco.Uri.parse(`file:///${path}`):undefined}catch{return undefined}}
function locations(value:any,files:Record<string,string>):monaco.languages.Location[]{const list=Array.isArray(value)?value:value?[value]:[];return list.map(item=>{const uri=item.uri||item.targetUri,range=item.range||item.targetSelectionRange||item.targetRange,target=resource(uri,files);return target&&range?{uri:target,range:lspRange(range)}:null}).filter(Boolean) as monaco.languages.Location[]}
function textEdits(value:any):monaco.languages.TextEdit[]{return(Array.isArray(value)?value:[]).filter(item=>item?.range&&typeof item.newText==="string").map(item=>({range:lspRange(item.range),text:item.newText}))}
function workspaceEdit(value:any,files:Record<string,string>):monaco.languages.WorkspaceEdit{const edits:monaco.languages.IWorkspaceTextEdit[]=[];for(const[uri,items]of Object.entries(value?.changes||{})){const target=resource(uri,files);if(target)for(const item of items as any[])edits.push({resource:target,textEdit:{range:lspRange(item.range),text:item.newText},versionId:undefined})}for(const change of value?.documentChanges||[]){const target=resource(change?.textDocument?.uri,files);if(target)for(const item of change?.edits||[])edits.push({resource:target,textEdit:{range:lspRange(item.range),text:item.newText},versionId:undefined})}return{edits}}
function completionItem(item:any,position:monaco.Position):monaco.languages.CompletionItem{return{label:String(item.label).trim(),kind:Math.max(0,Math.min(27,Number(item.kind||1)-1)),insertText:item.textEdit?.newText||item.insertText||String(item.label).trim(),detail:item.detail,documentation:typeof item.documentation==="string"?item.documentation:item.documentation?.value,sortText:item.sortText,filterText:item.filterText,range:item.textEdit?.range?lspRange(item.textEdit.range):new monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column)}}

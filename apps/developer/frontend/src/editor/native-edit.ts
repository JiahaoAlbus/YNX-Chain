import type { editor as MonacoEditor } from "monaco-editor";

export type DesktopEditCommand = "selectAll" | "undo" | "redo" | "cut" | "copy" | "paste";
export type DesktopEditRoute = "handled" | "native" | "blocked";
type EditorTarget = { editor: MonacoEditor.ICodeEditor; readOnly: () => boolean };
const targets = new Set<EditorTarget>();
const commands = new Set<string>(["selectAll", "undo", "redo", "cut", "copy", "paste"]);
const changesContent = new Set<string>(["undo", "redo", "cut", "paste"]);

declare global {
  interface Window {
    __ynxDesktopEdit?: (command: DesktopEditCommand) => DesktopEditRoute;
  }
}

// Register every actual code editor, including split panes and both diff sides.
// Monaco owns the models, selections, undo stacks and clipboard event handlers.
export function registerDesktopEditor(editor: MonacoEditor.ICodeEditor, readOnly: () => boolean) {
  const target = { editor, readOnly };
  targets.add(target);
  const subscription = editor.onDidDispose(() => { targets.delete(target); subscription.dispose(); });
  return () => { targets.delete(target); subscription.dispose(); };
}

export function createDesktopEditRouter(document: Document, editors: () => Iterable<EditorTarget>) {
  return (command: DesktopEditCommand): DesktopEditRoute => {
    if (!commands.has(command)) return "blocked";
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) return "blocked";
    const focused = [...editors()].filter(({ editor }) => {
      const root = editor.getDomNode();
      // Opening a native menu can blur the window while retaining the same DOM
      // textarea. Never substitute a remembered editor when another input owns focus.
      return root?.isConnected && root.contains(active) &&
        (editor.hasTextFocus() || active.matches("textarea.inputarea"));
    });
    if (focused.length > 1) return "blocked";
    if (focused.length === 1) {
      const target = focused[0];
      if (!target.editor.getModel() || changesContent.has(command) && target.readOnly()) return "blocked";
      if (["cut", "copy", "paste"].includes(command)) {
        // The host forwards exactly one real WebKit responder action. Monaco's
        // existing clipboard event handlers obtain full-model/multicursor data;
        // JS neither reads NSPasteboard nor reconstructs clipboard contents.
        return "native";
      }
      target.editor.focus();
      target.editor.trigger("keyboard", command === "selectAll" ? "editor.action.selectAll" : command, null);
      return "handled";
    }
    // A disposed/unregistered Monaco textarea must not become an ordinary input
    // and silently restore the broken WK DOM-selection behavior.
    if (active.matches("textarea.inputarea")) return "blocked";
    // Find widgets, Workbench forms and ordinary text controls keep their own
    // native editing semantics. Select All must never select the whole document.
    const input = active as HTMLInputElement;
    const textInput = active.matches("textarea,input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]):not([type=hidden]):not([type=image])");
    if (!textInput && !(active as HTMLElement).isContentEditable) return "blocked";
    if (input.disabled || changesContent.has(command) && (input.readOnly || active.getAttribute("aria-readonly") === "true")) return "blocked";
    return "native";
  };
}

export function installDesktopEditBridge(window: Window, document: Document) {
  const previous = window.__ynxDesktopEdit;
  const router = createDesktopEditRouter(document, () => targets);
  window.__ynxDesktopEdit = router;
  return () => {
    if (window.__ynxDesktopEdit === router) {
      if (previous) window.__ynxDesktopEdit = previous;
      else delete window.__ynxDesktopEdit;
    }
  };
}

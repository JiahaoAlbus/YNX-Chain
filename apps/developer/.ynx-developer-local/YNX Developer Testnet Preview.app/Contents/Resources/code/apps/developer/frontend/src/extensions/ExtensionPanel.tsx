import { Download, Palette, Puzzle, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  installExtension,
  uninstallExtension,
  type InstalledExtension,
} from "../runtime/client";

const TEMPLATE = {
  apiVersion: "ynx-code-extension/v1",
  kind: "declarative-web",
  publisher: "my-team",
  name: "cpp-snippets",
  displayName: "My C++ Snippets",
  version: "1.0.0",
  description:
    "Declarative snippets without process, filesystem, network or secret authority.",
  contributes: {
    languages: [{ id: "cpp", extensions: [".cpp", ".hpp"], aliases: ["C++"] }],
    snippets: [
      {
        language: "cpp",
        label: "main function",
        prefix: "main",
        body: ["int main() {", "  ${1:return 0;}", "}"],
      },
    ],
    themes: [
      {
        id: "midnight-blue",
        label: "Midnight Blue",
        type: "dark",
        colors: {
          background: "#18191C",
          panel: "#202226",
          editor: "#101114",
          text: "#E8EAF0",
          muted: "#A3A8B1",
          border: "#34373D",
          accent: "#315DB4",
        },
      },
    ],
  },
};
export function ExtensionPanel({
  extensions,
  onChange,
  onApplyTheme,
}: {
  extensions: InstalledExtension[];
  onChange: (extensions: InstalledExtension[]) => void;
  onApplyTheme: (key: string) => void;
}) {
  const [source, setSource] = useState(() => JSON.stringify(TEMPLATE, null, 2)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const install = async () => {
    setBusy(true);
    setError("");
    try {
      const extension = await installExtension(JSON.parse(source));
      onChange(
        [
          ...extensions.filter((item) => item.id !== extension.id),
          extension,
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
    } catch (value) {
      setError(
        value instanceof Error ? value.message : "Extension install failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try {
      await uninstallExtension(id);
      onChange(extensions.filter((item) => item.id !== id));
    } catch (value) {
      setError(
        value instanceof Error ? value.message : "Extension uninstall failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="extension-panel">
      <header>
        <strong>EXTENSIONS</strong>
        <span>{extensions.length}</span>
      </header>
      <div className="extension-boundary">
        <Puzzle />
        <span>Declarative Web Extensions</span>
        <small>
          Language mappings, snippets and validated theme tokens only. No
          process, filesystem, network, secret or Wallet authority.
        </small>
      </div>
      {extensions.map((extension) => (
        <article key={extension.id}>
          <div>
            <strong>{extension.manifest.displayName}</strong>
            <span>
              {extension.id} · v{extension.version}
            </span>
            <small>SHA-256 {extension.digest.slice(0, 16)}…</small>
          </div>
          <button
            onClick={() => remove(extension.id)}
            disabled={busy}
            title="Uninstall extension"
          >
            <Trash2 />
          </button>
          <footer>
            {extension.manifest.contributes.languages.length} languages ·{" "}
            {extension.manifest.contributes.snippets.length} snippets ·{" "}
            {extension.manifest.contributes.themes.length} themes
            {extension.manifest.contributes.themes.map((theme) => (
              <button
                key={theme.id}
                onClick={() => onApplyTheme(`${extension.id}/${theme.id}`)}
              >
                <Palette /> Apply {theme.label}
              </button>
            ))}
          </footer>
        </article>
      ))}
      <details open>
        <summary>INSTALL MANIFEST</summary>
        <textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
          aria-label="Declarative extension manifest"
        />
        <button className="extension-install" onClick={install} disabled={busy}>
          <Download /> Validate & install
        </button>
        {error && <small className="extension-error">{error}</small>}
      </details>
    </section>
  );
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Java language intelligence is routed through pinned Eclipse JDT LS", async () => {
  const [editor, outline, gateway, service, bridge, image, live] = await Promise.all([
    read("frontend/src/editor/CodeEditor.tsx"),
    read("frontend/src/outline/OutlinePanel.tsx"),
    read("services/gateway/src/server.mjs"),
    read("services/language-service/src/java-lsp.mjs"),
    read("services/language-service/src/cpp-lsp.mjs"),
    read("scripts/build-cloud-toolchain-image.sh"),
    read("scripts/live-public-candidate-check.mjs"),
  ]);
  assert.match(editor, /"java","solidity"/);
  assert.match(outline, /"rust", "java", "solidity"/);
  assert.match(gateway, /java: routedLanguageRequest\(runJavaLanguageRequest\)/);
  assert.match(service, /serverCandidates: \["jdtls"\]/);
  assert.match(service, /"-data", "\.ynx-build\/jdtls"/);
  assert.match(bridge, /workspace\/configuration/);
  assert.match(image, /jdt-language-server-1\.61\.0-202607142124\.tar\.gz/);
  assert.match(image, /tar --no-same-owner -xzf "\/tmp\/\$jdtls_archive"/);
  assert.match(image, /4dc0747f22fb86dfada4c9214d3ef94c94f1e84eb57ce52126c26ecf2f17dce4/);
  assert.match(live, /protected cloud gate separately verifies all 9 runtime languages and 7 LSP routes/);
});

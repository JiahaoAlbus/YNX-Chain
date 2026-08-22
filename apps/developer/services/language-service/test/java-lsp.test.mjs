import assert from "node:assert/strict";
import test from "node:test";
import { resolveExecutable } from "../../workspace-agent/src/sandbox.mjs";
import { runJavaLanguageRequest } from "../src/java-lsp.mjs";

const jdtls = await resolveExecutable(["jdtls"]);
const eclipseProject = {
  "java-project/.project": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><projectDescription><name>ynx-java</name><buildSpec><buildCommand><name>org.eclipse.jdt.core.javabuilder</name><arguments/></buildCommand></buildSpec><natures><nature>org.eclipse.jdt.core.javanature</nature></natures></projectDescription>\n",
  "java-project/.classpath": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><classpath><classpathentry kind=\"src\" path=\"src\"/><classpathentry kind=\"con\" path=\"org.eclipse.jdt.launching.JRE_CONTAINER\"/><classpathentry kind=\"output\" path=\"/.ynx-build/java-lsp-bin\"/></classpath>\n",
};

test("Eclipse JDT LS provides real Java editing intelligence and diagnostics", { skip: !jdtls }, async () => {
  const files = {
    "src/Main.java": "package dev.ynx; final class Main { static int add(int left,int right){return left+right;} public static void main(String[] args){ int value=ad; } }\n",
  };
  const completion = await runJavaLanguageRequest({ files, activePath: "src/Main.java", operation: "completion", position: { line: 0, character: 143 } }),
    items = Array.isArray(completion.result) ? completion.result : completion.result?.items || [];
  assert.equal(completion.language, "java");
  assert.equal(completion.sandbox.network, false);
  assert.ok(items.some((item) => String(item.label).startsWith("add")), JSON.stringify(items.slice(0, 8)));
  const valid = { "src/Main.java": "package dev.ynx; final class Main { static int add(int left,int right){return left+right;} public static void main(String[] args){ int value=add(1,2); } }\n" },
    definition = await runJavaLanguageRequest({ files: valid, activePath: "src/Main.java", operation: "definition", position: { line: 0, character: 143 } });
  assert.ok(Array.isArray(definition.result) ? definition.result.length > 0 : Boolean(definition.result));
  const symbolPosition = { line: 0, character: valid["src/Main.java"].lastIndexOf("add") + 1 },
    references = await runJavaLanguageRequest({ files: valid, activePath: "src/Main.java", operation: "references", position: symbolPosition });
  assert.ok(references.result.length >= 2);
  const rename = await runJavaLanguageRequest({ files: valid, activePath: "src/Main.java", operation: "rename", position: symbolPosition, newName: "sum" });
  assert.ok(Object.values(rename.result.changes || {}).flat().some((edit) => edit.newText.includes("sum")));
  const format = await runJavaLanguageRequest({ files: valid, activePath: "src/Main.java", operation: "format" });
  assert.ok(format.result.some((edit) => edit.newText.includes("\n")));
  const symbols = await runJavaLanguageRequest({ files: valid, activePath: "src/Main.java", operation: "documentSymbols" });
  assert.ok(JSON.stringify(symbols.result).includes('"name":"add(int, int)"'));
  const invalid = { ...eclipseProject, "java-project/src/dev/ynx/Main.java": "package dev.ynx; final class Main { public static void main(String[] args){ int value=missingSymbol; } }\n" },
    diagnostics = await runJavaLanguageRequest({ files: invalid, activePath: "java-project/src/dev/ynx/Main.java", operation: "diagnostics" });
  assert.ok(diagnostics.result.some((item) => String(item.message).includes("missingSymbol")), JSON.stringify(diagnostics.result));
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../src/a11y.css", import.meta.url), "utf8");

test("skip navigation always has a rendered main target", () => {
  assert.match(html, /href="#main"/);
  assert.match(app, /class="auth" id="main" tabindex="-1"/);
  assert.match(app, /class="center" id="main" tabindex="-1" role="status"/);
  assert.match(app, /class="main" id="main" tabindex="-1"/);
});

test("navigation state, focus visibility and RTL use semantic contracts", () => {
  assert.match(app, /aria-current=\"page\"/);
  assert.match(app, /root\.querySelector\("\[data-locale\]"\)\?\.focus\(\)/);
  assert.match(css, /input:focus-visible/);
  assert.match(css, /\[dir="rtl"\] \.table th/);
  assert.match(css, /border-left: 1px solid var\(--line\)/);
});

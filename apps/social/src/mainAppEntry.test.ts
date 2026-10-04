import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as ts from 'typescript';

test('formal product routes preserve business consumers and exclude isolated fixture wiring', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  for (const route of ['Contacts', 'Messages', 'Moments', 'Alerts', 'Profile']) assert.match(app, new RegExp('<' + route + '\\b'));
  assert.match(app, /<MessageThread key=\{selected\.id\}/);
  assert.match(app, /if \(selected && !desktop\) return thread/);
  assert.match(app, /<KeyboardAvoidingView/);
  assert.match(app, /conversation\.e2ee === 'verified'/);
  assert.match(app, /Object\.keys\(item\.record\.readAt/);
  assert.match(app, /Object\.keys\(item\.record\.deliveredAt/);
  assert.doesNotMatch(app, /SYNTHETIC MEDIA VIEWER|Fail next (?:read|cleanup)|ui-fixture:example/);
});
test('web navigation is not an authorization grant and is included in the product builder', () => {
  const script = readFileSync(new URL('../web/product-shell.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/product-shell.css', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../web/build.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /eth_requestAccounts|personal_sign|sendTransaction|removeAttribute\(['"]hidden/);
  const publicRoots = new Map([['status', 'social-runtime-status'], ['retry', 'social-runtime-retry']]);
  const bound = new Set<string>();
  const ast = ts.createSourceFile('product-shell.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && publicRoots.has(node.name.text)) {
      const initializer = node.initializer;
      assert.ok(initializer && ts.isCallExpression(initializer));
      assert.ok(ts.isPropertyAccessExpression(initializer.expression));
      assert.equal(initializer.expression.name.text, 'getElementById');
      assert.equal(initializer.arguments.length, 1);
      const id = initializer.arguments[0]!;
      assert.ok(ts.isStringLiteral(id));
      assert.equal(id.text, publicRoots.get(node.name.text));
      assert.ok(!bound.has(node.name.text), 'public loader binding must not be shadowed');
      bound.add(node.name.text);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'hidden' &&
        node.right.kind === ts.SyntaxKind.FalseKeyword) {
      assert.ok(ts.isIdentifier(node.left.expression));
      assert.ok(bound.has(node.left.expression.text), 'navigation cannot unhide private authorization roots');
      let parent: ts.Node | undefined = node.parent;
      while (parent && !(ts.isFunctionDeclaration(parent) && parent.name?.text === 'loadApplication')) parent = parent.parent;
      assert.ok(parent, 'only the explicit application loader may show public loading/retry UI');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(bound.size, 2);
  assert.match(css, /\[hidden\]\{display:none!important;\}/);
  assert.match(script, /chat=doc\.getElementById\('matrix-social-workspace'\)/);
  assert.match(css, /social-page=settings\] #private-auth-panel\{display:block/);
  assert.match(build, /'product-shell\.css','product-shell\.js'/);
  assert.match(build, /SOCIAL_REGISTERED_SCOPE_CARRIER_MISMATCH/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source=readFileSync('src/App.tsx','utf8');
const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function all(node:ts.Node,predicate:(node:ts.Node)=>boolean):ts.Node[]{return [...(predicate(node)?[node]:[]),...node.getChildren(ast).flatMap(child=>all(child,predicate))];}

test('localization cannot rewrite identity, state, React keys or permission props',()=>{
 const attributes=all(ast,n=>ts.isJsxAttribute(n)&&['value','key','role','className'].includes(n.name.getText(ast)));
 for(const attr of attributes)assert.equal(all(attr,n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='copy').length,0,attr.getText(ast));
 for(const value of ['low','medium','high','critical'])assert.ok(source.includes(`<option value="${value}">`));
 assert.ok(source.includes('confirm !== "ACKNOWLEDGE"'));
 assert.ok(source.includes('phrase !== "APPROVE ROLLBACK PROPOSAL"'));
 assert.ok(source.includes('placeholder="APPROVE ROLLBACK PROPOSAL"'));
});

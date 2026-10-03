const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../App.tsx'),'utf8');
const tree=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let language,radio;
function walk(node,visit){visit(node);ts.forEachChild(node,child=>walk(child,visit))}
walk(tree,node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='Language')language=node});
assert.ok(language,'Language component exists');
walk(language,node=>{if(ts.isJsxOpeningElement(node)&&node.tagName.getText(tree)==='Pressable'&&node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='accessibilityLabel'&&p.initializer?.getText(tree)==='{localeNames[item]}'))radio=node});
assert.ok(radio,'language choice is a labeled Pressable');
const attrs=radio.attributes.properties;
const spread=attrs.find(p=>ts.isJsxSpreadAttribute(p)&&p.expression.getText(tree).includes('aria-checked'));
test('language options expose explicit Web checked state for all twelve locale choices',()=>{
  assert.ok(spread,'explicit aria-checked spread');
  const locales=['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id'];
  for(const locale of locales){const states=locales.map(item=>vm.runInNewContext('('+spread.expression.getText(tree)+')',{Platform:{OS:'web'},item,locale})['aria-checked']);assert.equal(states.filter(Boolean).length,1);assert.equal(states[locales.indexOf(locale)],true);assert.ok(states.every(x=>typeof x==='boolean'))}
});
test('native language choices do not receive Web-only aria attributes',()=>{
  assert.ok(spread);
  for(const OS of ['ios','android'])assert.equal(Object.keys(vm.runInNewContext('('+spread.expression.getText(tree)+')',{Platform:{OS},item:'en',locale:'en'})).length,0);
  assert.ok(attrs.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='accessibilityState'&&p.initializer?.getText(tree)==='{{checked:item===locale}}'));
});
test('radio labels and explicit locale selection handler remain unchanged',()=>{
  assert.ok(attrs.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='accessibilityRole'&&p.initializer?.getText(tree)==='"radio"'));
  assert.ok(attrs.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==='onPress'&&p.initializer?.getText(tree)==='{()=>void setLocale(item)}'));
});

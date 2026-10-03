const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const files=['App.tsx','src/GuestExperience.tsx','src/ProviderExperience.tsx'];

for(const file of files){
  const source=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let rtl;
  function visit(node){
    if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==='rtl')rtl=node.initializer.getText(tree);
    ts.forEachChild(node,visit);
  }
  visit(tree);assert(rtl,'Missing RTL style '+file);
  for(const platform of ['web','android','ios'])test(`${file}: ${platform} direction contract`,()=>{
    const output=ts.transpileModule('exports.style='+rtl,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const context={exports:{},Platform:{OS:platform}};vm.runInNewContext(output,context);
    const style=context.exports.style;
    if(platform==='web'){assert.equal(style.writingDirection,'rtl');assert.equal(Object.hasOwn(style,'direction'),false)}
    else{assert.equal(style.direction,'rtl');assert.equal(Object.hasOwn(style,'writingDirection'),false)}
  });
}

test('App View and Pressable have no bare single-line whitespace text nodes',()=>{
  const file='App.tsx',source=fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const unexpected=[];
  function visit(node){
    if(ts.isJsxElement(node)&&['View','Pressable'].includes(node.openingElement.tagName.getText(tree))){
      for(const child of node.children)if(ts.isJsxText(child)&&/^ +$/.test(child.getText(tree)))unexpected.push(tree.getLineAndCharacterOfPosition(child.pos).line+1);
    }
    ts.forEachChild(node,visit);
  }
  visit(tree);assert.deepEqual(unexpected,[]);
});

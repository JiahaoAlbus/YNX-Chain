import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {install} = require('../lib/native-file-keybindings');

const commands = {OPEN:{id:'workspace:open'}, OPEN_FILE:{id:'workspace:openFile'}};
function fixture(target) {
  class Workspace {
    registerKeybindings(registry) {
      registry.registerKeybinding({command:commands.OPEN.id,keybinding:'ctrlcmd+alt+o',when:'existing-context'});
      registry.registerKeybinding({command:'workspace:other',keybinding:'alt+x'});
      return 'original workspace return';
    }
  }
  class Symbols {
    command = {id:'workspace-symbols'};
    registerKeybindings(registry) {
      registry.registerKeybinding({command:this.command.id,keybinding:'ctrlcmd+o'});
    }
  }
  const bindings = [];
  const registry = {registerKeybinding(binding) { assert.equal(this,registry); bindings.push(binding); }};
  const args = {WorkspaceContribution:Workspace, SymbolContribution:Symbols, commands, target};
  install(args);
  return {args,Workspace,Symbols,bindings,registry};
}
test('native open owns CmdO while workspace symbols retain their desktop CmdT route',()=>{
  const f=fixture({ynxDesktopFiles:{}});
  assert.equal(new f.Workspace().registerKeybindings(f.registry),'original workspace return');
  new f.Symbols().registerKeybindings(f.registry);
  assert.deepEqual(f.bindings,[
    {command:commands.OPEN_FILE.id,keybinding:'ctrlcmd+o',when:'existing-context'},
    {command:'workspace:other',keybinding:'alt+x'},
    {command:'workspace-symbols',keybinding:'ctrlcmd+t'},
  ]);
  assert.equal(f.bindings.filter(b=>b.keybinding==='ctrlcmd+o').length,1);
});
test('ordinary browser retains original bindings without any native route',()=>{
  const f=fixture({});
  new f.Workspace().registerKeybindings(f.registry);
  new f.Symbols().registerKeybindings(f.registry);
  assert.equal(f.bindings[0].command,commands.OPEN.id);
  assert.equal(f.bindings[0].keybinding,'ctrlcmd+alt+o');
  assert.equal(f.bindings[2].keybinding,'ctrlcmd+o');
});
test('installation does not duplicate registration or rewrite registry user bindings',()=>{
  const f=fixture({ynxDesktopFiles:{}});
  install(f.args);
  f.registry.userBindings = [{command:'user-command',keybinding:'ctrlcmd+o'}];
  const original=f.registry.userBindings;
  new f.Workspace().registerKeybindings(f.registry);
  new f.Symbols().registerKeybindings(f.registry);
  assert.equal(f.bindings.length,3);
  assert.equal(f.registry.userBindings,original);
  assert.deepEqual(original,[{command:'user-command',keybinding:'ctrlcmd+o'}]);
});

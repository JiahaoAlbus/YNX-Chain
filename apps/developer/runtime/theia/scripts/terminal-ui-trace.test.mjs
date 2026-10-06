import test from 'node:test';
import assert from 'node:assert/strict';
import trace from '../../ynx-workbench/lib/terminal-ui-trace.js';
function fixture(enabled=true,limit=300){
 const rows=[],timers=[],disposables=[];let renderCallback;
 const observer=function(v){this._isPaused=v;return 7;};
 const render={_isPaused:true,_renderDebouncer:{_animationFrame:123},_handleIntersectionChange:observer};
 const proto={init(){this.term={rows:24,cols:80,_core:{_renderService:render},onRender(cb){renderCallback=cb;return {dispose(){renderCallback=undefined;}}}};},open(){this.termOpened=true;return 42;},write(data){this.last=data;return 11;},onAfterShow(){this.isVisible=true;},onResize(){return 9;}};
 const target={__ynxTerminalUiTraceEnabled:enabled,document:{visibilityState:'visible'},webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage(row){rows.push(row)}}}},setTimeout(cb){timers.push(cb);return timers.length;},clearTimeout(){}};
 const widget=Object.assign(Object.create(proto),{toDispose:{push(d){disposables.push(d);}},isAttached:true});
 trace.traceTerminal(proto,target,limit);
 return {proto,target,widget,rows,timers,render,observer,disposables,paint(){renderCallback?.()}};
}
test('strict opt-in leaves methods unchanged and creates no timers or data',()=>{
 const f=fixture(false);const method=f.proto.write;trace.traceTerminal(f.proto,{...f.target,__ynxTerminalUiTraceEnabled:'1'});assert.equal(f.proto.write,method);f.widget.init();f.widget.open();f.widget.write('secret');assert.equal(f.rows.length,0);assert.equal(f.timers.length,0);
});
test('real trace module distinguishes data, open, visibility and paused rendering without content',()=>{
 const f=fixture();f.widget.init();assert.equal(f.rows[0].opened,0);assert.equal(f.widget.write('秘密'),11);assert.equal(f.rows.at(-1).bytes,6);assert.equal(f.widget.open(),42);f.widget.onAfterShow();f.paint();assert.equal(f.render._handleIntersectionChange(false),7);f.timers[0]();const last=f.rows.at(-1);assert.equal(last.bytes,6);assert.equal(last.renders,1);assert.equal(last.opened,1);assert.equal(last.visible,1);assert.equal(last.attached,1);assert.equal(last.docVisible,1);assert.equal(last.paused,0);assert.equal(last.pending,1);assert.equal(last.rows,24);assert.equal(last.cols,80);assert.equal(JSON.stringify(f.rows).includes('秘密'),false);assert.equal(Object.keys(last).length,17);for(const [k,v]of Object.entries(last))if(!['action','event'].includes(k))assert.equal(typeof v,'number');
 for(const d of f.disposables)d.dispose();assert.equal(f.render._handleIntersectionChange,f.observer);
});
test('idempotent installation and bounded diagnostics preserve calls',()=>{
 const f=fixture(true,6);const method=f.proto.write;trace.traceTerminal(f.proto,f.target);assert.equal(f.proto.write,method);f.widget.init();for(let i=0;i<100;i++){f.widget.open();assert.equal(f.widget.write('x'),11);f.paint();}assert.equal(f.rows.length,6);assert.equal(f.widget.last,'x');
});
test('native sink failures preserve original result and errors',()=>{
 const f=fixture();f.target.webkit.messageHandlers.ynxLocalWorkbench.postMessage=()=>{throw Error('sink unavailable')};assert.doesNotThrow(()=>f.widget.init());assert.equal(f.widget.open(),42);assert.equal(f.widget.write('x'),11);
 const error=Error('original');const proto={write(){throw error}};trace.traceTerminal(proto,f.target);assert.throws(()=>proto.write('x'),e=>e===error);
});
test('native diagnostic request observes an already opened terminal without restarting it',()=>{
 const f=fixture(false),listeners=new Map();let registrations=0;
 f.target.addEventListener=(name,callback)=>{registrations++;listeners.set(name,callback);};
 f.widget.init();f.widget.open();const method=f.proto.write;
 trace.armTerminalTrace(f.proto,f.target,6);trace.armTerminalTrace(f.proto,f.target,6);
 assert.equal(registrations,1);assert.equal(f.proto.write,method);assert.equal(f.rows.length,0);
 listeners.get('ynx-terminal-diagnostics')();const wrapped=f.proto.write;
 f.widget.onAfterShow();assert.equal(f.widget.write('private output'),11);f.paint();f.timers[0]();
 assert.equal(f.rows.at(-1).writes,1);assert.equal(f.rows.at(-1).renders,1);
 assert.equal(JSON.stringify(f.rows).includes('private output'),false);
 listeners.get('ynx-terminal-diagnostics')();assert.equal(f.proto.write,wrapped);
 for(let i=0;i<20;i++){f.widget.write('x');f.paint();}assert.equal(f.rows.length,6);
});
test('ordinary browser cannot arm the native diagnostic bridge',()=>{
 const f=fixture(false);let registrations=0;delete f.target.webkit;
 f.target.addEventListener=()=>{registrations++;};const method=f.proto.write;
 trace.armTerminalTrace(f.proto,f.target);f.widget.init();f.widget.open();f.widget.write('secret');
 assert.equal(registrations,0);assert.equal(f.proto.write,method);assert.equal(f.rows.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {pathToFileURL} from 'node:url';

// PUBLIC controlled native-order model, not actual Electron/OS acceptance.
// Electron v42.10.0 browser.cc: Quit assigns HandleBeforeQuit's result AFTER
// observers return. event_emitter_caller.cc performs a microtask checkpoint
// before returning from Emit. Model that callback boundary with a VM queue.
const parent=process.env.PUBLIC_EXIT_MAIN;
const source=readFileSync(parent?pathToFileURL(parent):new URL('../src/main.mjs',import.meta.url),'utf8');
const start=source.indexOf('function createOriginalAdmissionExitGate(');
const end=source.indexOf('\nconst originalAdmissionExit=',start);
assert.ok(start>=0&&end>start);
const body=source.slice(start,end);
function fixture({delayed=false,failed=false,lockFailure=false}={}){
  const tasks=[],events=[];
  let quitting=false,closed=false,finished=false,depth=0,maxDepth=0;
  let locks=0,cleanups=0,reports=0,quitCalls=0,destroys=0,release;
  const context=createContext({
    setImmediate:callback=>tasks.push(callback),
    nativeQuit:()=>nativeQuit(),
    lock(){locks++;events.push('lock');if(lockFailure)throw Error('PUBLIC_LOCK_FAILURE');},
    report(){reports++;},
    destroy(){destroys++;enqueueClose();},
  },{microtaskMode:'afterEvaluate'});
  runInContext(body+`
    let resolveShutdown;
    const shutdownResult=new Promise((resolve,reject)=>{resolveShutdown=()=>${failed?"reject(Error('PUBLIC_UNKNOWN_OR_CLEANUP_FAILURE'))":"resolve()"};});
    this.releaseShutdown=()=>resolveShutdown();
    this.gate=createOriginalAdmissionExitGate({
      entry:{shutdown(){globalThis.cleanupEntered();${delayed?'':'resolveShutdown();'}return shutdownResult;}},
      lock,quit:nativeQuit,report
    });
  `,Object.assign(context,{cleanupEntered:()=>{cleanups++;events.push('cleanup');}}));
  release=()=>runInContext('releaseShutdown()',context);
  function checkpoint(code){return runInContext(code,context);}
  function enqueueClose(){tasks.push(()=>{closed=true;events.push('all-closed');if(quitting)finished=true;else checkpoint('gate.allClosed()');});}
  function nativeQuit(){
    quitCalls++;depth++;maxDepth=Math.max(maxDepth,depth);
    try{
      if(quitting)return;
      // Keep this native event local: a nested Quit has its OWN prevented flag.
      const event={prevented:false,preventDefault(){this.prevented=true;}};
      context.currentEvent=event;
      checkpoint('gate.beforeQuit(currentEvent)');
      quitting=!event.prevented;
      events.push('native-after-before-quit:'+quitting);
      if(!quitting)return;
      if(closed)finished=true;else enqueueClose();
    }finally{depth--;}
  }
  const window={destroy:context.destroy};
  return {
    quit:nativeQuit,release,
    close(){context.window=window;context.currentEvent={preventDefault(){}};checkpoint('gate.close(currentEvent,window)');},
    all(){checkpoint('gate.allClosed()');},
    drain(){let n=0;while(tasks.length){assert.ok(++n<30,'bounded public event loop');tasks.shift()();checkpoint('void 0');}},
    state:()=>({quitting,closed,finished,locks,cleanups,reports,quitCalls,destroys,maxDepth,pending:tasks.length,events:[...events]}),
    failure(){context.failureCode=null;checkpoint("gate.request().catch(error=>{globalThis.failureCode=error.code;})");return context.failureCode;},
  };
}
test('R63 warm immediate cleanup reaches shutdown after explicit Quit',()=>{
  const f=fixture();f.quit();f.drain();
  assert.equal(f.state().finished,true,'warm Quit must not leave a windowless main');
  assert.equal(f.state().maxDepth,1,'no nested app.quit in native before-quit callback');
  assert.equal(f.state().locks,1);assert.equal(f.state().cleanups,1);
});
test('R63 warm cleanup never enters app.quit before outer callback unwinds',()=>{
  const f=fixture();f.quit();
  assert.equal(f.state().quitCalls,1,'resume quit must be deferred to a later event-loop turn');
  assert.equal(f.state().locks,1,'lock is synchronous');assert.equal(f.state().finished,false);
  f.drain();assert.equal(f.state().finished,true);assert.equal(f.state().quitCalls,2);
});
test('R63 delayed cleanup preserves cold normal Quit',()=>{
  const f=fixture({delayed:true});f.quit();f.drain();
  assert.equal(f.state().finished,false);assert.equal(f.state().quitCalls,1);
  f.release();f.drain();assert.equal(f.state().finished,true);
  assert.equal(f.state().cleanups,1);assert.equal(f.state().locks,1);
});
test('R63 duplicate explicit Quit joins one cleanup and one deferred resume',()=>{
  const f=fixture({delayed:true});f.quit();f.quit();f.quit();
  assert.equal(f.state().cleanups,1);assert.equal(f.state().locks,1);
  f.release();f.drain();assert.equal(f.state().finished,true);
  assert.equal(f.state().quitCalls,4);assert.equal(f.state().maxDepth,1);
});
test('R63 manual close then all-closed still quits exactly once',()=>{
  const f=fixture();f.close();f.close();f.drain();
  assert.equal(f.state().destroys,1);assert.equal(f.state().finished,true);
  assert.equal(f.state().quitCalls,1);assert.equal(f.state().locks,1);
});
test('R63 close plus explicit Quit during cleanup does not double cleanup',()=>{
  const f=fixture({delayed:true});f.close();f.quit();f.close();
  f.release();f.drain();
  assert.equal(f.state().finished,true);assert.equal(f.state().destroys,1);
  assert.equal(f.state().cleanups,1);assert.equal(f.state().locks,1);
});
test('R63 UNKNOWN or cleanup failure remains fail closed without replay',()=>{
  const f=fixture({failed:true});f.quit();f.close();f.all();f.drain();
  assert.equal(f.failure(),'ADMISSION_SHUTDOWN_INCOMPLETE');
  f.quit();f.close();f.all();f.drain();
  assert.equal(f.state().finished,false);assert.equal(f.state().closed,false);
  assert.equal(f.state().destroys,0);assert.equal(f.state().cleanups,1);
  assert.equal(f.state().reports,1);assert.equal(f.state().pending,0);
});
test('R63 synchronous lock failure never starts cleanup or quits',()=>{
  const f=fixture({lockFailure:true});f.quit();f.drain();
  assert.equal(f.failure(),'ADMISSION_SHUTDOWN_INCOMPLETE');
  assert.equal(f.state().finished,false);assert.equal(f.state().cleanups,0);
  assert.equal(f.state().locks,1);assert.equal(f.state().reports,1);
});

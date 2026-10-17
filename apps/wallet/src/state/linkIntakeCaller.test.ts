import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=readFileSync(process.env.PUBLIC_WALLET_APP_SOURCE??new URL('../../App.tsx',import.meta.url),'utf8');
const cancel=source.split('\n').find(line=>line.includes('const cancelAuthorization=useCallback('));
const a=source.indexOf('  const handleLink=useCallback('),b=source.indexOf('\n\n  useEffect(()=>{void load()}',a);
assert.ok(cancel&&a>=0&&b>a,'actual App root callback boundary');
const program=ts.transpileModule(cancel+'\n'+source.slice(a,b)+'\nthis.api={cancelAuthorization,handleLink};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const routes={product:'ynxwallet://product-session?PUBLIC_NO_GRANT',action:'ynxwallet://application-action?PUBLIC_NO_GRANT',card:'ynxwallet://card-application-approval?PUBLIC_NO_GRANT',finance:'ynxwallet://finance-order-approval?PUBLIC_NO_GRANT'} as const;
type Kind=keyof typeof routes;
function deferred(){let resolve!:(value:any)=>void,reject!:(error:Error)=>void;const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};}
function fixture(){
 const queues={product:[],action:[],card:[],finance:[]} as Record<Kind,ReturnType<typeof deferred>[]>;
 const calls={product:0,action:0,card:0,finance:0},cancels={product:0,action:0,card:0,finance:0},errors:string[]=[],reviews:unknown[]=[];
 const controller=(kind:Kind)=>({current:null,receive(){calls[kind]++;const pending=queues[kind].shift();return pending?.promise??Promise.reject(Error('PUBLIC_DENIED_NO_AUTHORITY'));},cancel(){cancels[kind]++;this.current=null;}});
 const context={useCallback:(callback:unknown)=>callback,platformStorageHealth:{requiresRestart:false},readyRef:{current:true},AppState:{currentState:'active'},queuedLink:{current:null as string|null},linkIntake:{current:false},linkRevision:{current:0},
  productSessions:controller('product'),applicationActions:controller('action'),cardApprovals:controller('card'),financeOrderApprovals:controller('finance'),
  locale:'en',localizeError:(_locale:string,error:Error)=>error.message,setAuthorizationError:(value:string)=>errors.push(value),
  setAuthorization:(value:unknown)=>reviews.push(value),setApplicationAction:(value:unknown)=>reviews.push(value),setCardApproval:(value:unknown)=>reviews.push(value),setFinanceOrderApproval:(value:unknown)=>reviews.push(value),
  offered:[] as string[],offerWalletConnectDeepLink:(url:string)=>context.offered.push(url),URL,Error
 };
 runInNewContext(program,context);
 const api=(context as any).api as {handleLink:(url:string)=>void;cancelAuthorization:()=>void};
 return{context,calls,cancels,errors,reviews,api,open(kind:Kind){const pending=deferred();queues[kind].push(pending);api.handleLink(routes[kind]);return pending;}};
}
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
test('R67 current pending App intake rejects another route without dispatching it',()=>{
 const f=fixture();f.open('product');f.api.handleLink(routes.card);
 assert.equal(f.calls.product,1);assert.equal(f.calls.card,0);assert.equal(f.context.linkIntake.current,true);assert.match(f.errors[0]!,/Finish or reject/);
});
for(const kind of Object.keys(routes) as Kind[])test('R67 explicit App cancel releases '+kind+' intake before pending read settles',()=>{
 const f=fixture();f.open(kind);assert.equal(f.context.linkIntake.current,true);
 f.api.cancelAuthorization();assert.equal(f.context.linkIntake.current,false,'cancel must release its retired App intake synchronously');
 assert.deepEqual(f.cancels,{product:1,action:1,card:1,finance:1});assert.ok(f.reviews.every(value=>value===null));
});
for(const old of ['reject','resolve-null'] as const)test('R67 retired '+old+' finally cannot clear a newer App intake',async()=>{
 const f=fixture(),first=f.open('product');f.api.cancelAuthorization();
 const next=f.open('action');assert.equal(f.calls.action,1,'fresh different route must enter after explicit cancel');
 const beforeErrors=f.errors.length;
 if(old==='reject')first.reject(Error('PUBLIC_OLD_DENIED'));else first.resolve(null);
 await flush();assert.equal(f.context.linkIntake.current,true,'old finally must not retire the newer intake');
 assert.equal(f.errors.length,beforeErrors);assert.ok(f.reviews.every(value=>value===null));
 f.api.handleLink(routes.finance);assert.equal(f.calls.finance,0);
 next.reject(Error('PUBLIC_CURRENT_DENIED'));await flush();
 assert.equal(f.context.linkIntake.current,false);assert.equal(f.errors.at(-1),'PUBLIC_CURRENT_DENIED');
});
test('R67 current reader refusal reports its own failure and releases intake normally',async()=>{
 const f=fixture(),pending=f.open('card');pending.reject(Error('PUBLIC_CURRENT_DENIED'));await flush();
 assert.equal(f.context.linkIntake.current,false);assert.deepEqual(f.errors,['PUBLIC_CURRENT_DENIED']);assert.equal(f.reviews.length,0);
});
test('R67 not-ready intake still queues URL without controller or authority activity',()=>{
 const f=fixture();f.context.readyRef.current=false;f.api.handleLink(routes.product);
 assert.equal(f.context.queuedLink.current,routes.product);assert.equal(f.context.linkIntake.current,false);assert.equal(f.calls.product,0);
});
test('R67 WalletConnect route keeps its existing dedicated intake and no product admission',()=>{
 const f=fixture(),url='ynxwallet://wc?PUBLIC_NO_PAIRING';f.api.handleLink(url);
 assert.deepEqual(f.context.offered,[url]);assert.equal(f.context.linkIntake.current,false);assert.deepEqual(f.calls,{product:0,action:0,card:0,finance:0});
});

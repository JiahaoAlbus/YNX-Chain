import test from 'node:test';
import assert from 'node:assert/strict';
import {appendWalletProjectControlReview} from '../src/wallet-project-control-review-ui.mjs';
const now=1800000000000;
function fixture(change={}){
 const command={RequestID:'request',Action:'project.publisher',ProjectID:'project',TeamID:'',SubjectAccount:'publisher-owner',PublisherID:'publisher',RuntimeOrigin:'',ExpectedRevision:'2',GrantExpiresMS:String(now+20000),Read:false,Publish:false,Runtime:false,Revoke:false,ExpiresMS:String(now+10000),PublicOriginalSHA256:'a'.repeat(64)};
 const publisher={Account:'publisher-owner',ProjectID:'project',PublisherID:'publisher',KeyRole:'ide-artifact-publisher',PublicSHA256:'a'.repeat(64),RegistrationRef:'registration',ExpiresMS:String(now+30000)};
 const review={reviewId:'opaque',account:'controller',networkId:'testnet',command,publisher,...change};
 if(review.publisher===undefined)delete review.publisher;
 const children=[],calls=[],messages=[];let state={account:'controller',revision:1,locked:false,authenticating:false},reply=async(id,decision)=>({ok:true,value:{reviewId:id,decision,recorded:true}}),clock=now;
 const ui=appendWalletProjectControlReview({container:{append:x=>children.push(x)},review,api:{async decideIDEProjectControl(id,d){calls.push([id,d]);return reply(id,d);}},getKeyState:()=>state,isCurrent:()=>true,onResult:x=>messages.push(x),now:()=>clock,document:{createElement:()=>({addEventListener(k,f){this[k]=f;}})}});
 return{children,calls,messages,ui,buttons:children.filter(x=>x.type==='button'),state:s=>{state={...state,...s};},reply:f=>{reply=f;},clock:n=>{clock=n;}};
}
test('separate control review renders exact command and publisher binding; sends only opaque ID and decision',async()=>{
 const f=fixture();for(const value of ['注册发布者','project','publisher-owner','registration','a'.repeat(64),'授权到期','不是撤销','预期记录版本：2'])assert(f.children.some(x=>x.textContent.includes(value)),value);
 await f.buttons[0].click();assert.deepEqual(f.calls,[['opaque','approve']]);assert.match(f.messages.at(-1),/not registration or publication completion/);
});
test('foreign public binding and artifact-release payload cannot become a control review',()=>{
 assert.throws(()=>fixture({publisher:{}}),/CONTROL_REVIEW_INVALID/);
 assert.throws(()=>fixture({publication:{projectId:'project'}}),/CONTROL_REVIEW_INVALID/);
});
test('primary review uses readable action, target, permissions and expiry labels',()=>{
 const f=fixture();for(const value of ['动作：注册发布者','公钥指纹（SHA-256）','本次确认到期','技术摘要'])assert(f.children.some(x=>x.textContent.includes(value)),value);
 for(const prefix of ['RequestID:','GrantExpiresMS:','PublicOriginalSHA256:','Read:','Publish:','Runtime:'])assert(!f.children.some(x=>x.textContent.startsWith(prefix)));
});
test('expiry and lock fence a choice without enabling a replacement operation',async()=>{
 for(const mode of ['expiry','lock']){const f=fixture();if(mode==='expiry')f.clock(now+10000);else f.state({locked:true});await f.buttons[0].click();assert.equal(f.calls.length,0);}
});
test('unknown and duplicate callbacks never resubmit or claim committed registration',async()=>{
 const f=fixture();f.reply(async()=>{throw Error('lost response');});await f.buttons[0].click();await f.buttons[0].click();await f.buttons[1].click();assert.equal(f.calls.length,1);assert.match(f.messages.at(-1),/unknown/);
});
test('late response after account revision change does not render success',async()=>{
 const f=fixture();let done;f.reply(()=>new Promise(r=>{done=r;}));const p=f.buttons[0].click();f.state({revision:2});done({ok:true,value:{reviewId:'opaque',decision:'approve',recorded:true}});await p;assert.equal(f.messages.length,0);
});
test('reject and cancel stay distinct',async()=>{
 for(const [index,decision]of [[1,'reject'],[2,'cancel']]){const f=fixture();await f.buttons[index].click();assert.deepEqual(f.calls,[['opaque',decision]]);}
});
test('public binding is captured without invoking accessors',()=>{
 let reads=0;const publisher={};Object.defineProperty(publisher,'Account',{enumerable:true,get(){reads++;return 'secret';}});
 assert.throws(()=>fixture({publisher}),/CONTROL_REVIEW_INVALID/);assert.equal(reads,0);
});
test('clock regression cannot approve or submit a control choice',async()=>{
 const f=fixture();f.clock(now-1);await f.buttons[0].click();assert.equal(f.calls.length,0);
});
test('control command rejects unknown fields, mixed rights and noncanonical revisions',()=>{
 const base={RequestID:'request',Action:'project.create',ProjectID:'project',TeamID:'',SubjectAccount:'',PublisherID:'',RuntimeOrigin:'',ExpectedRevision:'0',GrantExpiresMS:'0',Read:false,Publish:false,Runtime:false,Revoke:false,ExpiresMS:String(now+10000),PublicOriginalSHA256:''};
 assert.doesNotThrow(()=>fixture({command:base,publisher:undefined}));
 for(const delta of [{extra:'x'},{ExpectedRevision:'01'},{Publish:true},{Revoke:true},{Action:'ARTIFACT-RELEASE'}])assert.throws(()=>fixture({command:{...base,...delta},publisher:undefined}),/CONTROL_REVIEW_INVALID/);
});
test('existing Auth control action variants display without rewriting their command',()=>{
 const base={RequestID:'request',Action:'project.create',ProjectID:'project',TeamID:'',SubjectAccount:'',PublisherID:'',RuntimeOrigin:'',ExpectedRevision:'0',GrantExpiresMS:'0',Read:false,Publish:false,Runtime:false,Revoke:false,ExpiresMS:String(now+10000),PublicOriginalSHA256:''};
 for(const delta of [
  {Action:'team.create',ProjectID:'',TeamID:'team'},
  {Action:'team.member',ProjectID:'',TeamID:'team',SubjectAccount:'member',GrantExpiresMS:String(now+20000)},
  {Action:'project.member',SubjectAccount:'member',Read:true,GrantExpiresMS:String(now+20000)},
  {Action:'project.team',TeamID:'team',Publish:true,GrantExpiresMS:String(now+20000)},
  {Action:'project.origin',ExpectedRevision:'1',RuntimeOrigin:'https://example.com'},
  {Action:'project.revoke',ExpectedRevision:'1',Revoke:true},
  {Action:'team.revoke',ExpectedRevision:'1',Revoke:true,ProjectID:'',TeamID:'team'},
  {Action:'project.publisher',ExpectedRevision:'1',SubjectAccount:'publisher-owner',PublisherID:'publisher',PublicOriginalSHA256:'a'.repeat(64),Revoke:true},
 ])assert.doesNotThrow(()=>fixture({command:{...base,...delta},publisher:undefined}),delta.Action);
});

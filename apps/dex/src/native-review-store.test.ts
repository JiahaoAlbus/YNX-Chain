import {afterEach,expect,it,vi} from 'vitest';
import {guardNativeReviewStore} from './native-review-store';
afterEach(()=>vi.useRealTimers());
it.each(['account','chain','disconnect','new-provider','new-review'])('rejects delayed IDB writes after %s invalidation',async()=>{
  let current=true,release!:()=>void,value:string|null=null;
  const store={update:async(_key:string,change:(old:string|null)=>string|null)=>{await new Promise<void>(r=>release=r);value=change(value);return value;}};
  const guarded=guardNativeReviewStore(store,()=>current,new Date().toISOString(),Math.floor(Date.now()/1000)+60);
  const pending=guarded.update('intent',()=> 'new signed review');
  current=false;release();await expect(pending).rejects.toThrow('NATIVE_CONTEXT_CHANGED');expect(value).toBeNull();
});
it.each(['snapshot','deadline'])('rejects %s expiry while the object read is pending',async kind=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-19T00:00:00Z'));
  let release!:()=>void;const write=vi.fn(()=> 'saved');
  const guarded=guardNativeReviewStore({update:async(_k,c)=>{await new Promise<void>(r=>release=r);return c(null);}},()=>true,new Date().toISOString(),Math.floor(Date.now()/1000)+(kind==='deadline'?1:60));
  const pending=guarded.update('intent',write);vi.setSystemTime(Date.now()+(kind==='deadline'?1001:15001));release();
  await expect(pending).rejects.toThrow('NATIVE_REVIEW_EXPIRED');expect(write).not.toHaveBeenCalled();
});
it('does not schedule an invalidated review and commits an unchanged fresh review',async()=>{
  const update=vi.fn(async(_key:string,c:(old:string|null)=>string|null)=>c(null));
  const asOf=new Date().toISOString(),deadline=Math.floor(Date.now()/1000)+60;
  expect(()=>guardNativeReviewStore({update},()=>false,asOf,deadline).update('intent',()=> 'bad')).toThrow('NATIVE_CONTEXT_CHANGED');expect(update).not.toHaveBeenCalled();
  await expect(guardNativeReviewStore({update},()=>true,asOf,deadline).update('intent',()=> 'saved')).resolves.toBe('saved');
});

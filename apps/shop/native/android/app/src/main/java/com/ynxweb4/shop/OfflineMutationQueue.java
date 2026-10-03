package com.ynxweb4.shop;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.UUID;

final class OfflineMutationQueue {
    interface Storage extends CheckoutIntent.Storage {}
    interface Sender {default boolean current()throws Exception{return true;}ProductSession session()throws Exception;JSONObject requestForSession(String method,String path,JSONObject body,ProductSession session,long generation)throws Exception;default JSONObject requestForSession(String method,String path,JSONObject body,ProductSession session,long generation,ApiClient.BeforeDispatch admission)throws Exception{throw new SecurityException("Explicit offline draft dispatch is unavailable");}}
    private final Storage secure;
    private boolean flushing;
    OfflineMutationQueue(Storage store){this.secure=store;}
    synchronized String enqueue(String method,String path,JSONObject body)throws Exception{
        synchronized(secure){return enqueueLocked(ProductSession.parse(secure.get("commerce_session"),Instant.now()),-1,method,path,body);}
    }
    synchronized String enqueueForSession(ProductSession expected,long generation,String method,String path,JSONObject body)throws Exception{
        synchronized(secure){if(expected==null||!expected.nativeV2)throw new SecurityException("Original Native authority required");return enqueueLocked(expected,generation,method,path,body);}
    }
    synchronized String enqueueUnsentForSession(ProductSession expected,long generation,String method,String path,JSONObject body)throws Exception{
        synchronized(secure){if(expected==null||!expected.nativeV2||!path.endsWith("/transition"))throw new SecurityException("Canonical Native Buyer draft required");OfflineDraftPhase.records(secure);JSONArray before=read();String id=enqueueLocked(expected,generation,method,path,body);for(int i=0;i<before.length();i++)if(id.equals(before.getJSONObject(i).getString("id")))return id;JSONArray rows=read();for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(id.equals(row.getString("id"))){OfflineDraftPhase.prepared(secure,row);return id;}}throw new SecurityException("Saved original offline draft unavailable");}
    }
    private String enqueueLocked(ProductSession session,long generation,String method,String path,JSONObject body)throws Exception{
        if(session==null)throw new SecurityException("An active account is required to save a pending request");long current=PrivacyLifecycle.requireWritable(secure,session.account);if(generation>=0&&generation!=current)throw new SecurityException("Original queue privacy generation changed");generation=current;
        if(!method.equals("POST")||!(path.equals("/orders")||path.matches("/orders/[^/]+/transition")))throw new SecurityException("Only reviewed order actions can be queued");if(path.endsWith("/transition")&&!java.util.Set.of("cancelled","delivered","return_requested","refund_requested","disputed","reviewed").contains(body.optString("Action")))throw new SecurityException("Queued action is not a buyer review action");String key=body.optString("IdempotencyKey");if(key.isBlank())throw new SecurityException("A purchase intent key is required");JSONArray queue=read();
        for(int i=0;i<queue.length();i++){JSONObject existing=queue.getJSONObject(i),existingBody=existing.optJSONObject("body");if(session.account.equals(existing.optString("account"))&&method.equals(existing.optString("method"))&&path.equals(existing.optString("path"))&&existingBody!=null&&key.equals(existingBody.optString("IdempotencyKey"))){if(!WalletAuth.canonical(body).equals(WalletAuth.canonical(existingBody)))throw new SecurityException("A queued intent key cannot change its contents");return existing.getString("id");}}
        if(queue.length()>=100)throw new IllegalStateException("Pending request queue is full");String id=UUID.randomUUID().toString();
        queue.put(new JSONObject().put("id",id).put("method",method).put("path",path).put("body",new JSONObject(body.toString())).put("account",session.account).put("privacyGeneration",generation).put("queuedAt",Instant.now().toString()));
        secure.put("offline_mutations",queue.toString());return id;
    }
    synchronized boolean hasOriginalTransition(String account,String path)throws Exception{
        synchronized(secure){JSONArray rows=read();for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(path.equals(row.optString("path"))&&(account.equals(row.optString("account"))||row.optString("account").isEmpty()))return true;}return false;}
    }
    synchronized int sizeFor(String account)throws Exception{int count=0;JSONArray rows=read();for(int i=0;i<rows.length();i++)if(account.equals(rows.getJSONObject(i).optString("account")))count++;return count;}
    synchronized int size() throws Exception{return read().length();}
    int flush(ApiClient api,ProductSession expected,long generation) throws Exception{return flush(api,expected,generation,()->true);}
    int flush(ApiClient api,ProductSession expected,long generation,ApiClient.ContextCheck presentation) throws Exception{return flush(new Sender(){public boolean current()throws Exception{return presentation.current();}public ProductSession session()throws Exception{return api.session();}public JSONObject requestForSession(String method,String path,JSONObject body,ProductSession session,long generation)throws Exception{return api.requestForSession(method,path,body,session,generation);}public JSONObject requestForSession(String method,String path,JSONObject body,ProductSession session,long generation,ApiClient.BeforeDispatch admission)throws Exception{return api.requestForSession(method,path,body,session,generation,admission);}},expected,generation);}
    int flush(Sender api) throws Exception{return flush(api,api.session());}
    int flush(Sender api,ProductSession expected) throws Exception{
        if(expected==null)throw new SecurityException("Connect Wallet to restore this account's pending actions");
        return flush(api,expected,PrivacyLifecycle.requireWritable(secure,expected.account));
    }
    int flush(Sender api,ProductSession expected,long generation) throws Exception{
        if(expected==null)throw new SecurityException("Connect Wallet to restore this account's pending actions");
        final JSONArray pending;
        synchronized(this){synchronized(secure){if(!PrivacyLifecycle.writableGeneration(secure,expected.account,generation))throw new PrivacyLifecycle.Blocked(PrivacyLifecycle.DRAINING);if(flushing)throw new IllegalStateException("Pending actions are already being restored");pending=read();flushing=true;}}
        int completed=0;
        try{
            for(int i=0;i<pending.length();i++){
                JSONObject item=pending.getJSONObject(i);String account=item.optString("account");
                if(!api.current()||!expected.same(api.session())||!PrivacyLifecycle.writableGeneration(secure,expected.account,generation))break;
                if(!account.equals(expected.account)||!PrivacyLifecycle.queueExecutable(secure,account,item))continue;
                try{
                    JSONObject body=item.getJSONObject("body");String path=item.getString("path");
                    JSONObject response;
                    if(expected.nativeV2){if(path.equals("/orders"))response=api.requestForSession("POST","/orders/intent-lookup",new JSONObject().put("IdempotencyKey",body.getString("IdempotencyKey")),expected,generation);else if(path.matches("/orders/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}/transition")){String phase;synchronized(secure){phase=OfflineDraftPhase.phase(secure,item);}if(phase.equals("prepared")){response=api.requestForSession("POST",path,body,expected,generation,()->{synchronized(secure){if(!api.current()||!expected.same(api.session())||!PrivacyLifecycle.writableGeneration(secure,expected.account,generation))throw new SecurityException("Original offline draft context changed");boolean found=false;JSONArray live=read();for(int j=0;j<live.length();j++)if(WalletAuth.canonical(item).equals(WalletAuth.canonical(live.getJSONObject(j))))found=true;if(!found)throw new SecurityException("Original offline draft replaced");OfflineDraftPhase.dispatching(secure,item);}});BuyerOrderReadback.validate(response,expected);if(!path.equals("/orders/"+response.getString("ID")+"/transition"))throw new SecurityException("Original offline target changed");}else{response=api.requestForSession("POST",path+"-intent-lookup",body,expected,generation);BuyerTransitionRecovery.receipt(response,expected,path,body);}}else continue;}
                    else response=api.requestForSession(item.getString("method"),path,body,expected,generation);
                    synchronized(this){
                        synchronized(secure){
                        if(expected.nativeV2&&(!api.current()||!expected.same(api.session())||!PrivacyLifecycle.writableGeneration(secure,expected.account,generation)))throw new SecurityException("Original Native queue recovery context changed");
                        if(path.equals("/orders")){if(body.has("CartRevision")){if(!(secure instanceof NativeCart.Storage))throw new SecurityException("Atomic cart storage required");CheckoutIntent.confirmedReceipt((NativeCart.Storage)secure,account,body,response);}else CheckoutIntent.confirmed(secure,account,body);}
                        // Read again so requests added during the network call
                        // remain queued. No UI enqueue waits for the network.
                        JSONArray stored=read(),remaining=new JSONArray();
                        for(int j=0;j<stored.length();j++){JSONObject entry=stored.getJSONObject(j);if(!WalletAuth.canonical(item).equals(WalletAuth.canonical(entry)))remaining.put(entry);}
                        if(expected.nativeV2&&path.endsWith("/transition"))OfflineDraftPhase.confirmed(secure,item);secure.put("offline_mutations",remaining.toString());
                        }
                    }
                    completed++;
                }catch(Exception error){synchronized(secure){if(expected.nativeV2&&item.optString("path").endsWith("/transition"))try{OfflineDraftPhase.unknown(secure,item);}catch(Exception storage){error.addSuppressed(storage);}}break;}
            }
            return completed;
        }finally{synchronized(this){flushing=false;}}
    }
    private JSONArray read() throws Exception{String raw=secure.get("offline_mutations");return raw.isEmpty()?new JSONArray():new JSONArray(raw);}
}

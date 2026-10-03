package com.ynxweb4.shop;

import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

// Encrypted product-local deletion state. Network completion is recorded before
// any Activity/session presentation check. A timeout is never a rejection proof.
final class PrivacyLifecycle {
    interface Storage extends CheckoutIntent.Storage { void putAll(Map<String,String> values) throws Exception; }
    static final String RECORD="privacy_lifecycle_v1";
    static final String ACTIVE="ACTIVE",DRAINING="DRAINING",BLOCKED="BLOCKED_UNKNOWN",SENDING="AWAITING_RECEIPT",UNKNOWN="DELETION_OUTCOME_UNKNOWN",CLEANUP="CONFIRMED_PENDING_CLEANUP",CONFIRMED="CONFIRMED";
    static final class Blocked extends SecurityException { final String phase;Blocked(String phase){super(phase);this.phase=phase;} }
    static final class Ticket {
        final String account,id;final long generation;
        Ticket(String account,String id,long generation){this.account=account;this.id=id;this.generation=generation;}
    }
    private final Storage store;
    PrivacyLifecycle(Storage store) throws Exception {
        this.store=store;
        synchronized(store){
            JSONObject all=read(store);boolean changed=false;
            for(String account:keys(all)){
                JSONObject state=all.getJSONObject(account),requests=state.optJSONObject("requests");
                if(requests!=null)for(String id:keys(requests)){
                    JSONObject request=requests.getJSONObject(id);
                    if("ADMITTED".equals(request.optString("status"))){requests.remove(id);changed=true;}
                    else if("DISPATCHED".equals(request.optString("status"))){request.put("status","UNKNOWN");changed=true;}
                }
                if(SENDING.equals(state.optString("phase"))){state.put("phase",UNKNOWN);changed=true;}
            }
            if(changed)write(all);
            for(String account:keys(all))if(CLEANUP.equals(all.getJSONObject(account).optString("phase")))try{finishCleanup(account);}catch(Exception unavailable){/* Receipt stays durable; this account remains blocked for explicit cleanup retry. */}
        }
    }
    private static List<String> keys(JSONObject object){List<String> result=new ArrayList<>();object.keys().forEachRemaining(result::add);return result;}
    private static JSONObject read(CheckoutIntent.Storage store)throws Exception{String value=store.get(RECORD);return value.isEmpty()?new JSONObject():new JSONObject(value);}
    private void write(JSONObject value)throws Exception{store.put(RECORD,value.toString());store.notifyAll();}
    private static JSONObject state(JSONObject all,String account)throws Exception{
        JSONObject value=all.optJSONObject(account);
        if(value==null){value=new JSONObject().put("phase",ACTIVE).put("generation",0).put("requests",new JSONObject()).put("archives",new JSONArray());all.put(account,value);}
        return value;
    }
    static long requireWritable(CheckoutIntent.Storage store,String account)throws Exception{
        synchronized(store){JSONObject current=state(read(store),account);String phase=current.optString("phase",ACTIVE);if(!ACTIVE.equals(phase))throw new Blocked(phase);return current.optLong("generation");}
    }
    static boolean queueExecutable(CheckoutIntent.Storage store,String account,JSONObject item)throws Exception{
        synchronized(store){JSONObject current=state(read(store),account);if(!ACTIVE.equals(current.optString("phase",ACTIVE)))return false;return item.optLong("privacyGeneration",0)>=current.optLong("retiredBeforeGeneration",0);}
    }
    static boolean writableGeneration(CheckoutIntent.Storage store,String account,long generation)throws Exception{synchronized(store){JSONObject current=state(read(store),account);return ACTIVE.equals(current.optString("phase",ACTIVE))&&current.optLong("generation")==generation;}}
    long generation(String account)throws Exception{synchronized(store){return state(read(store),account).optLong("generation");}}
    boolean current(String account,long generation)throws Exception{synchronized(store){return state(read(store),account).optLong("generation")==generation;}}
    JSONObject snapshot(String account)throws Exception{synchronized(store){return new JSONObject(state(read(store),account).toString());}}
    Ticket admit(String account,String method,String path,JSONObject body)throws Exception{return admit(account,method,path,body,-1);}
    Ticket admit(String account,String method,String path,JSONObject body,long expectedGeneration)throws Exception{
        synchronized(store){
            JSONObject all=read(store),current=state(all,account);if(!ACTIVE.equals(current.optString("phase")))throw new Blocked(current.optString("phase"));
            if(expectedGeneration>=0&&current.optLong("generation")!=expectedGeneration)throw new Blocked(DRAINING);
            String id=UUID.randomUUID().toString();long generation=current.optLong("generation");
            JSONObject request=new JSONObject().put("id",id).put("method",method).put("path",path).put("generation",generation).put("status","ADMITTED").put("createdAt",Instant.now().toString()).put("body",body==null?new JSONObject():new JSONObject(body.toString()));
            current.getJSONObject("requests").put(id,request);write(all);return new Ticket(account,id,generation);
        }
    }
    void dispatch(Ticket ticket)throws Exception{
        synchronized(store){
            JSONObject all=read(store),current=state(all,ticket.account),requests=current.getJSONObject("requests");
            if(!ACTIVE.equals(current.optString("phase"))||current.optLong("generation")!=ticket.generation||!requests.has(ticket.id)){requests.remove(ticket.id);write(all);throw new Blocked(current.optString("phase"));}
            requests.getJSONObject(ticket.id).put("status","DISPATCHED");write(all);
        }
    }
    void notSent(Ticket ticket)throws Exception{if(ticket==null)return;synchronized(store){JSONObject all=read(store),requests=state(all,ticket.account).getJSONObject("requests");JSONObject record=requests.optJSONObject(ticket.id);if(record!=null&&"ADMITTED".equals(record.optString("status"))){requests.remove(ticket.id);write(all);}}}
    void outcome(Ticket ticket,boolean definitive)throws Exception{
        if(ticket==null)return;
        synchronized(store){JSONObject all=read(store),requests=state(all,ticket.account).getJSONObject("requests");JSONObject request=requests.optJSONObject(ticket.id);if(request==null)return;if(definitive)requests.remove(ticket.id);else request.put("status","UNKNOWN");write(all);}
    }
    void begin(String account)throws Exception{
        synchronized(store){
            JSONObject all=read(store),current=state(all,account);String phase=current.optString("phase");
            if(UNKNOWN.equals(phase)||SENDING.equals(phase)||CLEANUP.equals(phase)||CONFIRMED.equals(phase))throw new Blocked(phase);
            if(ACTIVE.equals(phase))current.put("generation",current.optLong("generation")+1);
            current.put("phase",DRAINING);current.remove("reason");JSONObject requests=current.getJSONObject("requests");
            for(String id:keys(requests))if("ADMITTED".equals(requests.getJSONObject(id).optString("status")))requests.remove(id);
            write(all);
        }
    }
    // Null means an unprotected HTTP request is still running. The caller waits
    // on a background worker; it must never infer completion from that wait.
    JSONObject plan(String account)throws Exception{
        synchronized(store){
            JSONObject all=read(store),current=state(all,account);String phase=current.optString("phase");
            if(UNKNOWN.equals(phase)){current.put("phase",SENDING);write(all);return new JSONObject(current.getJSONObject("operation").getJSONObject("request").toString());}
            if(!DRAINING.equals(phase)&&!BLOCKED.equals(phase))throw new Blocked(phase);
            JSONObject requests=current.getJSONObject("requests");TreeMap<String,JSONObject> retired=new TreeMap<>();boolean waiting=false;
            for(String id:keys(requests)){
                JSONObject record=requests.getJSONObject(id);JSONObject entry=retirement(record.optString("method"),record.optString("path"),record.optJSONObject("body"));
                if(entry==null){if("DISPATCHED".equals(record.optString("status"))){waiting=true;continue;}current.put("phase",BLOCKED);write(all);throw new Blocked(BLOCKED);}
                add(retired,entry);
            }
            if(waiting)return null;
            String cartSync=store.get(NativeCart.key(account));if(!cartSync.isEmpty()){JSONObject syncState=new JSONObject(cartSync);if(!account.equals(syncState.optString("account")))throw new Blocked(BLOCKED);JSONObject pending=syncState.optJSONObject("pending");if(pending!=null)add(retired,validated("cart.save",pending.getJSONObject("body").optString("IdempotencyKey")));}
            String checkout=store.get("checkout:"+account);
            if(!checkout.isEmpty()){
                JSONObject saved=new JSONObject(checkout);if(!account.equals(saved.optString("account")))throw new Blocked(BLOCKED);
                add(retired,validated("order.create",saved.optString("key")));
            }
            JSONArray ownQueue=new JSONArray(),queue=queue();
            for(int i=0;i<queue.length();i++){
                JSONObject item=queue.getJSONObject(i);if(!account.equals(item.optString("account")))continue;
                JSONObject entry=retirement(item.optString("method"),item.optString("path"),item.optJSONObject("body"));
                if(entry==null){current.put("phase",BLOCKED);write(all);throw new Blocked(BLOCKED);}
                add(retired,entry);ownQueue.put(new JSONObject(item.toString()));
            }
            if(retired.size()>128){current.put("phase",BLOCKED).put("reason","TOO_MANY");write(all);throw new Blocked("TOO_MANY");}
            JSONArray entries=new JSONArray();for(JSONObject entry:retired.values())entries.put(entry);
            JSONObject request=new JSONObject().put("confirmation","DELETE_MY_SHOP_DATA").put("deletionRequestId",UUID.randomUUID().toString()).put("retiredIntents",entries);
            JSONObject evidence=new JSONObject().put("capturedAt",Instant.now().toString()).put("account",account).put("checkout",checkout).put("cartSync",cartSync).put("queue",ownQueue).put("requests",new JSONObject(requests.toString()));
            current.put("phase",SENDING).put("operation",new JSONObject().put("request",request).put("evidence",evidence));write(all);
            return new JSONObject(request.toString());
        }
    }
    void waitForChanges(long millis)throws InterruptedException{synchronized(store){store.wait(millis);}}
    void markUnknown(String account,JSONObject request)throws Exception{
        synchronized(store){JSONObject all=read(store),current=state(all,account);if(matches(current,request)&&(SENDING.equals(current.optString("phase"))||UNKNOWN.equals(current.optString("phase")))){current.put("phase",UNKNOWN);write(all);}}
    }
    void rejected(String account,JSONObject request)throws Exception{
        synchronized(store){JSONObject all=read(store),current=state(all,account);if(!matches(current,request))return;
            // Keep the rejected attempt as evidence; a definite rejection has
            // not deleted the old data or retired the old purchase intents.
            JSONObject attempt=current.getJSONObject("operation");attempt.put("result","REJECTED");current.getJSONArray("archives").put(attempt);current.remove("operation");current.put("phase",ACTIVE);write(all);
        }
    }
    void confirm(String account,JSONObject request,JSONObject receipt)throws Exception{
        synchronized(store){
            JSONObject all=read(store),current=state(all,account);if(!matches(current,request))throw new SecurityException("Deletion operation changed");
            if(CLEANUP.equals(current.optString("phase"))){finishCleanup(account);return;}
            if(receipt.optInt("retiredIntentsVersion",-1)!=1||receipt.optInt("retiredIntentsCount",-1)!=request.getJSONArray("retiredIntents").length()||!request.getString("deletionRequestId").equals(receipt.optString("deletionRequestId"))||receipt.optString("receiptId").isBlank()){
                current.put("phase",UNKNOWN);write(all);throw new Blocked("INVALID_RECEIPT");
            }
            current.getJSONObject("operation").put("receipt",new JSONObject(receipt.toString()));current.put("phase",CLEANUP).put("generation",current.optLong("generation")+1);write(all);
            finishCleanup(account);
        }
    }
    void finishCleanup(String account)throws Exception{
        synchronized(store){
            JSONObject all=read(store),current=state(all,account);if(!CLEANUP.equals(current.optString("phase")))return;
            JSONObject operation=current.getJSONObject("operation");JSONArray original=operation.getJSONObject("evidence").getJSONArray("queue"),remaining=new JSONArray(),queue=queue();
            Set<String> frozen=new HashSet<>();for(int i=0;i<original.length();i++)frozen.add(WalletAuth.canonical(original.get(i)));
            for(int i=0;i<queue.length();i++){JSONObject item=queue.getJSONObject(i);if(!account.equals(item.optString("account"))||!frozen.contains(WalletAuth.canonical(item)))remaining.put(item);}
            current.getJSONArray("archives").put(operation);current.remove("operation");current.put("requests",new JSONObject()).put("phase",CONFIRMED).put("retiredBeforeGeneration",current.optLong("generation")+1);
            Map<String,String> updates=new LinkedHashMap<>();updates.put(RECORD,all.toString());updates.put("offline_mutations",remaining.toString());updates.put("checkout:"+account,"");updates.put("cart:"+account,"[]");updates.put(NativeCart.key(account),"");store.putAll(updates);store.notifyAll();
        }
    }
    void startNewShopping(String account)throws Exception{synchronized(store){JSONObject all=read(store),current=state(all,account);if(!CONFIRMED.equals(current.optString("phase")))throw new Blocked(current.optString("phase"));current.put("generation",current.optLong("generation")+1).put("phase",ACTIVE);write(all);}}
    private JSONArray queue()throws Exception{String raw=store.get("offline_mutations");return raw.isEmpty()?new JSONArray():new JSONArray(raw);}
    private static boolean matches(JSONObject current,JSONObject request)throws Exception{JSONObject operation=current.optJSONObject("operation");return operation!=null&&WalletAuth.canonical(operation.getJSONObject("request")).equals(WalletAuth.canonical(request));}
    private static void add(Map<String,JSONObject> values,JSONObject entry)throws Exception{values.put(entry.getString("route")+"\u0000"+entry.getString("key"),entry);}
    private static JSONObject validated(String route,String key)throws Exception{
        int length=key.getBytes(StandardCharsets.UTF_8).length;if(length<8||length>128)throw new Blocked(BLOCKED);
        return new JSONObject().put("route",route).put("key",key);
    }
    private static JSONObject retirement(String method,String path,JSONObject body)throws Exception{
        if(body==null)return null;
        if("PUT".equals(method)&&"/cart".equals(path)){try{return validated("cart.save",body.optString("IdempotencyKey"));}catch(Blocked invalid){return null;}}
        if(!"POST".equals(method))return null;String route;
        if("/orders".equals(path))route="order.create";
        else if(path.matches("/orders/order_[a-f0-9]{24}/transition"))route="order.transition."+path.split("/")[2];
        else if("/ai/jobs".equals(path))route="ai.create";
        else return null;
        try{return validated(route,body.optString("IdempotencyKey"));}catch(Blocked invalid){return null;}
    }
}

package com.ynxweb4.shop;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

// One account's encrypted local draft and its exact remote CAS write. Network
// calls run outside the storage monitor; every commit rechecks session/privacy.
final class NativeCart {
    interface Storage extends PrivacyLifecycle.Storage {}
    interface Sender { ProductSession session()throws Exception; JSONObject request(String method,String path,JSONObject body,ProductSession expected,long generation)throws Exception; }
    static final class Conflict extends Exception {
        final JSONObject remote;final String localStamp;
        Conflict(JSONObject remote,String stamp)throws Exception{super("CART_SYNC_CONFLICT");this.remote=new JSONObject(remote.toString());localStamp=stamp;}
    }
    static String key(String account){return "cart_sync:"+account;}
    private static JSONObject state(Storage store,String account)throws Exception{
        String raw=store.get(key(account));JSONObject state=raw.isEmpty()?new JSONObject().put("account",account).put("ready",false).put("dirty",false).put("stamp",UUID.randomUUID().toString()).put("history",new JSONArray()):new JSONObject(raw);
        if(!account.equals(state.getString("account")))throw new SecurityException("Foreign cart state");return state;
    }
    private static JSONArray items(Storage store,String account)throws Exception{String raw=store.get("cart:"+account);return raw.isEmpty()?new JSONArray():new JSONArray(raw);}
    private static boolean same(Object a,Object b)throws Exception{return a==null||b==null?a==b:WalletAuth.canonical(a).equals(WalletAuth.canonical(b));}
    static boolean checkoutRecoveryRequired(Storage store,String account)throws Exception{
        synchronized(store){String raw=store.get("checkout:"+account);if(raw.isEmpty())return false;JSONObject saved=new JSONObject(raw);if(!account.equals(saved.getString("account")))throw new SecurityException("Foreign checkout intent");return !"prepared".equals(saved.optString("phase"));}
    }
    private static void requireEditable(Storage store,String account)throws Exception{if(checkoutRecoveryRequired(store,account))throw new CheckoutIntent.UnresolvedException();}
    private static void current(Storage store,Sender sender,ProductSession expected,long generation)throws Exception{
        if(expected==null||!expected.same(sender.session())||!PrivacyLifecycle.writableGeneration(store,expected.account,generation))throw new SecurityException("Cart session or privacy generation changed");
        requireEditable(store,expected.account);
    }
    private static void receipt(JSONObject value,String account)throws Exception{
        if(!BuyerReceipt.owned(value,account)||!value.has("Revision")||value.isNull("Revision")||!(value.get("Revision") instanceof String))throw new SecurityException("Invalid cart receipt");
        if(value.optJSONArray("Items")==null)value.put("Items",new JSONArray());
    }
    static void edit(Storage store,String account,JSONArray next)throws Exception{
        synchronized(store){PrivacyLifecycle.requireWritable(store,account);requireEditable(store,account);JSONObject state=state(store,account);state.put("stamp",UUID.randomUUID().toString()).put("dirty",true);store.putAll(Map.of("cart:"+account,next.toString(),key(account),state.toString()));}
    }
    // Repeated or restarted sends use the same immutable body/key. The receipt
    // records the original write, while refresh separately reads today's cart.
    private static void finishPending(Storage store,Sender sender,ProductSession expected,long generation)throws Exception{
        final JSONObject pending;
        synchronized(store){current(store,sender,expected,generation);JSONObject value=state(store,expected.account).optJSONObject("pending");if(value==null)return;pending=new JSONObject(value.toString());}
        JSONObject result;
        try{result=sender.request("PUT","/cart",pending.getJSONObject("body"),expected,generation);}
        catch(ApiClient.ApiException error){
            if("CART_REVISION_CONFLICT".equals(error.code))synchronized(store){current(store,sender,expected,generation);JSONObject state=state(store,expected.account);if(same(state.optJSONObject("pending"),pending)){pending.put("rejection",error.code);state.getJSONArray("history").put(pending);state.remove("pending");store.put(key(expected.account),state.toString());}}
            throw error;
        }
        receipt(result,expected.account);
        if(result.getString("Revision").isEmpty()||!same(result.getJSONArray("Items"),pending.getJSONObject("body").getJSONArray("Items")))throw new SecurityException("Cart receipt does not match saved write");
        synchronized(store){
            current(store,sender,expected,generation);JSONObject state=state(store,expected.account);
            if(!same(state.optJSONObject("pending"),pending))return;
            state.put("ready",true).put("revision",result.getString("Revision")).put("base",result.getJSONArray("Items"));state.remove("pending");
            state.put("dirty",!pending.getString("stamp").equals(state.getString("stamp"))||!same(items(store,expected.account),result.getJSONArray("Items")));
            store.put(key(expected.account),state.toString());
        }
    }
    static JSONObject refresh(Storage store,Sender sender,ProductSession expected,long generation)throws Exception{
        finishPending(store,sender,expected,generation);
        synchronized(store){current(store,sender,expected,generation);}
        JSONObject remote=sender.request("GET","/cart",null,expected,generation);receipt(remote,expected.account);
        synchronized(store){
            current(store,sender,expected,generation);JSONObject state=state(store,expected.account);JSONArray local=items(store,expected.account);
            boolean dirty=state.optBoolean("dirty"),ready=state.optBoolean("ready");
            if(state.has("pending"))throw new SecurityException("Another cart write is pending");
            if((ready&&dirty&&!remote.getString("Revision").equals(state.optString("revision")))||(!ready&&(dirty||local.length()>0)&&!same(local,remote.getJSONArray("Items")))){store.put(key(expected.account),state.toString());throw new Conflict(remote,state.getString("stamp"));}
            if(!ready||!dirty){state.put("ready",true).put("dirty",false).put("revision",remote.getString("Revision")).put("base",remote.getJSONArray("Items"));store.putAll(Map.of("cart:"+expected.account,remote.getJSONArray("Items").toString(),key(expected.account),state.toString()));}
            return remote;
        }
    }
    static void sync(Storage store,Sender sender,ProductSession expected,long generation)throws Exception{
        refresh(store,sender,expected,generation);
        synchronized(store){
            current(store,sender,expected,generation);JSONObject state=state(store,expected.account);if(!state.optBoolean("dirty"))return;
            if(state.has("pending"))throw new SecurityException("Another cart write is pending");
            JSONObject body=new JSONObject().put("Items",items(store,expected.account)).put("ExpectedRevision",state.getString("revision")).put("IdempotencyKey",UUID.randomUUID().toString());
            state.put("pending",new JSONObject().put("body",body).put("stamp",state.getString("stamp")).put("createdAt",Instant.now().toString()));store.put(key(expected.account),state.toString());
        }
        finishPending(store,sender,expected,generation);refresh(store,sender,expected,generation);
    }
    static void resolve(Storage store,Sender sender,ProductSession expected,long generation,Conflict conflict,boolean useRemote)throws Exception{
        synchronized(store){
            current(store,sender,expected,generation);JSONObject state=state(store,expected.account);if(!conflict.localStamp.equals(state.getString("stamp"))||state.has("pending"))throw new SecurityException("Cart changed during review");
            state.getJSONArray("history").put(new JSONObject().put("local",items(store,expected.account)).put("remote",conflict.remote).put("choice",useRemote?"remote":"local").put("at",Instant.now().toString()));
            state.put("ready",true).put("revision",conflict.remote.getString("Revision")).put("base",conflict.remote.getJSONArray("Items")).put("dirty",!useRemote);
            if(useRemote)state.put("stamp",UUID.randomUUID().toString());
            store.putAll(useRemote?Map.of("cart:"+expected.account,conflict.remote.getJSONArray("Items").toString(),key(expected.account),state.toString()):Map.of(key(expected.account),state.toString()));
        }
        if(!useRemote)sync(store,sender,expected,generation);
    }
    static String checkoutRevision(Storage store,String account)throws Exception{
        synchronized(store){JSONObject state=state(store,account);if(!state.optBoolean("ready")||state.optBoolean("dirty")||state.has("pending")||!same(items(store,account),state.optJSONArray("base")))throw new IllegalStateException("CART_SYNC_REQUIRED");return state.getString("revision");}
    }
}

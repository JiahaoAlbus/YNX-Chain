package com.ynxweb4.shop;
import org.junit.Test;
import org.json.*;
import java.time.Instant;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

public final class NativeCartTest {
    static final String A=PrivacyLifecycleTest.A,B=PrivacyLifecycleTest.B;
    static final class Memory extends PrivacyLifecycleTest.Memory implements NativeCart.Storage {
        boolean failSync;
        @Override public void put(String key,String value){if(failSync&&key.startsWith("cart_sync:"))throw new IllegalStateException("cart key commit failed");super.put(key,value);}
    }
    static JSONArray items(int quantity)throws Exception{return quantity==0?new JSONArray():new JSONArray().put(new JSONObject().put("ProductID","p").put("VariantID","v").put("Quantity",quantity));}
    static final class Server implements NativeCart.Sender {
        final Memory store;JSONArray cloud=new JSONArray();String revision="";int updates,sequence;boolean loseNext;Runnable afterPut;final List<JSONObject> sent=new ArrayList<>();final Map<String,JSONObject> receipts=new HashMap<>();
        Server(Memory store){this.store=store;}
        public ProductSession session()throws Exception{return ProductSession.parse(store.get("commerce_session"),Instant.now());}
        synchronized JSONObject value()throws Exception{return new JSONObject().put("Buyer",A).put("Revision",revision).put("Items",new JSONArray(cloud.toString()));}
        public synchronized JSONObject request(String method,String path,JSONObject body,ProductSession expected,long generation)throws Exception{
            if(method.equals("GET"))return value();
            JSONObject copy=new JSONObject(body.toString());sent.add(copy);String key=body.getString("IdempotencyKey");JSONObject existing=receipts.get(key);
            if(existing!=null)return new JSONObject(existing.toString());
            if(!revision.equals(body.getString("ExpectedRevision")))throw new ApiClient.ApiException(409,"cart changed","CART_REVISION_CONFLICT");
            cloud=new JSONArray(body.getJSONArray("Items").toString());revision="r"+(++sequence);updates++;JSONObject result=value();receipts.put(key,new JSONObject(result.toString()));
            if(afterPut!=null)afterPut.run();if(loseNext){loseNext=false;throw new IOException("response lost after commit");}return result;
        }
        synchronized void otherDevice(int quantity)throws Exception{cloud=items(quantity);revision="r"+(++sequence);}
    }
    private Memory memory()throws Exception{Memory store=new Memory();store.login(A);return store;}
    private ProductSession session(Memory store)throws Exception{return ProductSession.parse(store.get("commerce_session"),Instant.now());}
    @Test public void lostReplyRestartResendsSameKeyWithoutOverwritingLaterRemoteEdit()throws Exception{
        Memory store=memory();Server server=new Server(store);ProductSession expected=session(store);NativeCart.refresh(store,server,expected,0);NativeCart.edit(store,A,items(1));server.loseNext=true;
        assertThrows(IOException.class,()->NativeCart.sync(store,server,expected,0));String preserved=store.get(NativeCart.key(A));assertTrue(new JSONObject(preserved).has("pending"));server.otherDevice(3);
        NativeCart.sync(store,server,expected,0);assertEquals(1,server.updates);assertEquals(2,server.sent.size());assertEquals(WalletAuth.canonical(server.sent.get(0)),WalletAuth.canonical(server.sent.get(1)));assertEquals(3,new JSONArray(store.get("cart:"+A)).getJSONObject(0).getInt("Quantity"));assertFalse(new JSONObject(store.get(NativeCart.key(A))).has("pending"));
    }
    @Test public void inheritedOrOfflineConflictRequiresExplicitChoiceAndArchivesBothVersions()throws Exception{
        Memory store=memory();store.put("cart:"+A,items(1).toString());Server server=new Server(store);server.otherDevice(2);ProductSession expected=session(store);
        NativeCart.Conflict conflict=assertThrows(NativeCart.Conflict.class,()->NativeCart.refresh(store,server,expected,0));assertEquals(0,server.updates);assertEquals(1,new JSONArray(store.get("cart:"+A)).getJSONObject(0).getInt("Quantity"));
        NativeCart.resolve(store,server,expected,0,conflict,true);assertEquals(2,new JSONArray(store.get("cart:"+A)).getJSONObject(0).getInt("Quantity"));JSONObject state=new JSONObject(store.get(NativeCart.key(A)));assertEquals(1,state.getJSONArray("history").length());assertEquals(1,state.getJSONArray("history").getJSONObject(0).getJSONArray("local").getJSONObject(0).getInt("Quantity"));
        NativeCart.edit(store,A,items(4));server.otherDevice(3);NativeCart.Conflict second=assertThrows(NativeCart.Conflict.class,()->NativeCart.sync(store,server,expected,0));NativeCart.resolve(store,server,expected,0,second,false);assertEquals(4,server.cloud.getJSONObject(0).getInt("Quantity"));assertEquals(1,server.updates);
    }
    @Test public void offlineEmptyDraftStillRequiresReviewOfExistingRemoteCart()throws Exception{
        Memory store=memory();NativeCart.edit(store,A,new JSONArray());Server server=new Server(store);server.otherDevice(2);ProductSession expected=session(store);
        NativeCart.Conflict conflict=assertThrows(NativeCart.Conflict.class,()->NativeCart.refresh(store,server,expected,0));assertEquals("[]",store.get("cart:"+A));assertEquals(0,server.updates);
        NativeCart.resolve(store,server,expected,0,conflict,false);assertEquals(0,server.cloud.length());assertEquals(1,server.updates);
    }
    @Test public void editDuringNetworkAndStaleReviewNeverLoseDraft()throws Exception{
        Memory store=memory();Server server=new Server(store);ProductSession expected=session(store);NativeCart.refresh(store,server,expected,0);NativeCart.edit(store,A,items(1));server.afterPut=()->{try{NativeCart.edit(store,A,items(2));}catch(Exception error){throw new RuntimeException(error);}};
        NativeCart.sync(store,server,expected,0);assertEquals(2,new JSONArray(store.get("cart:"+A)).getJSONObject(0).getInt("Quantity"));assertTrue(new JSONObject(store.get(NativeCart.key(A))).getBoolean("dirty"));
        server.otherDevice(3);NativeCart.Conflict conflict=assertThrows(NativeCart.Conflict.class,()->NativeCart.refresh(store,server,expected,0));NativeCart.edit(store,A,items(5));assertThrows(SecurityException.class,()->NativeCart.resolve(store,server,expected,0,conflict,true));assertEquals(5,new JSONArray(store.get("cart:"+A)).getJSONObject(0).getInt("Quantity"));
    }
    @Test public void failedIntentStorageCannotSendAndAccountSwitchCannotPublishReceipt()throws Exception{
        Memory store=memory();Server server=new Server(store);ProductSession expected=session(store);NativeCart.refresh(store,server,expected,0);NativeCart.edit(store,A,items(1));store.failSync=true;
        assertThrows(IllegalStateException.class,()->NativeCart.sync(store,server,expected,0));assertEquals(0,server.updates);store.failSync=false;
        server.afterPut=()->{try{store.login(B);}catch(Exception error){throw new RuntimeException(error);}};assertThrows(SecurityException.class,()->NativeCart.sync(store,server,expected,0));assertTrue(new JSONObject(store.get(NativeCart.key(A))).has("pending"));assertEquals("",store.get("cart:"+B));
    }
    @Test public void newCheckoutCarriesRevisionAndReceiptDoesNotEraseIdenticalReaddedDraft()throws Exception{
        Memory store=memory();Server server=new Server(store);ProductSession expected=session(store);NativeCart.refresh(store,server,expected,0);NativeCart.edit(store,A,items(1));NativeCart.sync(store,server,expected,0);
        JSONObject address=new JSONObject().put("Line1","address");CheckoutIntent.Prepared prepared=CheckoutIntent.prepareSyncedCart(store,BuyerJourneyTest.session("a".repeat(64)),address,id->"shop");assertEquals(server.revision,prepared.body.getString("CartRevision"));
        NativeCart.edit(store,A,items(1));JSONObject order=new JSONObject().put("Buyer",A).put("ID","order").put("CartConsumption",new JSONObject().put("PreviousRevision",prepared.body.getString("CartRevision")).put("Revision","consumed"));assertFalse(CheckoutIntent.confirmedReceipt(store,A,prepared.body,order));assertEquals(1,new JSONArray(store.get("cart:"+A)).length());assertEquals("",store.get("checkout:"+A));
    }
    @Test public void unresolvedCheckoutCannotRotateKeyOrAcceptForeignReceipt()throws Exception{
        Memory store=memory();Server server=new Server(store);ProductSession expected=session(store);NativeCart.refresh(store,server,expected,0);NativeCart.edit(store,A,items(1));NativeCart.sync(store,server,expected,0);
        JSONObject shipping=new JSONObject().put("Line1","old");CheckoutIntent.Prepared prepared=CheckoutIntent.prepareSyncedCart(store,shipping,id->"shop");String saved=store.get("checkout:"+A);
        assertThrows(CheckoutIntent.UnresolvedException.class,()->CheckoutIntent.prepareSyncedCart(store,new JSONObject().put("Line1","new"),id->"shop"));assertEquals(saved,store.get("checkout:"+A));assertEquals(prepared.body.getString("IdempotencyKey"),CheckoutIntent.prepareSyncedCart(store,shipping,id->"shop").body.getString("IdempotencyKey"));
        assertThrows(SecurityException.class,()->CheckoutIntent.confirmedReceipt(store,A,prepared.body,new JSONObject().put("Buyer",B).put("ID","foreign")));assertEquals(saved,store.get("checkout:"+A));
    }
    @Test public void receiptStorageFailureRetainsCartIntentAndSyncStateTogether()throws Exception{
        Memory store=memory();Server server=new Server(store);ProductSession expected=session(store);NativeCart.refresh(store,server,expected,0);NativeCart.edit(store,A,items(1));NativeCart.sync(store,server,expected,0);
        CheckoutIntent.Prepared prepared=CheckoutIntent.prepareSyncedCart(store,new JSONObject().put("Line1","address"),id->"shop");
        JSONObject receipt=new JSONObject().put("Buyer",A).put("ID","order").put("CartConsumption",new JSONObject().put("PreviousRevision",prepared.body.getString("CartRevision")).put("Revision","consumed"));
        Map<String,String> before=new HashMap<>(store.values);store.failBatch=true;
        assertThrows(IOException.class,()->CheckoutIntent.confirmedReceipt(store,A,prepared.body,receipt));assertEquals(before,store.values);
        store.failBatch=false;assertTrue(CheckoutIntent.confirmedReceipt(store,A,prepared.body,receipt));assertEquals("[]",store.get("cart:"+A));assertEquals("",store.get("checkout:"+A));assertFalse(new JSONObject(store.get(NativeCart.key(A))).getBoolean("ready"));
    }
    @Test public void deletionSealsUnknownCartAndArchivesStateWhilePreservingForeignAccount()throws Exception{
        Memory store=memory();Server server=new Server(store);ProductSession expected=session(store);NativeCart.refresh(store,server,expected,0);NativeCart.edit(store,A,items(1));server.loseNext=true;assertThrows(IOException.class,()->NativeCart.sync(store,server,expected,0));store.put(NativeCart.key(B),"foreign preserved");
        PrivacyLifecycle lifecycle=new PrivacyLifecycle(store);lifecycle.begin(A);JSONObject request=lifecycle.plan(A);assertEquals("cart.save",request.getJSONArray("retiredIntents").getJSONObject(0).getString("route"));
        lifecycle.confirm(A,request,new JSONObject().put("receiptId","receipt").put("deletionRequestId",request.getString("deletionRequestId")).put("retiredIntentsVersion",1).put("retiredIntentsCount",1));assertEquals("",store.get(NativeCart.key(A)));assertEquals("foreign preserved",store.get(NativeCart.key(B)));assertTrue(lifecycle.snapshot(A).getJSONArray("archives").toString().contains("cartSync"));
    }
}

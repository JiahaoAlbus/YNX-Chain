package com.ynxweb4.shop;

import org.json.JSONObject;
import org.json.JSONArray;
import java.time.Instant;
import java.util.UUID;

// A lost response does not create a new purchase intent. Persist this record in
// the account's encrypted product storage before sending or queuing checkout.
final class CheckoutIntent {
    interface Storage { String get(String key) throws Exception; void put(String key,String value) throws Exception; }
    interface StoreResolver { String storeFor(String productID) throws Exception; }
    static final class Prepared {
        final ProductSession session;
        final JSONObject body;
        private Prepared(ProductSession session,JSONObject body){this.session=session;this.body=body;}
    }
    static final class EmptyCartException extends IllegalStateException {}
    final String key, serialized;
    private CheckoutIntent(String key, String serialized) { this.key=key;this.serialized=serialized; }
    // Capture and persist under the same monitor used by confirmation. An old
    // acknowledgement cannot erase its key between cart capture and retry.
    static Prepared prepareCart(Storage store,JSONObject address,StoreResolver catalog) throws Exception {
        synchronized(store){
            ProductSession session=ProductSession.parse(store.get("commerce_session"),Instant.now());
            if(session==null)throw new SecurityException("Active Shop account required");
            String cartText=store.get("cart:"+session.account);
            JSONArray items=cartText.isEmpty()?new JSONArray():new JSONArray(cartText);
            if(items.length()==0)throw new EmptyCartException();
            JSONObject body=new JSONObject().put("StoreID",catalog.storeFor(items.getJSONObject(0).getString("ProductID"))).put("Items",items).put("Address",new JSONObject(address.toString()));
            String storageKey="checkout:"+session.account;
            CheckoutIntent intent=prepare(session.account,body,store.get(storageKey));
            store.put(storageKey,intent.serialized);body.put("IdempotencyKey",intent.key);
            return new Prepared(session,body);
        }
    }
    static CheckoutIntent prepare(String account, JSONObject body, String previous) throws Exception {
        if (!account.matches("ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}")) throw new SecurityException("Active Shop account required");
        JSONObject intent = new JSONObject(body.toString());intent.remove("IdempotencyKey");
        String fingerprint = WalletAuth.canonical(intent), key = "";
        if (!previous.isEmpty()) {
            JSONObject saved = new JSONObject(previous);
            if (!account.equals(saved.getString("account"))) throw new SecurityException("Checkout intent belongs to another account");
            if (fingerprint.equals(saved.getString("fingerprint"))) key = saved.getString("key");
        }
        if (key.isEmpty()) key = UUID.randomUUID().toString();
        return new CheckoutIntent(key,new JSONObject().put("account",account).put("fingerprint",fingerprint).put("key",key).toString());
    }
    // A confirmed retry may finish after the buyer edits the cart or starts a
    // different checkout. Clear only the exact persisted intent and its cart.
    static boolean confirmed(Storage store,String account,JSONObject request) throws Exception {
        synchronized(store) {
            String intentKey="checkout:"+account, raw=store.get(intentKey);
            if(raw.isEmpty())return false;
            JSONObject saved=new JSONObject(raw),body=new JSONObject(request.toString());
            String key=body.optString("IdempotencyKey");body.remove("IdempotencyKey");
            if(!account.equals(saved.optString("account"))||key.isEmpty()||!key.equals(saved.optString("key"))||!WalletAuth.canonical(body).equals(saved.optString("fingerprint")))return false;
            String cartKey="cart:"+account,cart=store.get(cartKey);boolean cleared=false;
            if(!cart.isEmpty()&&body.optJSONArray("Items")!=null&&WalletAuth.canonical(new org.json.JSONArray(cart)).equals(WalletAuth.canonical(body.getJSONArray("Items")))) {
                store.put(cartKey,"[]");cleared=true;
            }
            // Cart first: a failed write or process exit must retain the old
            // idempotency key while any purchased cart can still be retried.
            store.put(intentKey,"");return cleared;
        }
    }
}

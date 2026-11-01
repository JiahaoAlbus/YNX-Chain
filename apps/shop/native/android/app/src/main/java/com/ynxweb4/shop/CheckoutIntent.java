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
    static final class UnresolvedException extends IllegalStateException { UnresolvedException(){super("CHECKOUT_UNRESOLVED");} }
    // No dependency on the Activity's filtered/possibly not-yet-loaded catalog.
    // Reads cannot reserve inventory; the original server checkout remains atomic.
    static Prepared prepareQueriedCart(NativeCart.Storage store,NativeCart.Sender sender,ProductSession expected,long generation,JSONObject address)throws Exception{
        final String cartText,metadata,previous;
        synchronized(store){
            requireCurrent(store,sender,expected,generation);
            cartText=store.get("cart:"+expected.account);metadata=store.get(NativeCart.key(expected.account));previous=store.get("checkout:"+expected.account);
            NativeCart.checkoutRevision(store,expected.account);
            if(!previous.isEmpty()&&!"prepared".equals(new JSONObject(previous).optString("phase")))throw new UnresolvedException();
        }
        JSONArray items=new JSONArray(cartText);if(items.length()==0)throw new EmptyCartException();if(items.length()>100)throw new SecurityException("Cart too large");
        java.util.Map<String,String> stores=new java.util.HashMap<>();java.util.Map<String,JSONObject> products=new java.util.HashMap<>();java.util.Set<String> pairs=new java.util.HashSet<>();String selected=null;
        for(int i=0;i<items.length();i++){
            requireCurrent(store,sender,expected,generation);JSONObject item=items.getJSONObject(i);String id=item.getString("ProductID"),variantID=item.getString("VariantID");long qty=cartInteger(item,"Quantity");
            if(!id.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")||!variantID.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")||qty<1||qty>20||!pairs.add(id.length()+":"+id+variantID.length()+":"+variantID))throw new SecurityException("Invalid cart row");
            JSONObject product=products.get(id);if(product==null){product=sender.request("GET","/products/"+id,null,expected,generation);requireCurrent(store,sender,expected,generation);products.put(id,product);}
            String merchant=product.getString("StoreID");if(!id.equals(product.getString("ID"))||!merchant.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")||(selected!=null&&!selected.equals(merchant)))throw new SecurityException("One original store required");
            JSONArray variants=product.getJSONArray("Variants");int matches=0;for(int j=0;j<variants.length();j++){JSONObject v=variants.getJSONObject(j);if(variantID.equals(v.getString("ID"))){matches++;long inventory=cartInteger(v,"Inventory"),reserved=v.has("Reserved")?cartInteger(v,"Reserved"):0;if(cartInteger(v,"PriceYNXT")<=0||reserved<0||inventory<reserved||inventory-reserved<qty)throw new SecurityException("Original SKU unavailable");}}
            if(matches!=1)throw new SecurityException("Original SKU missing or ambiguous");selected=merchant;stores.put(id,merchant);
        }
        synchronized(store){
            requireCurrent(store,sender,expected,generation);
            if(!cartText.equals(store.get("cart:"+expected.account))||!metadata.equals(store.get(NativeCart.key(expected.account)))||!previous.equals(store.get("checkout:"+expected.account)))throw new SecurityException("Cart changed during listing read");
            return prepareSyncedCart(store,expected,address,stores::get);
        }
    }
    private static void requireCurrent(NativeCart.Storage store,NativeCart.Sender sender,ProductSession expected,long generation)throws Exception{
        if(expected==null||!expected.nativeV2||!expected.same(sender.session())||!PrivacyLifecycle.writableGeneration(store,expected.account,generation))throw new SecurityException("Original Native checkout context changed");
    }
    private static long cartInteger(JSONObject value,String key)throws Exception{Object n=value.get(key);if(!(n instanceof Integer)&&!(n instanceof Long))throw new SecurityException("Exact original integer required");return ((Number)n).longValue();}
    static Prepared prepareSyncedCart(NativeCart.Storage store,JSONObject address,StoreResolver catalog)throws Exception{
 return prepareSyncedCartInternal(store,ProductSession.parse(store.get("commerce_session"),Instant.now()),address,catalog,false);
 }
 static Prepared prepareSyncedCart(NativeCart.Storage store,ProductSession session,JSONObject address,StoreResolver catalog)throws Exception{
 if(session==null||!session.nativeV2||!session.expiresAt.isAfter(Instant.now()))throw new SecurityException("Current verified Native session required");
 return prepareSyncedCartInternal(store,session,address,catalog,true);
 }
 private static Prepared prepareSyncedCartInternal(NativeCart.Storage store,ProductSession session,JSONObject address,StoreResolver catalog,boolean nativeOnly)throws Exception{
      synchronized(store){
        if(session==null)throw new SecurityException("Active Shop account required");PrivacyLifecycle.requireWritable(store,session.account);
        JSONArray items=new JSONArray(store.get("cart:"+session.account));if(items.length()==0)throw new EmptyCartException();
        String merchant=catalog.storeFor(items.getJSONObject(0).getString("ProductID"));if(merchant==null||merchant.isEmpty())throw new SecurityException("Missing original store");for(int i=1;i<items.length();i++)if(!merchant.equals(catalog.storeFor(items.getJSONObject(i).getString("ProductID"))))throw new SecurityException("One original store required");
        String key="checkout:"+session.account,previous=store.get(key);JSONObject body=new JSONObject().put("StoreID",merchant).put("Items",items).put("Address",new JSONObject(address.toString()));
        if(previous.isEmpty())body.put("CartRevision",NativeCart.checkoutRevision(store,session.account));
        else{JSONObject saved=new JSONObject(previous);if(nativeOnly&&!"prepared".equals(saved.optString("phase")))throw new UnresolvedException();JSONObject original=new JSONObject(saved.getString("fingerprint"));if(!original.has("CartRevision"))throw new UnresolvedException();body.put("CartRevision",original.getString("CartRevision"));if(!WalletAuth.canonical(body).equals(saved.getString("fingerprint")))throw new UnresolvedException();}
        CheckoutIntent intent=prepare(session.account,body,previous);JSONObject saved=new JSONObject(intent.serialized);if(previous.isEmpty())saved.put("cartStamp",new JSONObject(store.get(NativeCart.key(session.account))).getString("stamp"));else if(new JSONObject(previous).has("cartStamp"))saved.put("cartStamp",new JSONObject(previous).getString("cartStamp"));
        if(nativeOnly)saved.put("phase","prepared");store.put(key,saved.toString());if(!saved.toString().equals(store.get(key)))throw new SecurityException("Checkout intent write/readback failed");body.put("IdempotencyKey",intent.key);return new Prepared(session,body);
      }
    }
    static boolean confirmedReceipt(NativeCart.Storage store,String account,JSONObject request,JSONObject order)throws Exception{
      if(!BuyerReceipt.owned(order,account)||order.optString("ID").isEmpty())throw new SecurityException("Invalid order receipt");
      if(request.has("CartRevision")){JSONObject consumed=order.optJSONObject("CartConsumption");if(consumed==null||!request.getString("CartRevision").equals(consumed.optString("PreviousRevision"))||consumed.optString("Revision").isEmpty())throw new SecurityException("Mismatched cart consumption receipt");}
      synchronized(store){
        String intentKey="checkout:"+account,raw=store.get(intentKey);if(raw.isEmpty())return false;
        JSONObject saved=new JSONObject(raw),body=new JSONObject(request.toString());String intent=body.optString("IdempotencyKey");body.remove("IdempotencyKey");
        if(!account.equals(saved.optString("account"))||intent.isEmpty()||!intent.equals(saved.optString("key"))||!WalletAuth.canonical(body).equals(saved.optString("fingerprint")))return false;
        String cartKey="cart:"+account,cart=store.get(cartKey),metadata=store.get(NativeCart.key(account));JSONObject state=metadata.isEmpty()?null:new JSONObject(metadata);
        boolean sameStamp=!saved.has("cartStamp")||(state!=null&&saved.getString("cartStamp").equals(state.optString("stamp")));
        boolean cleared=sameStamp&&!cart.isEmpty()&&body.optJSONArray("Items")!=null&&WalletAuth.canonical(new JSONArray(cart)).equals(WalletAuth.canonical(body.getJSONArray("Items")));
        java.util.Map<String,String> updates=new java.util.HashMap<>();updates.put(intentKey,"");if(cleared)updates.put(cartKey,"[]");
        if(state!=null){state.put("ready",false).put("dirty",!cleared);updates.put(NativeCart.key(account),state.toString());}
        // One durable commit keeps acknowledgement and recovery state consistent.
        store.putAll(updates);return cleared;
      }
    }
    static void markDispatched(NativeCart.Storage store,ProductSession session,JSONObject request)throws Exception{
      synchronized(store){PrivacyLifecycle.requireWritable(store,session.account);String key="checkout:"+session.account,raw=store.get(key);JSONObject saved=new JSONObject(raw),body=new JSONObject(request.toString());String id=body.getString("IdempotencyKey");body.remove("IdempotencyKey");if(!session.nativeV2||!session.expiresAt.isAfter(Instant.now())||!session.account.equals(saved.getString("account"))||!id.equals(saved.getString("key"))||!WalletAuth.canonical(body).equals(saved.getString("fingerprint"))||!"prepared".equals(saved.optString("phase")))throw new SecurityException("Original unsent checkout required");saved.put("phase","unknown");store.put(key,saved.toString());if(!saved.toString().equals(store.get(key)))throw new SecurityException("Original checkout dispatch could not be saved");}
    }
    final String key, serialized;
    private CheckoutIntent(String key, String serialized) { this.key=key;this.serialized=serialized; }
    // Capture and persist under the same monitor used by confirmation. An old
    // acknowledgement cannot erase its key between cart capture and retry.
    static Prepared prepareCart(Storage store,JSONObject address,StoreResolver catalog) throws Exception {
        synchronized(store){
            ProductSession session=ProductSession.parse(store.get("commerce_session"),Instant.now());
            if(session==null)throw new SecurityException("Active Shop account required");
            PrivacyLifecycle.requireWritable(store,session.account);
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
            boolean sameStamp=true;if(saved.has("cartStamp")){String state=store.get(NativeCart.key(account));sameStamp=!state.isEmpty()&&saved.getString("cartStamp").equals(new JSONObject(state).optString("stamp"));}
            if(sameStamp&&!cart.isEmpty()&&body.optJSONArray("Items")!=null&&WalletAuth.canonical(new org.json.JSONArray(cart)).equals(WalletAuth.canonical(body.getJSONArray("Items")))) {
                store.put(cartKey,"[]");cleared=true;
            }
            // Cart first: a failed write or process exit must retain the old
            // idempotency key while any purchased cart can still be retried.
            store.put(intentKey,"");return cleared;
        }
    }
}

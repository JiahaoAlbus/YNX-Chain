package com.ynxweb4.shop;
import org.json.JSONObject;
import org.json.JSONArray;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.net.URI;
import java.util.UUID;

// Only prepares the original invoice handoff. It neither authorizes a payment
// nor enters the automatic/offline execution queue.
final class PayHandoffRecovery {
    interface Storage {String get(String key)throws Exception;void put(String key,String value)throws Exception;}
    static final class Prepared {
        final String namespace,key,digest;final JSONObject order;
        Prepared(String namespace,String key,String digest,JSONObject order){this.namespace=namespace;this.key=key;this.digest=digest;this.order=order;}
        JSONObject body()throws Exception{return new JSONObject().put("IdempotencyKey",key);}
    }
    static Prepared prepare(Storage store,ProductSession session,JSONObject order)throws Exception{
        synchronized(store){if(session==null||!session.account.equals(order.getString("Buyer"))||!order.getString("ID").matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"))throw new SecurityException("Owned active order required");JSONObject frozen=new JSONObject(order.toString());String namespace="pay_handoff_pending_v1_"+hash(session.account+"\n"+frozen.getString("ID"));String digest=orderDigest(frozen),raw=store.get(namespace);JSONObject record;
        if(raw.isEmpty()){record=new JSONObject().put("key",UUID.randomUUID().toString()).put("digest",digest);String encoded=record.toString();store.put(namespace,encoded);if(!encoded.equals(store.get(namespace)))throw new SecurityException("Original invoice handoff could not be saved");}
        else{record=new JSONObject(raw);if(record.length()!=2||!record.has("key")||!record.has("digest")||!record.getString("key").matches("[A-Za-z0-9._:-]{8,128}")||!record.getString("digest").matches("[a-f0-9]{64}"))throw new SecurityException("Preserve invalid handoff recovery evidence");if(!digest.equals(record.getString("digest")))throw new IllegalStateException("Original invoice handoff is unresolved");}
        return new Prepared(namespace,record.getString("key"),digest,frozen);}
    }
    static String confirmed(Storage store,Prepared original,JSONObject response)throws Exception{
        synchronized(store){JSONObject order=response.getJSONObject("order");String invoice=response.getString("invoiceId"),link=response.getString("deepLink");URI uri=new URI(link);
        if(!invoice.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")||!original.digest.equals(orderDigest(order))||!invoice.equals(order.getString("InvoiceID"))||!"ynxpay".equals(uri.getScheme())||!"invoice".equals(uri.getHost())||!("/"+invoice).equals(uri.getRawPath())||uri.getRawQuery()!=null||uri.getFragment()!=null||uri.getUserInfo()!=null||uri.getPort()!=-1)throw new SecurityException("Invoice receipt does not match the original owned order");
        JSONObject saved=new JSONObject(store.get(original.namespace));if(saved.length()!=2||!original.key.equals(saved.getString("key"))||!original.digest.equals(saved.getString("digest")))throw new SecurityException("Original handoff changed");store.put(original.namespace,"");if(!store.get(original.namespace).isEmpty())throw new SecurityException("Confirmed handoff recovery could not be cleared");return link;}
    }
    private static String orderDigest(JSONObject order)throws Exception{Object raw=order.get("TotalYNXT");if(!(raw instanceof Number))throw new SecurityException("Exact order amount required");long amount=Long.parseLong(raw.toString());if(amount<=0||!"YNXT".equals(order.getString("Currency")))throw new SecurityException("YNXT order required");return hash(new JSONArray().put(order.getString("ID")).put(order.getString("Buyer")).put(order.getString("StoreID")).put(amount).put(order.getString("Currency")).toString());}
    private static String hash(String value)throws Exception{byte[] digest=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte item:digest)out.append(String.format(java.util.Locale.ROOT,"%02x",item&255));return out.toString();}
}

package com.ynxweb4.shop;

import org.json.JSONObject;
import java.util.UUID;

// A lost response does not create a new purchase intent. Persist this record in
// the account's encrypted product storage before sending or queuing checkout.
final class CheckoutIntent {
    final String key, serialized;
    private CheckoutIntent(String key, String serialized) { this.key=key;this.serialized=serialized; }
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
}

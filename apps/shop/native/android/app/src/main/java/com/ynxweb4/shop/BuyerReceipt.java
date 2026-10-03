package com.ynxweb4.shop;
import org.json.JSONObject;
final class BuyerReceipt {
 // WalletBuyer is projected by the authenticated owned backend from its exact
 // original Buyer representation. Original Buyer/storage aliases stay unchanged.
 static boolean owned(JSONObject value,String account){String buyer=value.optString("Buyer");return account.equals(buyer)||(buyer.matches("0x[0-9a-fA-F]{40}")&&account.equals(value.optString("WalletBuyer")));}
}

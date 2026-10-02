package com.ynxweb4.shop;

import java.time.Instant;
import org.json.JSONObject;

// Product-service state only. Wallet recovery material never enters this store.
final class ProductSession {
    final String account, token;
    final Instant expiresAt;
    private ProductSession(String account,String token,Instant expiresAt){this.account=account;this.token=token;this.expiresAt=expiresAt;}
    static ProductSession parse(String text,Instant now) throws Exception {
        if(text.isEmpty())return null;
        JSONObject value=new JSONObject(text);
        String account=value.getString("account"),token=value.getString("token");
        Instant expires=Instant.parse(value.getString("expiresAt"));
        if(!account.matches("ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}")||token.length()<24||!expires.isAfter(now))return null;
        return new ProductSession(account,token,expires);
    }
    boolean same(ProductSession other){return other!=null&&account.equals(other.account)&&token.equals(other.token)&&expiresAt.equals(other.expiresAt);}
}

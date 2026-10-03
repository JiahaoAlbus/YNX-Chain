package com.ynxweb4.shop;

import java.time.Instant;
import org.json.JSONObject;

// Product-service state only. Wallet recovery material never enters this store.
final class ProductSession {
    final String account, token;
    final Instant expiresAt;
    final long generation;
    final boolean nativeV2;
    private ProductSession(String account,String token,Instant expiresAt){this(account,token,expiresAt,0,false);}
    private ProductSession(String account,String token,Instant expiresAt,long generation,boolean nativeV2){this.account=account;this.token=token;this.expiresAt=expiresAt;this.generation=generation;this.nativeV2=nativeV2;}
    static ProductSession parse(String text,Instant now) throws Exception {
        if(text.isEmpty())return null;
        JSONObject value=new JSONObject(text);
        String account=value.getString("account"),token=value.getString("token");
        Instant expires=Instant.parse(value.getString("expiresAt"));
        if(!account.matches("ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}")||token.length()<24||!expires.isAfter(now))return null;
        return new ProductSession(account,token,expires);
    }
    static ProductSession nativeSession(JSONObject value,JSONObject context,Instant now)throws Exception{NativeProductState.checkSubject(value,context);if(!"2".equals(value.getString("version"))||!"ynx_6423-1".equals(value.getString("chainId"))||!"android".equals(value.getString("platform"))||!"p256-sha256".equals(value.getString("deviceAlgorithm"))||!NativeProductState.canonical(value.getJSONArray("scopes")).equals(NativeProductState.canonical(NativeProductState.buyerScopes())))throw new SecurityException("Verified original Native Buyer grant required");String account=value.getString("account"),binding=value.getString("sessionBinding");Instant expiry=Instant.parse(value.getString("expiresAt"));if(!account.matches("ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}")||!binding.matches("[a-f0-9]{64}")||!expiry.isAfter(now))throw new SecurityException("Current original Native session required");return new ProductSession(account,binding,expiry,context.getLong("generation"),true);}
    boolean same(ProductSession other){return other!=null&&nativeV2==other.nativeV2&&generation==other.generation&&account.equals(other.account)&&token.equals(other.token)&&expiresAt.equals(other.expiresAt);}
}

package com.ynxweb4.music;

import org.json.JSONObject;
import java.time.Instant;

// Internal immutable view of the SDK-verified ORIGINAL session/context. It is
// never reconstructed from an Intent, legacy binding or public profile account.
final class NativeSessionIdentity {
 final String account,binding;final Instant expiresAt;private final String session,context;
 NativeSessionIdentity(JSONObject verified,JSONObject expected)throws Exception{
  JSONObject original=new JSONObject(verified.toString()),captured=new JSONObject(expected.toString());
  NativeProductState.checkSubject(original,captured);
  if(!"2".equals(original.getString("version"))||!"ynx_6423-1".equals(original.getString("chainId"))||!"android".equals(original.getString("platform"))||!"p256-sha256".equals(original.getString("deviceAlgorithm"))||!NativeProductState.canonical(original.getJSONArray("scopes")).equals(NativeProductState.canonical(NativeProductState.originalNativeScopes())))throw new SecurityException("Original registered Music private session required");
  account=original.getString("account");binding=original.getString("sessionBinding");expiresAt=Instant.parse(original.getString("expiresAt"));
  if(!account.matches("ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}")||!binding.matches("[0-9a-f]{64}")||!expiresAt.isAfter(Instant.now()))throw new SecurityException("Current original Music session required");
  session=NativeProductState.canonical(original);context=NativeProductState.canonical(captured);
 }
 boolean same(NativeSessionIdentity other){return other!=null&&session.equals(other.session)&&context.equals(other.context)&&expiresAt.isAfter(Instant.now());}
 boolean contextMatches(JSONObject expected)throws Exception{return context.equals(NativeProductState.canonical(expected));}
}

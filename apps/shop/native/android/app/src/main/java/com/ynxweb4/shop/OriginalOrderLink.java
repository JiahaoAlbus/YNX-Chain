package com.ynxweb4.shop;

import java.time.Instant;
import java.util.regex.Pattern;
import java.util.regex.Matcher;
import org.json.JSONObject;

// Navigation DATA only. The existing Native session and Shop GET authorize access.
final class OriginalOrderLink {
 static final String CHAIN="ynx_6423-1";
 private static final Pattern LINK=Pattern.compile("^ynxshop://orders/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\\?account=(ynx1[023456789acdefghjklmnpqrstuvwxyz]{38})&chainId=ynx_6423-1$");
 final String orderID,account;
 private OriginalOrderLink(String orderID,String account){this.orderID=orderID;this.account=account;}
 static OriginalOrderLink parse(String raw){
  if(raw==null||raw.length()>512)throw new SecurityException("Bounded original Shop link required");
  Matcher m=LINK.matcher(raw);if(!m.matches())throw new SecurityException("Canonical account/network/order link required");
  return new OriginalOrderLink(m.group(1),m.group(2));
 }
 String canonical(){return "ynxshop://orders/"+orderID+"?account="+account+"&chainId="+CHAIN;}
 Read begin(ProductSession session){return new Read(this,session);}
 static final class Read {
  final OriginalOrderLink link;private final ProductSession expected;private boolean retired;
  private Read(OriginalOrderLink link,ProductSession session){
   if(session==null||!session.nativeV2||!link.account.equals(session.account)||!session.expiresAt.isAfter(Instant.now()))throw new SecurityException("Matching current Native account/network required");
   this.link=link;expected=session;
  }
  String path(){return "/orders/"+link.orderID;}
  boolean current(ProductSession actual){return !retired&&expected.same(actual)&&expected.expiresAt.isAfter(Instant.now());}
  void retire(){retired=true;}
  void validate(JSONObject order,ProductSession actual)throws Exception{
   if(!current(actual))throw new SecurityException("Original Shop read context changed");
   BuyerOrderReadback.validate(order,expected);
   if(!link.orderID.equals(order.getString("ID")))throw new SecurityException("Original Shop order replaced");
  }
 }
}

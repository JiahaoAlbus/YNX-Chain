package com.ynxweb4.shop;
import org.json.JSONObject;
import org.junit.Test;
import java.time.Instant;
import static org.junit.Assert.*;

public class OriginalOrderLinkTest {
 static final String A="ynx1"+"q".repeat(38),B="ynx1"+"p".repeat(38);
 static String link(String id,String account){return "ynxshop://orders/"+id+"?account="+account+"&chainId=ynx_6423-1";}
 static ProductSession session(String account,long generation)throws Exception{
  JSONObject context=new JSONObject().put("account",account).put("generation",generation).put("deviceId","PUBLIC-device").put("deviceKey","PUBLIC-key");
  JSONObject subject=new JSONObject(context.toString()).put("version","2").put("chainId","ynx_6423-1").put("platform","android").put("deviceAlgorithm","p256-sha256").put("scopes",NativeProductState.buyerScopes()).put("productId","shop").put("clientId","ynx-shop-v1").put("applicationId",NativeProductState.APP).put("bundleId",JSONObject.NULL).put("packageId",NativeProductState.APP).put("origin","app://android/"+NativeProductState.APP).put("callback","ynxshop://wallet-auth/callback").put("sessionBinding","a".repeat(64)).put("expiresAt",Instant.now().plusSeconds(3600).toString());
  return ProductSession.nativeSession(subject,context,Instant.now());
 }
 JSONObject order(String id,String account)throws Exception{return new JSONObject().put("ID",id).put("Buyer",account).put("Status","payment_pending").put("Currency","YNXT").put("TotalYNXT",8);}
 @Test public void canonicalOriginalRouteIsGetOnlyAndBounded()throws Exception{
  OriginalOrderLink target=OriginalOrderLink.parse(link("order:original",A));assertEquals(link("order:original",A),target.canonical());
  OriginalOrderLink.Read read=target.begin(session(A,1));assertEquals("/orders/order:original",read.path());assertEquals("[\"account:read\",\"shop:orders:write\",\"shop:profile:write\"]",NativeProductState.canonical(NativeBusinessPolicy.scopes("GET","/api"+read.path())));
  for(String raw:new String[]{link("order%3Aoriginal",A),link("../order",A),link("a/b",A),link("o",A)+"&paid=true",link("o",A)+"#approved",link("o",A).replace("6423","1"),link("o",A).replace("?account=","?account="+B+"&account="),link("o",A).replace("orders/","user@orders/"),link("o",A).replace("orders/","orders:443/"),"ynxshop://orders/","ynxshop://orders",link("o",A).replace("ynxshop","https"),link("o",A)+"\n"})assertThrows(SecurityException.class,()->OriginalOrderLink.parse(raw));
 }
 @Test public void foreignLegacyRenewedOrRetiredContextCannotRead()throws Exception{
  OriginalOrderLink link=OriginalOrderLink.parse(link("original",A));ProductSession original=session(A,1);assertThrows(SecurityException.class,()->link.begin(session(B,1)));
  ProductSession legacy=ProductSession.parse(new JSONObject().put("account",A).put("token","t".repeat(43)).put("expiresAt",Instant.now().plusSeconds(3600).toString()).toString(),Instant.now());assertThrows(SecurityException.class,()->link.begin(legacy));
  OriginalOrderLink.Read read=link.begin(original);read.validate(order("original",A),original);
  assertThrows(SecurityException.class,()->read.validate(order("other",A),original));assertThrows(SecurityException.class,()->read.validate(order("original",B),original));assertThrows(SecurityException.class,()->read.validate(order("original",A),session(A,2)));read.retire();assertFalse(read.current(original));assertThrows(SecurityException.class,()->read.validate(order("original",A),original));
 }
 @Test public void realBackendNativeProjectionIsReadWithoutInventingFunds()throws Exception{
  JSONObject actual=new JSONObject(new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(System.getenv("YNX_SHOP_NATIVE_RECEIPT_FIXTURE"))),java.nio.charset.StandardCharsets.UTF_8));actual.put("WalletBuyer",A);
  ProductSession current=session(A,1);OriginalOrderLink.Read read=OriginalOrderLink.parse(link(actual.getString("ID"),A)).begin(current);String before=actual.toString();read.validate(actual,current);assertEquals(before,actual.toString());
  java.nio.file.Path fullPath=java.nio.file.Paths.get(System.getenv("YNX_SHOP_NATIVE_RECEIPT_FIXTURE")).resolveSibling("native-refunded-order.json");
  JSONObject full=new JSONObject(new String(java.nio.file.Files.readAllBytes(fullPath),java.nio.charset.StandardCharsets.UTF_8));full.put("WalletBuyer",A);
  OriginalOrderLink.parse(link(full.getString("ID"),A)).begin(current).validate(full,current);
  assertEquals("refunded",full.getString("Status"));assertEquals("100",full.getJSONObject("NativePayment").getString("RefundedAtoms"));assertEquals("0",full.getJSONObject("NativePayment").getString("NetPaidAtoms"));
  JSONObject cased=new JSONObject(actual.toString());cased.put("Buyer","0x"+actual.getString("Buyer").substring(2).toUpperCase(java.util.Locale.ROOT));read.validate(cased,current);
  JSONObject foreign=new JSONObject(actual.toString());foreign.put("Buyer","0x"+"f".repeat(40));assertThrows(SecurityException.class,()->read.validate(foreign,current));
  actual.remove("NativePayment");assertThrows(Exception.class,()->read.validate(actual,current));
 }
}

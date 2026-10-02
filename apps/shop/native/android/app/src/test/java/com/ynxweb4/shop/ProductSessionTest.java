package com.ynxweb4.shop;
import static org.junit.Assert.*;
import java.time.Instant;
import org.json.JSONObject;
import org.junit.Test;
public final class ProductSessionTest {
 private static final Instant NOW=Instant.parse("2026-10-02T00:00:00Z");
 private String record(String account,String token,String expiry)throws Exception{return new JSONObject().put("account",account).put("token",token).put("expiresAt",expiry).toString();}
 @Test public void expiryAndActorAreRequired()throws Exception{
  String account="ynx1"+"q".repeat(38),token="product-service-token-for-qa";
  assertNotNull(ProductSession.parse(record(account,token,"2026-10-02T00:04:00Z"),NOW));
  assertNull(ProductSession.parse(record(account,token,"2026-10-02T00:00:00Z"),NOW));
  assertNull(ProductSession.parse(record("0x123",token,"2026-10-02T00:04:00Z"),NOW));
  assertNull(ProductSession.parse(record(account,"short","2026-10-02T00:04:00Z"),NOW));
 }
 @Test public void changedAccountAndRenewedSessionRejectLateResult()throws Exception{
  String token="product-service-token-for-qa";
  ProductSession before=ProductSession.parse(record("ynx1"+"q".repeat(38),token,"2026-10-02T00:04:00Z"),NOW);
  ProductSession another=ProductSession.parse(record("ynx1"+"p".repeat(38),token,"2026-10-02T00:04:00Z"),NOW);
  ProductSession renewal=ProductSession.parse(record(before.account,token+"-new","2026-10-02T00:04:00Z"),NOW);
  assertFalse(before.same(another));assertFalse(before.same(renewal));assertFalse(before.same(null));assertTrue(before.same(before));
 }
}

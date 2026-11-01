package com.ynxweb4.shop;

import org.junit.Test;
import org.json.*;
import java.util.*;
import static org.junit.Assert.*;

public final class CheckoutCatalogTest {
    static final String A=PrivacyLifecycleTest.A;
    static JSONObject line(String p,String v)throws Exception{return new JSONObject().put("ProductID",p).put("VariantID",v).put("Quantity",1);}
    static JSONObject product(String p,String merchant,String... variants)throws Exception{
        JSONArray rows=new JSONArray();for(String v:variants)rows.put(new JSONObject().put("ID",v).put("PriceYNXT",8).put("Inventory",4).put("Reserved",1));
        return new JSONObject().put("ID",p).put("StoreID",merchant).put("Variants",rows);
    }
    static final class Fixture implements NativeCart.Sender {
        final NativeCartTest.Memory memory=new NativeCartTest.Memory();
        final Map<String,JSONObject> products=new HashMap<>();final List<String> paths=new ArrayList<>();
        ProductSession active=BuyerJourneyTest.session("a".repeat(64));Runnable afterRead;
        Fixture(JSONArray cart)throws Exception{
            memory.login(A);memory.put("cart:"+A,cart.toString());memory.put(NativeCart.key(A),new JSONObject().put("account",A).put("ready",true).put("dirty",false).put("stamp","original-stamp").put("revision","cart-r3").put("base",cart).put("history",new JSONArray()).toString());
            products.put("/products/p",product("p","store-original","v"));products.put("/products/p2",product("p2","store-original","v2"));
        }
        public ProductSession session(){return active;}
        public JSONObject request(String method,String path,JSONObject body,ProductSession expected,long generation)throws Exception{
            assertEquals("GET",method);assertNull(body);paths.add(path);JSONObject found=products.get(path);if(found==null)throw new IllegalStateException("404 original listing");JSONObject detached=new JSONObject(found.toString());if(afterRead!=null)afterRead.run();return detached;
        }
        CheckoutIntent.Prepared prepare()throws Exception{return CheckoutIntent.prepareQueriedCart(memory,this,active,0,new JSONObject().put("Line1","Original address"));}
    }
    @Test public void coldMultiSkuCartResolvesAllProductsAndUnknownNeverReadsOrRotates()throws Exception{
        Fixture f=new Fixture(new JSONArray().put(line("p","v")).put(line("p2","v2")));CheckoutIntent.Prepared p=f.prepare();
        assertEquals(List.of("/products/p","/products/p2"),f.paths);assertEquals("store-original",p.body.getString("StoreID"));assertEquals(2,p.body.getJSONArray("Items").length());assertEquals("cart-r3",p.body.getString("CartRevision"));
        String key=p.body.getString("IdempotencyKey");assertEquals(key,f.prepare().body.getString("IdempotencyKey"));CheckoutIntent.markDispatched(f.memory,f.active,p.body);Map<String,String> before=new HashMap<>(f.memory.values);int calls=f.paths.size();
        assertThrows(CheckoutIntent.UnresolvedException.class,f::prepare);assertEquals(calls,f.paths.size());assertEquals(before,f.memory.values);
    }
    @Test public void wholeCartRejectsForeignMissingUnavailableOrAmbiguousSkuBeforeIntent()throws Exception{
        for(String failure:List.of("foreign","missing","unavailable","ambiguous","wrong-id","fractional","string-count")){
            Fixture f=new Fixture(new JSONArray().put(line("p","v")).put(line("p2","v2")));JSONObject second=f.products.get("/products/p2");
            if(failure.equals("foreign"))second.put("StoreID","other-store");
            if(failure.equals("missing"))f.products.remove("/products/p2");
            if(failure.equals("unavailable"))second.getJSONArray("Variants").getJSONObject(0).put("Inventory",1);
            if(failure.equals("ambiguous"))second.getJSONArray("Variants").put(new JSONObject(second.getJSONArray("Variants").getJSONObject(0).toString()));
            if(failure.equals("wrong-id"))second.put("ID","other-product");
            if(failure.equals("fractional"))second.getJSONArray("Variants").getJSONObject(0).put("PriceYNXT",8.5);
            if(failure.equals("string-count"))second.getJSONArray("Variants").getJSONObject(0).put("Inventory","4");
            Map<String,String> before=new HashMap<>(f.memory.values);assertThrows(failure,Exception.class,f::prepare);assertEquals(failure,before,f.memory.values);
        }
    }
    @Test public void draftOrAuthorityReplacementDuringReadCannotCreateCheckout()throws Exception{
        Fixture edited=new Fixture(new JSONArray().put(line("p","v")));edited.afterRead=()->{try{NativeCart.edit(edited.memory,A,new JSONArray().put(line("p2","v2")));}catch(Exception e){throw new RuntimeException(e);}};
        assertThrows(SecurityException.class,edited::prepare);assertEquals("",edited.memory.get("checkout:"+A));assertTrue(edited.memory.get("cart:"+A).contains("p2"));
        Fixture replaced=new Fixture(new JSONArray().put(line("p","v")));Map<String,String> original=new HashMap<>(replaced.memory.values);replaced.afterRead=()->{try{replaced.active=BuyerJourneyTest.session("b".repeat(64));}catch(Exception e){throw new RuntimeException(e);}};
        ProductSession captured=replaced.active;assertThrows(SecurityException.class,()->CheckoutIntent.prepareQueriedCart(replaced.memory,replaced,captured,0,new JSONObject()));assertEquals(original,replaced.memory.values);
    }
    @Test public void twoVariantsReadOneOriginalProductAndCrossStoreLegacyPreparationAlsoRejects()throws Exception{
        Fixture f=new Fixture(new JSONArray().put(line("p","v")).put(line("p","v2")));f.products.put("/products/p",product("p","store-original","v","v2"));assertEquals(2,f.prepare().body.getJSONArray("Items").length());assertEquals(List.of("/products/p"),f.paths);
        Fixture mixed=new Fixture(new JSONArray().put(line("p","v")).put(line("p2","v2")));Map<String,String> before=new HashMap<>(mixed.memory.values);
        assertThrows(SecurityException.class,()->CheckoutIntent.prepareSyncedCart(mixed.memory,mixed.active,new JSONObject(),id->id.equals("p")?"store-original":"other-store"));assertEquals(before,mixed.memory.values);
    }
}

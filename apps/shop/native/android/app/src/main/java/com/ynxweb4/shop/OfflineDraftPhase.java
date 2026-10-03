package com.ynxweb4.shop;

import org.json.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;

// Companion metadata only. An old/missing phase is unknown, never an unsent
// inference. The original encrypted queue row/body/key stays byte-compatible.
final class OfflineDraftPhase {
    static final String KEY="offline_mutation_dispatch_v1";
    private static String digest(JSONObject row)throws Exception{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(WalletAuth.canonical(row).getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();for(byte b:bytes){hex.append(Character.forDigit((b>>>4)&15,16)).append(Character.forDigit(b&15,16));}return hex.toString();}
    static JSONObject records(CheckoutIntent.Storage store)throws Exception{
        String raw=store.get(KEY);JSONObject records=raw.isEmpty()?new JSONObject():new JSONObject(raw);
        Iterator<String> ids=records.keys();while(ids.hasNext()){String id=ids.next();JSONObject record=records.getJSONObject(id);if(record.length()!=2||!record.getString("digest").matches("[a-f0-9]{64}")||!java.util.Set.of("prepared","dispatching","unknown").contains(record.getString("phase")))throw new SecurityException("Original offline phase metadata invalid");}return records;
    }
    static String phase(CheckoutIntent.Storage store,JSONObject row)throws Exception{JSONObject saved=records(store).optJSONObject(row.getString("id"));if(saved==null)return "unknown";if(!digest(row).equals(saved.getString("digest")))throw new SecurityException("Original offline draft changed");return saved.getString("phase");}
    static void prepared(CheckoutIntent.Storage store,JSONObject row)throws Exception{JSONObject saved=records(store);String id=row.getString("id");if(saved.has(id))throw new SecurityException("Original offline phase already exists");saved.put(id,new JSONObject().put("digest",digest(row)).put("phase","prepared"));persist(store,saved);}
    static void dispatching(CheckoutIntent.Storage store,JSONObject row)throws Exception{if(!"prepared".equals(phase(store,row)))throw new SecurityException("Original offline draft is not unsent");JSONObject saved=records(store);saved.getJSONObject(row.getString("id")).put("phase","dispatching");persist(store,saved);}
    static void unknown(CheckoutIntent.Storage store,JSONObject row)throws Exception{if(!"dispatching".equals(phase(store,row)))return;JSONObject saved=records(store);saved.getJSONObject(row.getString("id")).put("phase","unknown");persist(store,saved);}
    static void confirmed(CheckoutIntent.Storage store,JSONObject row)throws Exception{phase(store,row);JSONObject saved=records(store);saved.remove(row.getString("id"));persist(store,saved);}
    private static void persist(CheckoutIntent.Storage store,JSONObject records)throws Exception{String raw=WalletAuth.canonical(records);store.put(KEY,raw);if(!raw.equals(WalletAuth.canonical(records(store))))throw new SecurityException("Offline phase durability failed");}
}

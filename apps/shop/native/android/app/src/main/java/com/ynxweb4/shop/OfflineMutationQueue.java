package com.ynxweb4.shop;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.UUID;

final class OfflineMutationQueue {
    interface Storage {String get(String key)throws Exception;void put(String key,String value)throws Exception;}
    interface Sender {ProductSession session()throws Exception;JSONObject requestForAccount(String method,String path,JSONObject body,String account)throws Exception;}
    private final Storage secure;
    OfflineMutationQueue(SecureStore store){this(new Storage(){public String get(String key)throws Exception{return store.get(key);}public void put(String key,String value)throws Exception{store.put(key,value);}});}
    OfflineMutationQueue(Storage store){this.secure=store;}
    synchronized String enqueue(String method,String path,JSONObject body) throws Exception{
        ProductSession session=ProductSession.parse(secure.get("commerce_session"),Instant.now());if(session==null)throw new SecurityException("An active account is required to save a pending request");if(!method.equals("POST")||!(path.equals("/orders")||path.matches("/orders/[^/]+/transition")))throw new SecurityException("Only reviewed order actions can be queued");if(path.endsWith("/transition")&&!java.util.Set.of("cancelled","delivered","return_requested","refund_requested","disputed","reviewed").contains(body.optString("Action")))throw new SecurityException("Queued action is not a buyer review action");JSONArray queue=read();if(queue.length()>=100)throw new IllegalStateException("Pending request queue is full");String id=UUID.randomUUID().toString();
        queue.put(new JSONObject().put("id",id).put("method",method).put("path",path).put("body",new JSONObject(body.toString())).put("account",session.account).put("queuedAt",Instant.now().toString()));
        secure.put("offline_mutations",queue.toString());return id;
    }
    synchronized int size() throws Exception{return read().length();}
    synchronized int flush(ApiClient api) throws Exception{return flush(new Sender(){public ProductSession session()throws Exception{return api.session();}public JSONObject requestForAccount(String method,String path,JSONObject body,String account)throws Exception{return api.requestForAccount(method,path,body,account);}});}
    synchronized int flush(Sender api) throws Exception{
        JSONArray queue=read(),remaining=new JSONArray();int completed=0;
        for(int i=0;i<queue.length();i++){JSONObject item=queue.getJSONObject(i);String account=item.optString("account");ProductSession current=api.session();if(account.isEmpty()||current==null||!account.equals(current.account)){remaining.put(item);continue;}try{api.requestForAccount(item.getString("method"),item.getString("path"),item.getJSONObject("body"),account);completed++;}catch(Exception error){for(int j=i;j<queue.length();j++)remaining.put(queue.get(j));break;}}
        secure.put("offline_mutations",remaining.toString());return completed;
    }
    private JSONArray read() throws Exception{String raw=secure.get("offline_mutations");return raw.isEmpty()?new JSONArray():new JSONArray(raw);}
}

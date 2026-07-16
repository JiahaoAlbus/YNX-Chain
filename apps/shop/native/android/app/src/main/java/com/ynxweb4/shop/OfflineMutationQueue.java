package com.ynxweb4.shop;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.UUID;

final class OfflineMutationQueue {
    private final SecureStore secure;
    OfflineMutationQueue(SecureStore secure){this.secure=secure;}
    synchronized String enqueue(String method,String path,JSONObject body) throws Exception{
        JSONArray queue=read();String id=UUID.randomUUID().toString();
        queue.put(new JSONObject().put("id",id).put("method",method).put("path",path).put("body",body).put("queuedAt",Instant.now().toString()));
        secure.put("offline_mutations",queue.toString());return id;
    }
    synchronized int size() throws Exception{return read().length();}
    synchronized int flush(ApiClient api) throws Exception{
        JSONArray queue=read(),remaining=new JSONArray();int completed=0;
        for(int i=0;i<queue.length();i++){JSONObject item=queue.getJSONObject(i);try{api.requestSync(item.getString("method"),item.getString("path"),item.getJSONObject("body"));completed++;}catch(Exception error){for(int j=i;j<queue.length();j++)remaining.put(queue.get(j));break;}}
        secure.put("offline_mutations",remaining.toString());return completed;
    }
    private JSONArray read() throws Exception{String raw=secure.get("offline_mutations");return raw.isEmpty()?new JSONArray():new JSONArray(raw);}
}

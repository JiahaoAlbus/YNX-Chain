package com.ynxweb4.music;

import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

// Isolated JVM adapter to the ACTUAL packaged original SDK. No fixture grant,
// hard-coded proof or user Android custody is used by this test boundary.
final class NativeSessionBridge {
    private NativeSessionIdentity active;private long revision;
    NativeSessionBridge(JSONObject session,JSONObject context)throws Exception{active=new NativeSessionIdentity(session,context);}
    NativeSessionIdentity session(){return active;}
    long epoch(){return revision;}
    void restore()throws Exception {revision++;JSONObject result=port("restore",new JSONObject());active=new NativeSessionIdentity(result.getJSONObject("session"),result.getJSONObject("context"));}
    void enableTrustFixture()throws Exception{port("trust",new JSONObject());}
    JSONObject proof(String method,String path,String digest,long bytes,NativeSessionIdentity expected)throws Exception{
        if(expected==null||!expected.same(active))throw new IOException("Original Java context retired");
        return port("proof",new JSONObject().put("method",method).put("path",path).put("bodyDigest",digest).put("bodyBytes",bytes));
    }
    void rejected(NativeSessionIdentity expected){if(expected.same(active)){active=null;revision++;}}
    private JSONObject port(String name,JSONObject args)throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(System.getProperty("ynx.music.ownedFixtureOrigin")+"/qa/"+name).openConnection();
        try{c.setRequestMethod("POST");c.setDoOutput(true);c.setConnectTimeout(8000);c.setReadTimeout(30000);byte[] bytes=args.toString().getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}if(c.getResponseCode()!=200)throw new IOException("Original SDK proof adapter rejected");try(InputStream in=c.getInputStream()){return new JSONObject(new String(MusicIO.bounded(in,1024*1024),StandardCharsets.UTF_8));}}finally{c.disconnect();}
    }
}

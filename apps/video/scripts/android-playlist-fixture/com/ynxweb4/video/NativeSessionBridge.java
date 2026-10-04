package com.ynxweb4.video;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
// Actual packaged original SDK over an isolated loopback QA port, no fake proof.
final class NativeSessionBridge {
 private NativeSessionIdentity active;private long revision;
 NativeSessionBridge(JSONObject session,JSONObject context)throws Exception{active=new NativeSessionIdentity(session,context);}
 NativeSessionIdentity session(){return active;}
 long epoch(){return revision;}
 void restore()throws Exception{revision++;JSONObject result=port("restore",new JSONObject());active=new NativeSessionIdentity(result.getJSONObject("session"),result.getJSONObject("context"));}
 JSONObject proof(String method,String path,String digest,long bytes,NativeSessionIdentity expected)throws Exception{if(expected==null||!expected.same(active))throw new IOException("Original Java context retired");return port("proof",new JSONObject().put("method",method).put("path",path).put("bodyDigest",digest).put("bodyBytes",bytes));}
 void rejected(NativeSessionIdentity expected){if(expected.same(active)){active=null;revision++;}}
 private JSONObject port(String name,JSONObject args)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(System.getProperty("ynx.video.originalQAOrigin")+"/qa/"+name).openConnection();try{c.setRequestMethod("POST");c.setDoOutput(true);c.setConnectTimeout(8000);c.setReadTimeout(30000);byte[] body=args.toString().getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){out.write(body);}if(c.getResponseCode()!=200)throw new IOException("Original SDK proof port rejected");try(InputStream in=c.getInputStream()){byte[] raw=in.readNBytes(1024*1024+1);if(raw.length>1024*1024)throw new IOException("Original SDK response exceeds limit");return new JSONObject(new String(raw,StandardCharsets.UTF_8));}}finally{c.disconnect();}}
}

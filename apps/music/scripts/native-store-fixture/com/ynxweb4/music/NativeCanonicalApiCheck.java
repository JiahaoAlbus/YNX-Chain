package com.ynxweb4.music;
import android.content.Context;import org.json.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.time.Instant;import java.util.*;import java.util.concurrent.atomic.*;import com.sun.net.httpserver.HttpServer;
// Actual shipped MusicApi HTTP wire/lifecycle test. The bridge adapter returns
// labeled fixture headers; actual SDK crypto is tested in the packaged engine.
public final class NativeCanonicalApiCheck {
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 static String digest(byte[] bytes)throws Exception{return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));}
 static NativeSessionIdentity identity()throws Exception{
  String app="com.ynxweb4.music",key=Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[33]),account="ynx1"+"a".repeat(38);
  JSONObject context=new JSONObject().put("applicationId",app).put("platform","android").put("deviceId","fixture-original-native-device").put("deviceKey",key).put("generation",1).put("securityLevel","os-protected").put("account",JSONObject.NULL);
  JSONObject session=new JSONObject().put("version","2").put("chainId","ynx_6423-1").put("productId","music").put("clientId","ynx-music-v1").put("applicationId",app).put("platform","android").put("origin","app://android/"+app).put("callback","ynxmusic://auth/callback").put("bundleId",JSONObject.NULL).put("packageId",app).put("deviceId",context.getString("deviceId")).put("deviceKey",key).put("deviceAlgorithm","p256-sha256").put("account",account).put("scopes",NativeProductState.originalNativeScopes()).put("sessionBinding","a".repeat(64)).put("expiresAt",Instant.now().plusSeconds(90).toString());
  return new NativeSessionIdentity(session,context);
 }
 public static void main(String[]args)throws Exception{
  Context context=new Context(Files.createTempDirectory("ynx-native-music-api-").toFile());NativeSessionBridge bridge=new NativeSessionBridge(identity());MusicStore.selectAccount(context,bridge.active.account);SecureStore.binding="";
  AtomicInteger calls=new AtomicInteger();AtomicBoolean late=new AtomicBoolean();AtomicInteger status=new AtomicInteger(200);List<byte[]> requests=new ArrayList<>();AtomicReference<String> contentType=new AtomicReference<>();
  HttpServer server=HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/api/",exchange->{try{
   calls.incrementAndGet();byte[] body=exchange.getRequestBody().readAllBytes();requests.add(body);contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
   check(exchange.getRequestHeaders().getFirst("X-YNX-App-Session")==null&&exchange.getRequestHeaders().getFirst("X-YNX-Product-Device-Key")==null,"canonical sender leaked legacy authority");
   check("fixture-introspection-no-auth".equals(exchange.getRequestHeaders().getFirst("X-YNX-Product-Session-Proof-V2")),"canonical introspection field lost");check((digest(body)+":"+body.length).equals(exchange.getRequestHeaders().getFirst("X-YNX-Music-Business-Proof-V2")),"FINAL actual body differs from committed bytes/length");
   if(late.get())bridge.revision++;byte[] response=(status.get()==200?"{\"id\":\"owned\"}":"{\"error\":\"authority outage\"}").getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(status.get(),response.length);exchange.getResponseBody().write(response);
  }catch(Exception failure){throw new AssertionError(failure);}finally{exchange.close();}});server.start();
  try{
   System.setProperty("ynx.music.ownedFixtureOrigin","http://127.0.0.1:"+server.getAddress().getPort());SecureStore.failure=new IllegalStateException("legacy ciphertext unavailable");MusicApi api=new MusicApi(context,bridge);SecureStore.failure=null;
   JSONObject body=new JSONObject().put("name","本人 中文\n<original>").put("trackIDs",new JSONArray());api.post("/api/playlists",body);check(Arrays.equals(requests.get(0),body.toString().getBytes(StandardCharsets.UTF_8)),"original JSON rewritten");
   Path wav=Files.createTempFile("ynx-owned-",".wav");byte[] wave=new byte[44];wave[0]='R';wave[1]='I';wave[2]='F';wave[3]='F';wave[8]='W';wave[9]='A';wave[10]='V';wave[11]='E';Files.write(wav,wave);
   api.upload(wav.toFile(),"Owned 中文","Author","owned","evidence","original");byte[] wire=requests.get(1);String type=contentType.get(),boundary=type.substring(type.indexOf("boundary=")+9);check(new String(wire,StandardCharsets.ISO_8859_1).startsWith("--"+boundary+"\r\n"),"signed multipart boundary differs from final Content-Type");check(new String(wire,StandardCharsets.ISO_8859_1).endsWith("\r\n--"+boundary+"--\r\n"),"multipart not complete");
   late.set(true);boolean rejected=false;try{api.get("/api/me");}catch(java.io.IOException expected){rejected=true;}check(rejected,"same session after newer restore epoch accepted old response");int count=calls.get();try{api.get("/api/me");throw new AssertionError("old request escaped before network");}catch(java.io.IOException expected){}check(calls.get()==count,"retired epoch reached network");late.set(false);
   MusicApi fresh=new MusicApi(context,bridge);status.set(503);try{fresh.get("/api/me");throw new AssertionError("outage accepted");}catch(java.io.IOException expected){}check(!bridge.missing,"503 discarded original session/forced logout");
   status.set(403);try{fresh.get("/api/me");throw new AssertionError("forbidden private read accepted");}catch(java.io.IOException expected){}check(!bridge.missing,"403 withdrew otherwise valid original session");
   status.set(401);try{fresh.get("/api/me");throw new AssertionError("revoked private read accepted");}catch(java.io.IOException expected){}check(bridge.missing,"401 did not retire original local authority");
   System.out.println("PASS actual MusicApi: final UTF8 JSON and multipart stream digest/length, original proof field names without legacy headers, original multipart boundary, newer same-session restore epoch veto before/after HTTP, retryable503 retention, original401 local retirement; fixture transport only");
   Files.deleteIfExists(wav);
  }finally{server.stop(0);}
 }
}

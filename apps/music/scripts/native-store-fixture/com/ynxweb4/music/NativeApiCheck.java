package com.ynxweb4.music;
import android.content.Context;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.util.HexFormat;
import java.security.MessageDigest;
import java.util.concurrent.atomic.*;
public final class NativeApiCheck {
 static void check(boolean ok,String description){if(!ok)throw new AssertionError(description);}
 public static void main(String[] args)throws Exception{
  Path directory=Files.createTempDirectory("ynx-music-owned-native-api-");Context context=new Context(directory.toFile());
  MusicStore store=MusicStore.selectAccount(context,"ynx1"+"a".repeat(38));
  byte[] wave=new byte[44];System.arraycopy("RIFF".getBytes(),0,wave,0,4);System.arraycopy("WAVE".getBytes(),0,wave,8,4);
  String digest=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(wave));
  AtomicBoolean badHash=new AtomicBoolean(),switchDuringMedia=new AtomicBoolean(),switchDuringResponse=new AtomicBoolean();AtomicInteger calls=new AtomicInteger();
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/api/tracks/track_owned",exchange->{try{
   calls.incrementAndGet();check("session-a".equals(exchange.getRequestHeaders().getFirst("X-YNX-App-Session")),"request uses its captured session");
   byte[] bytes=exchange.getRequestURI().getPath().endsWith("/media")?wave:("{\"audioSha256\":\""+(badHash.get()?"0".repeat(64):digest)+"\"}").getBytes();
   if(switchDuringResponse.get()||switchDuringMedia.get()&&exchange.getRequestURI().getPath().endsWith("/media"))SecureStore.binding="session-b";
   exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);
  }finally{exchange.close();}});AtomicInteger redirectCalls=new AtomicInteger();server.createContext("/redirect-sink",exchange->{redirectCalls.incrementAndGet();exchange.sendResponseHeaders(200,2);exchange.getResponseBody().write("{}".getBytes());exchange.close();});server.createContext("/api/redirect",exchange->{exchange.getResponseHeaders().set("Location","http://127.0.0.1:"+server.getAddress().getPort()+"/redirect-sink");exchange.sendResponseHeaders(307,-1);exchange.close();});
  server.createContext("/api/creator/tracks",exchange->{try{calls.incrementAndGet();check("session-a".equals(exchange.getRequestHeaders().getFirst("X-YNX-App-Session")),"upload retains initiating account");exchange.getRequestBody().readAllBytes();SecureStore.binding="session-b";byte[] bytes="{\"id\":\"draft-owned\"}".getBytes();exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);}finally{exchange.close();}});AtomicInteger playlistPosts=new AtomicInteger(),playlistReads=new AtomicInteger();java.util.List<String> playlistBodies=new java.util.ArrayList<>();
  server.createContext("/api/playlists",exchange->{try{byte[] bytes="{\"id\":\"pl_aaaaaaaaaaaaaaaaaaaaaaaa\",\"name\":\"Recovered\",\"trackIds\":[]}".getBytes();int status=200;if(exchange.getRequestMethod().equals("POST")){check("music-playlist-fixture".equals(exchange.getRequestHeaders().getFirst("Idempotency-Key")),"stable creation key missing");playlistBodies.add(new String(exchange.getRequestBody().readAllBytes()));if(playlistPosts.incrementAndGet()==1)status=500;}else playlistReads.incrementAndGet();exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);}finally{exchange.close();}});server.start();
  try{
   System.setProperty("ynx.music.ownedFixtureOrigin","http://127.0.0.1:"+server.getAddress().getPort());SecureStore.binding="session-a";
   MusicApi recoveryApi=new MusicApi(context);boolean creationFailed=false;try{recoveryApi.createPlaylist("Recovered",new org.json.JSONArray(),"music-playlist-fixture");}catch(java.io.IOException expected){creationFailed=true;}check(creationFailed,"failed creation response accepted");org.json.JSONObject recovered=recoveryApi.createPlaylist("Recovered",new org.json.JSONArray(),"music-playlist-fixture");check(playlistPosts.get()==2&&playlistReads.get()==1&&playlistBodies.get(0).equals(playlistBodies.get(1))&&recovered.getString("id").equals("pl_aaaaaaaaaaaaaaaaaaaaaaaa"),"creation retry lost key/body/readback");
   org.json.JSONObject pending=store.load().put("playlistCreation",new org.json.JSONObject().put("key","music-playlist-fixture").put("name","Recovered").put("trackIDs",new org.json.JSONArray()));store.save(pending);MusicStore.selectAccount(context,"ynx1"+"b".repeat(38));check(!MusicStore.selectAccount(context,"ynx1"+"b".repeat(38)).load().has("playlistCreation"),"A pending leaked to B");store=MusicStore.selectAccount(context,"ynx1"+"a".repeat(38));check(store.load().getJSONObject("playlistCreation").getString("key").equals("music-playlist-fixture"),"pending intent lost on account restore");
   System.out.println("PASS Android pending creation: failed response, same body/key retry, GET readback and account-file restore");
   MusicApi api=new MusicApi(context);Path audio=api.download("track_owned").toPath();check(java.util.Arrays.equals(Files.readAllBytes(audio),wave),"server bound checksum and WAV saved atomically");
   badHash.set(true);boolean rejected=false;try{api.download("track_owned");}catch(java.io.IOException expected){rejected=true;}check(rejected,"corrupt media checksum rejected");check(java.util.Arrays.equals(Files.readAllBytes(audio),wave),"failed checksum preserves previous audio");badHash.set(false);
   switchDuringMedia.set(true);rejected=false;try{api.download("track_owned");}catch(java.io.IOException expected){rejected=true;}check(rejected,"account switch while downloading rejects old bytes");check(java.util.Arrays.equals(Files.readAllBytes(audio),wave),"account switch preserves original audio");switchDuringMedia.set(false);
   int before=calls.get();rejected=false;try{api.get("/api/tracks/track_owned");}catch(java.io.IOException expected){rejected=true;}check(rejected&&calls.get()==before,"old client cannot make a request with new session authority");
   SecureStore.binding="session-a";switchDuringResponse.set(true);rejected=false;try{new MusicApi(context).get("/api/tracks/track_owned");}catch(java.io.IOException expected){rejected=true;}check(rejected,"old response cannot survive an account switch");
   SecureStore.binding="session-a";rejected=false;try{new MusicApi(context).upload(audio.toFile(),"Owned fixture","Author","owned","fixture","original");}catch(java.io.IOException expected){rejected=true;}check(rejected,"upload response after account switch cannot update new account");
   SecureStore.binding="session-a";rejected=false;try{new MusicApi(context).get("/api/redirect");}catch(java.io.IOException expected){rejected=true;}check(rejected&&redirectCalls.get()==0,"private session is never forwarded through a server redirect");
   check(Files.list(audio.getParent()).noneMatch(path->path.getFileName().toString().endsWith(".tmp")),"failed transfers leave no partial download");
   System.out.println("PASS: captured authority, checksum/WAV download, failure preservation, account switch before/during/after HTTP and temporary-file cleanup; host transport fixture only");
  }finally{server.stop(0);}
 }
}

package com.ynxweb4.video;
import android.content.Context;
import org.json.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicInteger;
import com.sun.net.httpserver.HttpServer;
// Separate source counterexamples: memory may change while disk commit fails.
// Fixture proof headers are not grants; mutation counts test shipped control flow.
public final class NativeVideoPersistentCommitCheck {
 interface Action{void run()throws Exception;}
 static void rejected(Action action)throws Exception{try{action.run();}catch(Exception expected){return;}throw new AssertionError("Unconfirmed write was accepted");}
 static void attempt(Action action)throws Exception{try{action.run();}catch(Exception expected){}}
 static void checkOriginalRetry(VideoViewerState viewer,JSONObject create,JSONObject operation,JSONObject watch)throws Exception{if(!NativeProductState.canonical(create).equals(NativeProductState.canonical(viewer.reservePlaylist(create.getString("name"))))||!NativeProductState.canonical(operation).equals(NativeProductState.canonical(viewer.reservePlaylistOperation(operation.getString("action"),operation.getString("playlistID"),operation.getString("videoID"),operation.getString("name")))))throw new AssertionError("Storage recovery changed original request");viewer.confirmWatch(watch);viewer.finishPlaylist(create);viewer.finishPlaylistOperation(operation);viewer.finishWatch(watch);}
 public static void main(String[]args)throws Exception{
  JSONArray results=new JSONArray();int failures=0;
  for(String kind:new String[]{"playlist-operation","playlist-create","watch-replay"}){
   AtomicInteger writes=new AtomicInteger();String account=NativeVideoApiCheck.identity().account;
   HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.createContext("/",exchange->{byte[] reply=("GET".equals(exchange.getRequestMethod())?"[{\"ID\":\"pl_original\",\"Name\":\"Original\",\"Owner\":\""+account+"\",\"VideoIDs\":[]}]":"{\"ok\":true}").getBytes(StandardCharsets.UTF_8);if(!"GET".equals(exchange.getRequestMethod()))writes.incrementAndGet();exchange.getRequestBody().readAllBytes();exchange.sendResponseHeaders(200,reply.length);exchange.getResponseBody().write(reply);exchange.close();});server.start();
   try{
    NativeSessionBridge bridge=new NativeSessionBridge(NativeVideoApiCheck.identity());VideoRequestBoundary boundary=new VideoRequestBoundary();long generation=boundary.advance();VideoApi api=new VideoApi(bridge,boundary,generation,path->(HttpURLConnection)new URL("http://127.0.0.1:"+server.getAddress().getPort()+path).openConnection());Context context=new Context(Files.createTempDirectory("ynx-video-persistent-commit-source-").toFile());VideoViewerState viewer=new VideoViewerState(context,api);String namespace="ynx_video_viewer_v2_"+VideoApi.digest(account.getBytes(StandardCharsets.UTF_8));String playback=null;if(kind.equals("watch-replay"))playback=viewer.playback("vid_original").getString("playbackId");context.getSharedPreferences(namespace,0).failCommit=true;
    if(kind.equals("playlist-operation")){rejected(()->api.changePlaylist(viewer,"add","pl_original","vid_original"));attempt(()->api.retryPlaylist(viewer));}
    else if(kind.equals("playlist-create")){rejected(()->viewer.reservePlaylist("Original create"));attempt(()->{JSONObject row=viewer.reservePlaylist("Original create");api.json("/v1/playlists","POST",new JSONObject().put("Name",row.getString("name")),row.getString("key"));});}
    else{final String id=playback;rejected(()->viewer.position("vid_original",id,7,7,false));attempt(()->{JSONArray rows=viewer.watchPending();JSONObject row=rows.getJSONObject(0);api.json("/v1/videos/vid_original/watch","POST",new JSONObject().put("seconds",row.getInt("seconds")).put("completed",row.getBoolean("completed")).put("playback_id",row.getString("playbackId")),row.getString("key"));});}
    boolean pass=writes.get()==0;results.put(new JSONObject().put("case",kind).put("persistentCommitFailureMutationCount",writes.get()).put("passed",pass));if(!pass)failures++;
   }finally{server.stop(0);}
  }
  Context ackContext=new Context(Files.createTempDirectory("ynx-video-ack-failure-source-").toFile());NativeSessionBridge ackBridge=new NativeSessionBridge(NativeVideoApiCheck.identity());VideoRequestBoundary ackBoundary=new VideoRequestBoundary();long ackGeneration=ackBoundary.advance();VideoApi ackApi=new VideoApi(ackBridge,ackBoundary,ackGeneration);VideoViewerState ackViewer=new VideoViewerState(ackContext,ackApi);String ackNamespace="ynx_video_viewer_v2_"+VideoApi.digest(ackApi.identity.account.getBytes(StandardCharsets.UTF_8));JSONObject create=ackViewer.reservePlaylist("Original ACK create"),operation=ackViewer.reservePlaylistOperation("add","pl_ack","vid_original","ACK list"),playback=ackViewer.playback("vid_original"),watch=ackViewer.position("vid_original",playback.getString("playbackId"),7,7,false);ackContext.getSharedPreferences(ackNamespace,0).failCommit=true;
  rejected(()->ackViewer.finishPlaylist(create));rejected(()->ackViewer.finishPlaylistOperation(operation));rejected(()->ackViewer.finishWatch(watch));boolean retained=NativeProductState.canonical(create).equals(NativeProductState.canonical(ackViewer.playlistDraft()))&&NativeProductState.canonical(operation).equals(NativeProductState.canonical(ackViewer.playlistOperation()));JSONObject heldWatch=new JSONObject(ackContext.getSharedPreferences(ackNamespace,0).getString("state",null)).getJSONArray("watchPending").getJSONObject(0);retained=retained&&NativeProductState.canonical(watch).equals(NativeProductState.canonical(heldWatch));results.put(new JSONObject().put("case","ACK-failed-storage-retains-all-originals").put("passed",retained));if(!retained)failures++;
  ackContext.getSharedPreferences(ackNamespace,0).failCommit=false;checkOriginalRetry(ackViewer,create,operation,watch);results.put(new JSONObject().put("case","same-key-body-after-storage-recovery").put("passed",true));
  System.out.println(new JSONObject().put("sourceCounterexamples",results).put("failures",failures).put("actualPrivateSDK",false).put("actualAndroidOS",false));if(failures!=0)throw new AssertionError("Persistent commit failure reached mutating HTTP: "+failures+" original recovery paths");
 }
}

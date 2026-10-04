package com.ynxweb4.video;

import org.json.JSONObject;
import org.json.JSONArray;
import java.io.*;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;

// The original SDK signs the exact serialized body. A captured original
// identity and restore epoch remain mandatory before and after every await.
final class VideoApi {
 interface Connections { HttpURLConnection open(String path)throws Exception; }
 final NativeSessionIdentity identity;
 private final NativeSessionBridge bridge;
 private final long nativeEpoch;
 private final VideoRequestBoundary boundary;
 private final long navigation;
 private final Connections connections;
 VideoApi(NativeSessionBridge bridge,VideoRequestBoundary boundary,long navigation){this(bridge,boundary,navigation,path->(HttpURLConnection)VideoRequestBoundary.url(path).openConnection());}
 VideoApi(NativeSessionBridge bridge,VideoRequestBoundary boundary,long navigation,Connections connections){this.bridge=bridge;this.identity=bridge.session();this.nativeEpoch=bridge.epoch();this.boundary=boundary;this.navigation=navigation;this.connections=connections;}
 void requireCurrent(){boundary.require(navigation);if(identity==null||nativeEpoch!=bridge.epoch()||!identity.same(bridge.session()))throw new SecurityException("Original Video account recovery required");}
 private void require(boolean signed){boundary.require(navigation);if(signed)requireCurrent();}
 private void headers(HttpURLConnection connection,String method,String path,byte[] body,boolean signed)throws Exception{
  require(signed);VideoRequestBoundary.configure(connection);connection.setRequestMethod(method);connection.setRequestProperty("Accept","application/json");
   if(signed){JSONObject proof=bridge.proof(method,path,digest(body),body.length,identity);requireCurrent();connection.setRequestProperty("X-YNX-Product-Session-Proof-V2",proof.getString("identityHeader"));connection.setRequestProperty("X-YNX-Product-Session-Action-Proof-V2",proof.getString("actionHeader"));}
 }
 JSONObject json(String path,String method,JSONObject payload)throws Exception{
  return json(path,method,payload,UUID.randomUUID().toString());
 }
 JSONObject json(String path,String method,JSONObject payload,String requestKey)throws Exception{
  boolean signed=!VideoRequestBoundary.publicRead(path,method)||identity!=null&&path.indexOf('?')<0;
  byte[] body=payload==null?new byte[0]:payload.toString().getBytes(StandardCharsets.UTF_8);if(body.length>1_048_576||"GET".equals(method)&&body.length!=0)throw new IllegalArgumentException("Bounded final Video body required");
  HttpURLConnection connection=connections.open(path);
  if(!requestKey.matches("[A-Za-z0-9_-]{16,128}"))throw new IllegalArgumentException("Original request key required");
  try{headers(connection,method,path,body,signed);if(!"GET".equals(method)&&!"HEAD".equals(method)){connection.setRequestProperty("Idempotency-Key",requestKey);connection.setRequestProperty("Content-Type","application/json");connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);require(signed);try(OutputStream output=connection.getOutputStream()){output.write(body);}}
   require(signed);int status=connection.getResponseCode();byte[] bytes=read(status>=200&&status<300?connection.getInputStream():connection.getErrorStream(),2*1024*1024);require(signed);accepted(status,signed);
   String raw=new String(bytes,StandardCharsets.UTF_8).trim();if(raw.startsWith("["))return new JSONObject().put("array",new JSONArray(raw));return raw.isEmpty()?new JSONObject():new JSONObject(raw);
  }finally{connection.disconnect();}
 }
 void sendWatch(VideoViewerState viewer,JSONObject original)throws Exception{requireCurrent();viewer.requireOriginalApi(this);viewer.confirmWatch(original);requireCurrent();String id=original.getString("videoId");if(!id.matches("[A-Za-z0-9_-]+"))throw new SecurityException("Original watch target required");JSONObject result=json("/v1/videos/"+id+"/watch","POST",new JSONObject().put("seconds",original.getInt("seconds")).put("completed",original.getBoolean("completed")).put("playback_id",original.getString("playbackId")),original.getString("key"));if(result.length()!=1||!Boolean.TRUE.equals(result.opt("ok")))throw new SecurityException("Original watch acknowledgement required");requireCurrent();viewer.finishWatch(original);}
 JSONArray ownedPlaylists()throws Exception{
  JSONArray rows=json("/v1/playlists","GET",null).getJSONArray("array");java.util.Set<String> ids=new java.util.HashSet<>();
  for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);String id=row.getString("ID");if(!identity.account.equals(row.getString("Owner"))||!id.matches("pl_[A-Za-z0-9_-]{1,157}")||!ids.add(id)||!(row.get("Name") instanceof String))throw new SecurityException("Original own playlists required");if(row.has("VideoIDs")&&!row.isNull("VideoIDs")){JSONArray videos=row.getJSONArray("VideoIDs");for(int j=0;j<videos.length();j++)if(!(videos.get(j) instanceof String)||!videos.getString(j).matches("vid_[A-Za-z0-9_-]{1,156}"))throw new SecurityException("Original playlist membership required");}}
  requireCurrent();return rows;
 }
 private static JSONObject playlist(JSONArray rows,String id)throws Exception{for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(id.equals(row.getString("ID")))return row;}return null;}
 private static boolean playlistDone(JSONArray rows,JSONObject original)throws Exception{JSONObject row=playlist(rows,original.getString("playlistID"));String action=original.getString("action");if("delete".equals(action))return row==null;if(row==null)return false;boolean member=false;JSONArray ids=row.optJSONArray("VideoIDs");if(ids!=null)for(int i=0;i<ids.length();i++)if(original.getString("videoID").equals(ids.getString(i)))member=true;return member=="add".equals(action);}
 JSONObject changePlaylist(VideoViewerState viewer,String action,String playlistID,String videoID)throws Exception{
  requireCurrent();viewer.requireOriginalApi(this);if(!java.util.Arrays.asList("add","remove","delete").contains(action)||!playlistID.matches("pl_[A-Za-z0-9_-]{1,157}")||("delete".equals(action)?videoID!=null:videoID==null||!videoID.matches("vid_[A-Za-z0-9_-]{1,156}")))throw new IllegalArgumentException("Original playlist change required");
  JSONObject pending=viewer.playlistOperation();if(pending!=null&&(!action.equals(pending.getString("action"))||!playlistID.equals(pending.getString("playlistID"))||!(videoID==null?pending.isNull("videoID"):videoID.equals(pending.getString("videoID")))))throw new IllegalStateException("Retry original playlist change first");
  JSONArray before=ownedPlaylists();JSONObject target=playlist(before,playlistID);if(pending==null&&target==null)throw new SecurityException("Original owned playlist unavailable");
  JSONObject original=viewer.reservePlaylistOperation(action,playlistID,videoID,pending==null?target.getString("Name"):pending.getString("name"));requireCurrent();
  if(!playlistDone(before,original)){
   String path="/v1/playlists/"+playlistID+("delete".equals(action)?"":"/videos"+("remove".equals(action)?"/"+videoID:""));JSONObject result=json(path,"add".equals(action)?"POST":"DELETE","add".equals(action)?new JSONObject().put("video_id",videoID):null,original.getString("key"));
   if(result.length()!=1||!Boolean.TRUE.equals(result.opt("ok")))throw new SecurityException("Original playlist change reply required");if(!playlistDone(ownedPlaylists(),original))throw new SecurityException("Original playlist change readback required");
  }
  requireCurrent();viewer.finishPlaylistOperation(original);requireCurrent();return original;
 }
 void retryPlaylist(VideoViewerState viewer)throws Exception{JSONObject original=viewer.playlistOperation();if(original!=null)changePlaylist(viewer,original.getString("action"),original.getString("playlistID"),original.isNull("videoID")?null:original.getString("videoID"));}
 byte[] range(String path,long offset,int count,long total)throws Exception{
  requireCurrent();if(offset<0||count<1||count>262144||total<=offset||total>2L*1024*1024*1024)throw new IllegalArgumentException("Bounded original media range required");
  int expected=(int)Math.min(count,total-offset);long end=offset+expected-1;HttpURLConnection connection=connections.open(path);
  try{headers(connection,"GET",path,new byte[0],true);connection.setRequestProperty("Range","bytes="+offset+"-"+end);connection.setRequestProperty("Accept","video/*,application/octet-stream");requireCurrent();int status=connection.getResponseCode();
   if(status!=206){accepted(status,true);throw new IOException("Original media range response required");}
   if(!("bytes "+offset+"-"+end+"/"+total).equals(connection.getHeaderField("Content-Range")))throw new IOException("Original media range changed");
   byte[] bytes=read(connection.getInputStream(),expected);requireCurrent();if(bytes.length!=expected)throw new IOException("Original media range is truncated");return bytes;
  }finally{connection.disconnect();}
 }
 String text(String path)throws Exception{if(!path.startsWith("/media/"))throw new SecurityException("Original transcript object required");boolean signed=identity!=null;HttpURLConnection connection=connections.open(path);try{headers(connection,"GET",path,new byte[0],signed);require(signed);int status=connection.getResponseCode();byte[] bytes=read(status>=200&&status<300?connection.getInputStream():connection.getErrorStream(),1_048_576);require(signed);accepted(status,signed);return new String(bytes,StandardCharsets.UTF_8);}finally{connection.disconnect();}}
 private void accepted(int status,boolean signed)throws Exception{if(status>=200&&status<300)return;if(signed&&status==401)bridge.rejected(identity);throw new IOException(status==503?"Video authority temporarily unavailable; retry original recovery":"Video request rejected (HTTP "+status+")");}
 static String digest(byte[] body)throws Exception{StringBuilder result=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(body))result.append(String.format(Locale.ROOT,"%02x",value&255));return result.toString();}
 private static byte[] read(InputStream input,int limit)throws Exception{if(input==null)return new byte[0];try(InputStream stream=input;ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] part=new byte[8192];int n,total=0;while((n=stream.read(part))!=-1){total+=n;if(total>limit)throw new IOException("Video response exceeds limit");output.write(part,0,n);}return output.toByteArray();}}
}

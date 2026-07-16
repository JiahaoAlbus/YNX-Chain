package com.ynxweb4.music;

import android.content.Context;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

final class MusicApi {
    private final Context context; private final String base;
    MusicApi(Context c){context=c;base=c.getSharedPreferences("settings",0).getString("api",BuildConfig.DEFAULT_API);}
    JSONObject get(String path)throws Exception{return json("GET",path,null);}
    JSONObject post(String path,JSONObject body)throws Exception{return json("POST",path,body);}
    JSONObject put(String path,JSONObject body)throws Exception{return json("PUT",path,body);}
    String mediaURL(String trackId){return base+"/api/tracks/"+trackId+"/media";}
    JSONObject saveLibrary(JSONArray favorites,JSONArray queue,JSONObject downloads)throws Exception{return put("/api/library",new JSONObject().put("favorites",favorites).put("queue",queue).put("downloads",downloads));}
    JSONObject createPlaylist(String name,JSONArray ids)throws Exception{return post("/api/playlists",new JSONObject().put("name",name).put("description","Created from selected real library records").put("trackIDs",ids));}
    JSONObject createAI(JSONArray ids,String language)throws Exception{return post("/api/ai/proposals",CentralContracts.aiRequest("playlist","Explain and organize my selected real library without inventing tracks",ids,language));}
    String streamAI(String id)throws Exception{HttpURLConnection x=open("/api/ai/proposals/"+id+"/stream");int code=x.getResponseCode();String text=new String((code<400?x.getInputStream():x.getErrorStream()).readAllBytes(),StandardCharsets.UTF_8);if(code>=400)throw new IOException(text);return text;}
    JSONObject reviewAI(String id,String action,String name)throws Exception{return post("/api/ai/proposals/"+id+"/review",new JSONObject().put("action",action).put("name",name));}
    JSONObject onboard(String displayName)throws Exception{return post("/api/creator/onboarding",new JSONObject().put("displayName",displayName).put("bio","Creator of owned or licensed Music uploads"));}
    JSONObject release(String id,String state,String reason)throws Exception{return post("/api/creator/tracks/"+id+"/release",new JSONObject().put("state",state).put("reason",reason));}
    JSONObject openCase(String kind,String trackId,String reason,String evidence)throws Exception{return json("POST","/api/cases",new JSONObject().put("kind",kind).put("trackID",trackId).put("reason",reason).put("evidenceRef",evidence),"music-trust-"+java.util.UUID.randomUUID());}
    JSONObject settlement(String allocationId,String payTo)throws Exception{return json("POST","/api/creator/settlements",new JSONObject().put("allocationID",allocationId).put("payTo",payTo),"music-pay-"+allocationId);}
    JSONObject updateProfile(JSONObject profile)throws Exception{return put("/api/profile",profile);}
    JSONObject reportPosition(String trackId,String sessionRef,int position,boolean completed)throws Exception{return post("/api/playback/"+trackId+"/position",new JSONObject().put("sessionRef",sessionRef).put("positionMillis",position).put("completed",completed));}
    private JSONObject json(String method,String path,JSONObject body)throws Exception{return json(method,path,body,null);}
    private JSONObject json(String method,String path,JSONObject body,String idempotency)throws Exception{HttpURLConnection x=open(path);x.setRequestMethod(method);if(idempotency!=null)x.setRequestProperty("Idempotency-Key",idempotency);if(body!=null){x.setDoOutput(true);x.setRequestProperty("Content-Type","application/json");x.getOutputStream().write(body.toString().getBytes(StandardCharsets.UTF_8));}int code=x.getResponseCode();String text=new String((code<400?x.getInputStream():x.getErrorStream()).readAllBytes(),StandardCharsets.UTF_8);if(code>=400)throw new IOException(new JSONObject(text).optString("error","HTTP "+code));return new JSONObject(text);}
    File download(String trackId)throws Exception{HttpURLConnection x=open("/api/tracks/"+trackId+"/media");x.setRequestProperty("Range","bytes=0-");if(x.getResponseCode()!=200&&x.getResponseCode()!=206)throw new IOException("download unavailable");MusicStore store=new MusicStore(context);File out=store.offline(trackId);out.getParentFile().mkdirs();File tmp=new File(out+".tmp");try(InputStream in=x.getInputStream();OutputStream os=new FileOutputStream(tmp)){in.transferTo(os);}if(Files.size(tmp.toPath())<44)throw new IOException("invalid media");byte[] head=Files.readAllBytes(tmp.toPath());if(head[0]!='R'||head[1]!='I'||head[2]!='F'||head[3]!='F'){tmp.delete();throw new IOException("media integrity failed");}if(!tmp.renameTo(out))throw new IOException("offline replace failed");return out;}
    JSONObject upload(File wav,String title,String artist,String rightsBasis,String evidence,String provenance)throws Exception{String boundary="YNXMusic"+System.nanoTime();HttpURLConnection x=open("/api/creator/tracks");x.setRequestMethod("POST");x.setDoOutput(true);x.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);try(OutputStream out=x.getOutputStream()){field(out,boundary,"title",title);field(out,boundary,"artistName",artist);field(out,boundary,"rightsBasis",rightsBasis);field(out,boundary,"territories","WORLDWIDE");field(out,boundary,"evidenceRef",evidence);field(out,boundary,"audioProvenance",provenance);field(out,boundary,"explicit","false");out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"owned.wav\"\r\nContent-Type: audio/wav\r\n\r\n").getBytes());Files.copy(wav.toPath(),out);out.write(("\r\n--"+boundary+"--\r\n").getBytes());}int code=x.getResponseCode();String text=new String((code<400?x.getInputStream():x.getErrorStream()).readAllBytes());if(code>=400)throw new IOException(new JSONObject(text).optString("error"));return new JSONObject(text);}
    private HttpURLConnection open(String path)throws Exception{HttpURLConnection x=(HttpURLConnection)new URL(base+path).openConnection();x.setConnectTimeout(8000);x.setReadTimeout(30000);x.setRequestProperty("Accept","application/json");String token=SecureStore.get(context);if(!token.isEmpty())x.setRequestProperty("Authorization","Bearer "+token);x.setRequestProperty("X-YNX-Device-ID","ynx-music-android");return x;}
    private static void field(OutputStream out,String b,String name,String value)throws Exception{out.write(("--"+b+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").getBytes(StandardCharsets.UTF_8));}
}

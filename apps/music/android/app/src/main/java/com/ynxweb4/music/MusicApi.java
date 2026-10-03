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
    private final Context context; private final String base; private final String capturedBinding; private final RuntimeException custodyFailure;
    MusicApi(Context c){context=c;String binding="";RuntimeException failure=null;try{binding=SecureStore.get(c);}catch(RuntimeException error){failure=error;}capturedBinding=binding;custodyFailure=failure;base=BuildConfig.DEFAULT_API;}
    JSONObject get(String path)throws Exception{return json("GET",path,null);}
    JSONObject post(String path,JSONObject body)throws Exception{return json("POST",path,body);}
    JSONObject put(String path,JSONObject body)throws Exception{return json("PUT",path,body);}
    JSONObject walletChallenge(JSONObject request,JSONObject approval)throws Exception{return post("/api/auth/wallet-v1/challenge",new JSONObject().put("authorizationRequest",request).put("walletApproval",approval));}
    JSONObject walletSession(JSONObject request,JSONObject approval,JSONObject completion)throws Exception{return post("/api/auth/wallet-v1/session",new JSONObject().put("authorizationRequest",request).put("walletApproval",approval).put("gatewayCompletion",completion));}
    String mediaURL(String trackId){return base+"/api/tracks/"+trackId+"/media";}
    JSONObject saveLibrary(JSONArray favorites,JSONArray queue,JSONObject downloads)throws Exception{return put("/api/library",new JSONObject().put("favorites",favorites).put("queue",queue).put("downloads",downloads));}
    JSONObject createPlaylist(String name,JSONArray ids,String key)throws Exception{if(!key.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"))throw new IOException("Invalid playlist request key");JSONObject created=json("POST","/api/playlists",new JSONObject().put("name",name).put("description","Created from selected real library records").put("trackIDs",ids),key);return playlist(created.getString("id"));}
    JSONObject playlist(String id)throws Exception{if(!id.matches("pl_[0-9a-f]{24}"))throw new IOException("Invalid playlist ID");return get("/api/playlists/"+id);}
    JSONObject savePlaylist(String id,String name,String description,JSONArray ids)throws Exception{if(!id.matches("pl_[0-9a-f]{24}"))throw new IOException("Invalid playlist ID");return put("/api/playlists/"+id,new JSONObject().put("name",name).put("description",description).put("trackIDs",ids));}
    JSONObject createAI(JSONArray ids,String language)throws Exception{return post("/api/ai/proposals",CentralContracts.aiRequest("playlist","Explain and organize my selected real library without inventing tracks",ids,language));}
    String streamAI(String id)throws Exception{HttpURLConnection x=open("/api/ai/proposals/"+id+"/stream");int code=x.getResponseCode();if(code>=300&&code<400)throw new IOException("Music API redirect refused");String text=new String((code<400?x.getInputStream():x.getErrorStream()).readAllBytes(),StandardCharsets.UTF_8);assertCurrent();if(code>=400)throw new IOException(text);return text;}
    JSONObject reviewAI(String id,String action,String name)throws Exception{return post("/api/ai/proposals/"+id+"/review",new JSONObject().put("action",action).put("name",name));}
    JSONObject onboard(String displayName)throws Exception{return post("/api/creator/onboarding",new JSONObject().put("displayName",displayName).put("bio","Creator of owned or licensed Music uploads"));}
    JSONObject release(String id,String state,String reason)throws Exception{return post("/api/creator/tracks/"+id+"/release",new JSONObject().put("state",state).put("reason",reason));}
    JSONObject openCase(String kind,String trackId,String reason,String evidence)throws Exception{return json("POST","/api/cases",new JSONObject().put("kind",kind).put("trackID",trackId).put("reason",reason).put("evidenceRef",evidence),"music-trust-"+java.util.UUID.randomUUID());}
    JSONObject settlement(String allocationId,String payTo)throws Exception{return json("POST","/api/creator/settlements",new JSONObject().put("allocationID",allocationId).put("payTo",payTo),"music-pay-"+allocationId);}
    JSONObject updateProfile(JSONObject profile)throws Exception{return put("/api/profile",profile);}
    JSONObject reportPosition(String trackId,String sessionRef,int position,boolean completed)throws Exception{return post("/api/playback/"+trackId+"/position",new JSONObject().put("sessionRef",sessionRef).put("positionMillis",position).put("completed",completed));}
    private JSONObject json(String method,String path,JSONObject body)throws Exception{return json(method,path,body,null);}
    private JSONObject json(String method,String path,JSONObject body,String idempotency)throws Exception{HttpURLConnection x=open(path);x.setRequestMethod(method);if(idempotency!=null)x.setRequestProperty("Idempotency-Key",idempotency);if(body!=null){x.setDoOutput(true);x.setRequestProperty("Content-Type","application/json");x.getOutputStream().write(body.toString().getBytes(StandardCharsets.UTF_8));}int code=x.getResponseCode();if(code>=300&&code<400)throw new IOException("Music API redirect refused");String text=new String((code<400?x.getInputStream():x.getErrorStream()).readAllBytes(),StandardCharsets.UTF_8);if(!path.startsWith("/api/auth/"))assertCurrent();if(code>=400)throw new IOException(new JSONObject(text).optString("error","HTTP "+code));return new JSONObject(text);}
    File download(String trackId)throws Exception{
        JSONObject metadata=get("/api/tracks/"+trackId);String expected=metadata.getString("audioSha256");
        if(!expected.matches("[0-9a-f]{64}"))throw new IOException("Media verification unavailable");
        assertCurrent();MusicStore store=new MusicStore(context);File out=store.offline(trackId),tmp=new File(out+"."+java.util.UUID.randomUUID()+".tmp");
        if(!out.getParentFile().exists()&&!out.getParentFile().mkdirs())throw new IOException("Offline storage unavailable");
        HttpURLConnection x=open("/api/tracks/"+trackId+"/media");boolean saved=false;
        try{
            if(x.getResponseCode()!=200)throw new IOException("Download unavailable");
            java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");long length=0;
            try(InputStream in=x.getInputStream();FileOutputStream os=new FileOutputStream(tmp)){
                byte[] buffer=new byte[32768];for(int count;(count=in.read(buffer))!=-1;){length+=count;if(length>64L*1024*1024)throw new IOException("Offline track exceeds the supported limit");assertCurrent();digest.update(buffer,0,count);os.write(buffer,0,count);}os.getFD().sync();
            }
            if(length<44)throw new IOException("Invalid media");
            try(FileInputStream in=new FileInputStream(tmp)){byte[] header=in.readNBytes(12);if(header.length!=12||header[0]!='R'||header[1]!='I'||header[2]!='F'||header[3]!='F'||header[8]!='W'||header[9]!='A'||header[10]!='V'||header[11]!='E')throw new IOException("Invalid WAV media");}
            StringBuilder actual=new StringBuilder();for(byte value:digest.digest())actual.append(String.format(java.util.Locale.ROOT,"%02x",value&255));
            if(!expected.equals(actual.toString()))throw new IOException("Media checksum mismatch");
            assertCurrent();if(!tmp.renameTo(out))throw new IOException("Offline replace failed");saved=true;return out;
        }finally{x.disconnect();if(!saved)tmp.delete();}
    }
    JSONObject upload(File wav,String title,String artist,String rightsBasis,String evidence,String provenance)throws Exception{String boundary="YNXMusic"+System.nanoTime();HttpURLConnection x=open("/api/creator/tracks");x.setRequestMethod("POST");x.setDoOutput(true);x.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);try(OutputStream out=x.getOutputStream()){field(out,boundary,"title",title);field(out,boundary,"artistName",artist);field(out,boundary,"rightsBasis",rightsBasis);field(out,boundary,"territories","WORLDWIDE");field(out,boundary,"evidenceRef",evidence);field(out,boundary,"audioProvenance",provenance);field(out,boundary,"explicit","false");out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"owned.wav\"\r\nContent-Type: audio/wav\r\n\r\n").getBytes());try(InputStream in=new FileInputStream(wav)){byte[] buffer=new byte[32768];for(int count;(count=in.read(buffer))!=-1;){assertCurrent();out.write(buffer,0,count);}}out.write(("\r\n--"+boundary+"--\r\n").getBytes());}int code=x.getResponseCode();if(code>=300&&code<400)throw new IOException("Music API redirect refused");String text=new String((code<400?x.getInputStream():x.getErrorStream()).readAllBytes(),StandardCharsets.UTF_8);assertCurrent();if(code>=400)throw new IOException(new JSONObject(text).optString("error"));return new JSONObject(text);}
    private HttpURLConnection open(String path)throws Exception{if(custodyFailure!=null)throw new IOException(custodyFailure.getMessage(),custodyFailure);HttpURLConnection x=(HttpURLConnection)new URL(base+path).openConnection();x.setInstanceFollowRedirects(false);x.setConnectTimeout(8000);x.setReadTimeout(30000);x.setRequestProperty("Accept","application/json");String binding=capturedBinding;if(!path.startsWith("/api/auth/"))assertCurrent();if(!binding.isEmpty()){x.setRequestProperty("X-YNX-App-Session",binding);x.setRequestProperty("X-YNX-Product-Device-Key",CentralContracts.productDeviceKey());}return x;}
    private void assertCurrent()throws IOException{if(capturedBinding.isEmpty()||!capturedBinding.equals(SecureStore.get(context)))throw new IOException("Music account changed. Sign in and retry.");}
    private static void field(OutputStream out,String b,String name,String value)throws Exception{out.write(("--"+b+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").getBytes(StandardCharsets.UTF_8));}
}

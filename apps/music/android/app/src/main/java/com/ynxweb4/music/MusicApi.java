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
    private final Context context; private final String base; private final String capturedBinding; private final RuntimeException custodyFailure; private final NativeSessionBridge nativeBridge; private final NativeSessionIdentity capturedNative; private final long capturedNativeEpoch;
    MusicApi(Context c){this(c,null);}
    MusicApi(Context c,NativeSessionBridge bridge){context=c;nativeBridge=bridge;capturedNative=bridge==null?null:bridge.session();capturedNativeEpoch=bridge==null?0:bridge.epoch();String binding="";RuntimeException failure=null;try{if(bridge==null)binding=SecureStore.get(c);}catch(RuntimeException error){failure=error;}capturedBinding=binding;custodyFailure=failure;base=BuildConfig.DEFAULT_API;}
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
    String streamAI(String id)throws Exception{HttpURLConnection x=open("/api/ai/proposals/"+id+"/stream");int code=x.getResponseCode();if(code>=300&&code<400)throw new IOException("Music API redirect refused");String text=readResponse(x,code);assertCurrent();if(code>=400){rejected(code);throw new IOException("Music request unavailable (HTTP "+code+")");}return text;}
    JSONObject reviewAI(String id,String action,String name)throws Exception{return post("/api/ai/proposals/"+id+"/review",new JSONObject().put("action",action).put("name",name));}
    JSONObject onboard(String displayName)throws Exception{return post("/api/creator/onboarding",new JSONObject().put("displayName",displayName).put("bio","Creator of owned or licensed Music uploads"));}
    JSONObject release(String id,String state,String reason)throws Exception{return post("/api/creator/tracks/"+id+"/release",new JSONObject().put("state",state).put("reason",reason));}
    JSONObject openCase(JSONObject body,String key)throws Exception{if(!key.matches("music-trust-[A-Fa-f0-9-]{36}"))throw new IOException("Invalid original Trust key");return json("POST","/api/cases",new JSONObject(body.toString()),key);}
    JSONObject settlement(String allocationId,String payTo)throws Exception{return json("POST","/api/creator/settlements",new JSONObject().put("allocationID",allocationId).put("payTo",payTo),"music-pay-"+allocationId);}
    JSONObject updateProfile(JSONObject profile)throws Exception{return put("/api/profile",profile);}
    JSONObject reportPosition(String trackId,String sessionRef,int position,boolean completed)throws Exception{return post("/api/playback/"+trackId+"/position",new JSONObject().put("sessionRef",sessionRef).put("positionMillis",position).put("completed",completed));}
    private JSONObject json(String method,String path,JSONObject body)throws Exception{return json(method,path,body,null);}
    private JSONObject json(String method,String path,JSONObject body,String idempotency)throws Exception{byte[] bytes=body==null?new byte[0]:body.toString().getBytes(StandardCharsets.UTF_8);HttpURLConnection x=open(path,method,bytes);if(idempotency!=null)x.setRequestProperty("Idempotency-Key",idempotency);if(body!=null){x.setDoOutput(true);x.setRequestProperty("Content-Type","application/json");x.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=x.getOutputStream()){out.write(bytes);}}int code=x.getResponseCode();if(code>=300&&code<400)throw new IOException("Music API redirect refused");String text=readResponse(x,code);if(!path.startsWith("/api/auth/"))assertCurrent();if(code>=400){rejected(code);throw new IOException(new JSONObject(text).optString("error","HTTP "+code));}return new JSONObject(text);}
    File download(String trackId)throws Exception{
        JSONObject metadata=get("/api/tracks/"+trackId);String expected=metadata.getString("audioSha256");
        if(!expected.matches("[0-9a-f]{64}"))throw new IOException("Media verification unavailable");
        assertCurrent();MusicStore store=new MusicStore(context);if(nativeBridge!=null)store.requireAccount(account());File out=store.offline(trackId),tmp=new File(out+"."+java.util.UUID.randomUUID()+".tmp");
        if(!out.getParentFile().exists()&&!out.getParentFile().mkdirs())throw new IOException("Offline storage unavailable");
        HttpURLConnection x=open("/api/tracks/"+trackId+"/media");boolean saved=false;
        try{
            int code=x.getResponseCode();if(code!=200){rejected(code);throw new IOException("Download unavailable (HTTP "+code+")");}
            java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");long length=0;
            try(InputStream in=x.getInputStream();FileOutputStream os=new FileOutputStream(tmp)){
                byte[] buffer=new byte[32768];for(int count;(count=in.read(buffer))!=-1;){length+=count;if(length>64L*1024*1024)throw new IOException("Offline track exceeds the supported limit");assertCurrent();digest.update(buffer,0,count);os.write(buffer,0,count);}os.getFD().sync();
            }
            if(length<44)throw new IOException("Invalid media");
            try(FileInputStream in=new FileInputStream(tmp)){byte[] header=MusicIO.prefix(in,12);if(header.length!=12||header[0]!='R'||header[1]!='I'||header[2]!='F'||header[3]!='F'||header[8]!='W'||header[9]!='A'||header[10]!='V'||header[11]!='E')throw new IOException("Invalid WAV media");}
            StringBuilder actual=new StringBuilder();for(byte value:digest.digest())actual.append(String.format(java.util.Locale.ROOT,"%02x",value&255));
            if(!expected.equals(actual.toString()))throw new IOException("Media checksum mismatch");
            assertCurrent();if(!tmp.renameTo(out))throw new IOException("Offline replace failed");saved=true;return out;
        }finally{x.disconnect();if(!saved)tmp.delete();}
    }
    JSONObject upload(File wav,String title,String artist,String rightsBasis,String evidence,String provenance)throws Exception{return upload(wav,title,artist,rightsBasis,evidence,provenance,null);}
    JSONObject upload(File wav,String title,String artist,String rightsBasis,String evidence,String provenance,String key)throws Exception{
        if(key!=null&&!key.matches("music-upload-[A-Fa-f0-9-]{36}"))throw new IOException("Invalid original upload key");
        assertCurrent();if(wav.length()>50L*1024*1024)throw new IOException("Audio exceeds the original upload limit");
        String boundary="YNXMusic"+(key==null?java.util.UUID.randomUUID().toString().replace("-",""):key);File wire=File.createTempFile("music-native-upload-",".wire",context.getFilesDir());
        try{
            try(FileOutputStream out=new FileOutputStream(wire)){
                field(out,boundary,"title",title);field(out,boundary,"artistName",artist);field(out,boundary,"rightsBasis",rightsBasis);field(out,boundary,"territories","WORLDWIDE");field(out,boundary,"evidenceRef",evidence);field(out,boundary,"audioProvenance",provenance);field(out,boundary,"explicit","false");
                out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"owned.wav\"\r\nContent-Type: audio/wav\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                try(InputStream in=new FileInputStream(wav)){byte[] buffer=new byte[32768];long length=0;for(int n;(n=in.read(buffer))!=-1;){length+=n;if(length>50L*1024*1024)throw new IOException("Audio exceeds the original upload limit");assertCurrent();out.write(buffer,0,n);}}
                out.write(("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));out.getFD().sync();
            }
            if(wire.length()>64L*1024*1024)throw new IOException("Original Music wire body exceeds limit");
            String digest=fileDigest(wire);HttpURLConnection x=openPrepared("/api/creator/tracks","POST",digest,wire.length());
            try{if(key!=null)x.setRequestProperty("Idempotency-Key",key);x.setDoOutput(true);x.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);x.setFixedLengthStreamingMode(wire.length());
                try(OutputStream out=x.getOutputStream();InputStream in=new FileInputStream(wire)){byte[] part=new byte[32768];for(int n;(n=in.read(part))!=-1;){assertCurrent();out.write(part,0,n);}}
                int code=x.getResponseCode();if(code>=300&&code<400)throw new IOException("Music API redirect refused");String text=readResponse(x,code);assertCurrent();if(code>=400){rejected(code);throw new IOException(new JSONObject(text).optString("error"));}return new JSONObject(text);
            }finally{x.disconnect();}
        }finally{wire.delete();}
    }
    private HttpURLConnection open(String path)throws Exception{return open(path,"GET",new byte[0]);}
    private HttpURLConnection open(String path,String method,byte[] body)throws Exception{if(body.length>1024*1024)throw new IOException("Music JSON exceeds limit");return openPrepared(path,method,digest(body),body.length);}
    private HttpURLConnection openPrepared(String path,String method,String bodyDigest,long bodyBytes)throws Exception{
        if(custodyFailure!=null)throw new IOException(custodyFailure.getMessage(),custodyFailure);
        if(nativeBridge!=null&&path.startsWith("/api/auth/"))throw new IOException("Explicit original Native SDK authorization required");
        if(!path.startsWith("/api/auth/"))assertCurrent();
        JSONObject proof=nativeBridge==null?null:nativeBridge.proof(method,path,bodyDigest,bodyBytes,capturedNative);
        assertCurrentIfBusiness(path);
        HttpURLConnection x=(HttpURLConnection)new URL(base+path).openConnection();x.setInstanceFollowRedirects(false);x.setConnectTimeout(8000);x.setReadTimeout(30000);x.setRequestMethod(method);x.setRequestProperty("Accept","application/json");
        if(proof!=null){x.setRequestProperty("X-YNX-Product-Session-Proof-V2",proof.getString("identityHeader"));x.setRequestProperty("X-YNX-Music-Business-Proof-V2",proof.getString("actionHeader"));}
        else if(!capturedBinding.isEmpty()){x.setRequestProperty("X-YNX-App-Session",capturedBinding);x.setRequestProperty("X-YNX-Product-Device-Key",CentralContracts.productDeviceKey());}
        return x;
    }
    private void assertCurrentIfBusiness(String path)throws IOException{if(!path.startsWith("/api/auth/"))assertCurrent();}
    void assertCurrent()throws IOException{
        if(nativeBridge!=null){if(capturedNative==null||capturedNativeEpoch!=nativeBridge.epoch()||!capturedNative.same(nativeBridge.session()))throw new IOException("Original Music account changed. Retry protected recovery.");}
        else if(capturedBinding.isEmpty()||!capturedBinding.equals(SecureStore.get(context)))throw new IOException("Music account changed. Sign in and retry.");
    }
    String account(){return capturedNative==null?"":capturedNative.account;}
    private void rejected(int code)throws Exception{if(nativeBridge!=null&&code==401)nativeBridge.rejected(capturedNative);}
    private String readResponse(HttpURLConnection x,int code)throws Exception{try(InputStream in=code<400?x.getInputStream():x.getErrorStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in==null)throw new IOException("Music response unavailable");byte[] part=new byte[8192];int length=0;for(int n;(n=in.read(part))!=-1;){length+=n;if(length>2*1024*1024)throw new IOException("Music response exceeds limit");out.write(part,0,n);}return new String(out.toByteArray(),StandardCharsets.UTF_8);}}
    static void verifyLocal(File file,String expected)throws Exception{if(!expected.matches("[0-9a-f]{64}")||file.length()<44||file.length()>64L*1024*1024||!expected.equals(fileDigest(file)))throw new IOException("Original audio checksum unavailable");try(InputStream in=new FileInputStream(file)){byte[] header=MusicIO.prefix(in,12);if(header.length!=12||header[0]!='R'||header[1]!='I'||header[2]!='F'||header[3]!='F'||header[8]!='W'||header[9]!='A'||header[10]!='V'||header[11]!='E')throw new IOException("Original WAV required");}}
    static String fileDigest(File file)throws Exception{java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] part=new byte[32768];for(int n;(n=in.read(part))!=-1;)digest.update(part,0,n);}return hex(digest.digest());}
    private static String digest(byte[] bytes)throws Exception{return hex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));}
    private static String hex(byte[] bytes){StringBuilder text=new StringBuilder();for(byte b:bytes)text.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return text.toString();}
    private static void field(OutputStream out,String b,String name,String value)throws Exception{out.write(("--"+b+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").getBytes(StandardCharsets.UTF_8));}
}

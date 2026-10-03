package com.ynxweb4.music;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.nio.*;
import java.util.*;

// Actual shipped controller/API/store and actual original SDK/Go business.
// JVM files/preferences/proof bridge are isolated, not installed Android QA.
public final class OriginalUploadCheck {
    static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    public static void main(String[]args)throws Exception {
        JSONObject input=new JSONObject(args[0]);Context context=new Context(Files.createTempDirectory("ynx-music-original-java-upload-").toFile());
        NativeSessionBridge bridge=new NativeSessionBridge(input.getJSONObject("session"),input.getJSONObject("context"));MusicApi api=new MusicApi(context,bridge);
        JSONObject me=api.get("/api/me");check(api.account().equals(me.getJSONObject("profile").getString("account")),"original account readback mismatch");MusicStore store=MusicStore.selectAccount(context,api.account());MusicUpload upload=new MusicUpload(api,store);
        byte[] wav=new byte[8044];ByteBuffer b=ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes()).putInt(wav.length-8).put("WAVEfmt ".getBytes()).putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(16000).putShort((short)1).putShort((short)8).put("data".getBytes()).putInt(wav.length-44);Arrays.fill(wav,44,wav.length,(byte)128);
        JSONObject intent=upload.stage(new ByteArrayInputStream(wav),"Android original protected audio","Original artist","Owned original fixture","Original generated PCM fixture");String key=intent.getString("key");
        boolean lost=false;try{upload.retry();}catch(IOException expected){lost=true;}check(lost,"original uploaded reply was not lost");check(store.load().getJSONObject("uploadIntent").getString("key").equals(key),"unconfirmed upload intent lost");check(Arrays.equals(Files.readAllBytes(store.uploadFile(key).toPath()),wav),"unconfirmed audio bytes lost");
        MusicApi old=api;bridge.restore();boolean retired=false;try{old.get("/api/me");}catch(IOException expected){retired=true;}check(retired,"retired Java epoch reached original business");
        api=new MusicApi(context,bridge);me=api.get("/api/me");check(api.account().equals(me.getJSONObject("profile").getString("account")),"cold original account mismatch");store=MusicStore.selectAccount(context,api.account());upload=new MusicUpload(api,store);check(store.load().getJSONObject("uploadIntent").getString("key").equals(key),"cold original operation changed");
        JSONObject track=upload.retry();check(!store.load().has("uploadIntent"),"confirmed original upload not acknowledged");check(me.getJSONArray("creatorTracks").length()==1,"lost-reply original upload already duplicated");
        api.release(track.getString("id"),"published","");File downloaded=api.download(track.getString("id"));check(Arrays.equals(Files.readAllBytes(downloaded.toPath()),wav),"original signed audio/cache differs from source");
        MusicStore other=MusicStore.selectAccount(context,"ynx1"+"a".repeat(38));check(!other.load().has("uploadIntent")&&!other.offline(track.getString("id")).exists(),"private upload/audio crossed account directory");boolean switched=false;try{upload.stage(new ByteArrayInputStream(wav),"Late","Artist","Owned","Original");}catch(IOException expected){switched=true;}check(switched,"old upload worker wrote to another account");
        store=MusicStore.selectAccount(context,api.account());upload=new MusicUpload(api,store);JSONObject cancel=upload.stage(new ByteArrayInputStream(wav),"Retained draft","Artist","Owned","Original");String cancelKey=cancel.getString("key");upload.cancel(cancelKey);check(!store.load().has("uploadIntent")&&store.uploadFile(cancelKey).isFile(),"cancel discarded original local bytes");
        JSONObject after=api.get("/api/me");check(after.getJSONArray("creatorTracks").length()==1,"cancel changed original server content");
        MusicReadBoundary reads=new MusicReadBoundary();long olderRead=reads.begin();JSONObject olderSnapshot=api.get("/api/me");
        JSONObject originalPlaylist=olderSnapshot.getJSONArray("playlists").getJSONObject(0);api.savePlaylist(originalPlaylist.getString("id"),"Newest original snapshot","Original ordered readback",originalPlaylist.getJSONArray("trackIds"));long newerRead=reads.begin();JSONObject newestSnapshot=api.get("/api/me");
        final MusicStore currentStore=store;final JSONObject latest=newestSnapshot;check(reads.commit(newerRead,()->{JSONObject current=currentStore.load();current.put("remote",latest);currentStore.save(current);}),"new original read not published");
        check(!reads.commit(olderRead,()->{JSONObject current=currentStore.load();current.put("remote",olderSnapshot);currentStore.save(current);}),"retired earlier read reached persisted cache");
        check(!reads.failed(olderRead)&&reads.state()==MusicReadBoundary.State.READY,"retired older error replaced ready state");
        check(currentStore.load().getJSONObject("remote").getJSONArray("playlists").getJSONObject(0).getString("name").equals("Newest original snapshot"),"new original playlist snapshot overwritten");
        long retiredRead=reads.begin();reads.retire();check(!reads.commit(retiredRead,()->{throw new AssertionError("retired UI/cache publication ran");})&&reads.state()==MusicReadBoundary.State.UNREAD,"sign-out read boundary not retired");
        long failingRead=reads.begin();boolean commitFailed=false;try{reads.commit(failingRead,()->{throw new IOException("Isolated original cache commit failure");});}catch(IOException expected){commitFailed=true;}check(commitFailed&&reads.failed(failingRead)&&reads.state()==MusicReadBoundary.State.FAILED,"failed cache commit claimed service readiness");
        System.out.println(new JSONObject().put("actualOrderedOriginalSnapshots",true).put("actualShippedJavaUploadController",true).put("actualOriginalSDKProof",true).put("actualBusinessServerReadback",true).put("oneOriginalTrackAfterLostReplyColdRetry",true).put("sameAccountSignedAudioCache",true).put("key",key).put("audioSHA256",intent.getString("audioSHA256")).put("actualOSStorage",false).put("actualWalletConsent",false).put("productionInstalled",false));
    }
}

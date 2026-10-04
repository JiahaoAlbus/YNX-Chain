package com.ynxweb4.music;
import android.content.Context;
import org.json.*;
import java.nio.file.*;
// Ordinary production-store/cache counterexample. No SDK/HTTP/Wallet authority.
public final class MusicCacheFieldCheck {
    static void check(boolean ok,String text){if(!ok)throw new AssertionError(text);}
    public static void main(String[] args)throws Exception {
        Context c=new Context(Files.createTempDirectory("music-field-cache-").toFile());String account="ynx1"+"a".repeat(38);MusicStore s=MusicStore.selectAccount(c,account);
        JSONObject oldUI=s.load();String key="music-upload-00000000-0000-0000-0000-000000000001";
        JSONObject upload=new JSONObject().put("key",key).put("title","Original owned draft").put("artist","Original artist").put("evidence","Owned").put("provenance","Original").put("audioSHA256","a".repeat(64));s.updateUpload(upload,null,false);
        JSONObject newest=s.load();newest.put("position",99).put("trackId","trk_"+"1".repeat(24)).put("downloads",new JSONObject().put("trk_"+"1".repeat(24),"available")).put("remote",new JSONObject().put("playlist","newer")).put("aiEnabled",false);s.save(newest);
        oldUI.put("favorites",new JSONArray().put("trk_"+"1".repeat(24)));JSONObject written=s.prepareLibrary(oldUI,()->{});
        check(written.getJSONObject("uploadIntent").getString("key").equals(key)&&written.getInt("position")==99&&written.getJSONObject("remote").getString("playlist").equals("newer")&&written.getJSONObject("downloads").length()==1&&!written.getBoolean("aiEnabled"),"stale UI patch replaced unrelated latest fields");
        String track="trk_"+"1".repeat(24),second="trk_"+"2".repeat(24);
        JSONObject queued=s.prepareLibrary(new JSONObject().put("queue",new JSONArray().put(second)),()->{});String libraryKey=queued.getJSONObject("libraryIntent").getString("id");
        JSONObject toggled=s.toggleLibrary("favorites",track,()->{});check(toggled.getJSONArray("favorites").length()==0&&toggled.getJSONArray("queue").getString(0).equals(second)&&toggled.getJSONObject("downloads").length()==1&&toggled.has("uploadIntent"),"current toggle overwrote latest queue/download/upload");
        JSONObject pendingCase=new JSONObject().put("key","music-trust-00000000-0000-0000-0000-000000000002").put("account",account).put("body",new JSONObject().put("kind","report").put("trackID",track).put("reason","Retained original case").put("evidenceRef",""));s.prepareCase(pendingCase,()->{});
        JSONObject stagedPlaylist=s.preparePlaylist("Original playlist",new JSONArray().put(track),()->{});JSONObject playlist=stagedPlaylist.getJSONObject("playlistCreation");
        s.commitAIEnabled(true,()->{});s.commitPlayback(second,123,()->{});
        JSONObject finished=s.finishPlaylist(playlist.getString("key"),playlist.getString("name"),playlist.getJSONArray("trackIDs"),false,()->{});
        check(finished.has("uploadIntent")&&finished.has("caseIntent")&&finished.has("libraryIntent")&&finished.getInt("position")==123&&finished.getBoolean("aiEnabled")&&finished.getJSONObject("remote").getString("playlist").equals("newer"),"playlist ACK or preference/playback replaced unrelated fields");
        JSONObject later=s.preparePlaylist("Successor",new JSONArray().put(second),()->{});String successor=later.getJSONObject("playlistCreation").getString("key");boolean oldAck=false;try{s.finishPlaylist(playlist.getString("key"),playlist.getString("name"),playlist.getJSONArray("trackIDs"),false,()->{});}catch(java.io.IOException expected){oldAck=true;}check(oldAck&&s.load().getJSONObject("playlistCreation").getString("key").equals(successor),"old playlist ACK consumed successor");
        s.updateUpload(upload,new JSONObject().put("playlist","obsolete upload readback"),true);JSONObject acked=s.load();check(acked.getJSONObject("remote").getString("playlist").equals("newer")&&acked.has("caseIntent")&&acked.getInt("position")==123,"upload ACK restored obsolete whole snapshot");
        MusicStore other=MusicStore.selectAccount(c,"ynx1"+"b".repeat(38));boolean foreign=false;try{s.commitAIEnabled(false,()->{});}catch(java.io.IOException expected){foreign=true;}check(foreign&&other.load().getBoolean("aiEnabled"),"field mutation crossed account");
        System.out.println(new JSONObject().put("staleUIFieldMergePreservesNewestStore",true).put("originalPendingSelectorsPreserved",true).put("fieldAcknowledgementRejectsSuccessor",true).put("cacheOnly",true).put("actualSDKAuthority",false));
    }
}

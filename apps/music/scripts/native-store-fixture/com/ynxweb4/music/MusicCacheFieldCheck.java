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
        JSONObject paused=s.pauseCase(pendingCase,()->{});check(!paused.has("caseIntent")&&paused.getJSONArray("caseHistory").length()==1&&paused.getInt("position")==123&&paused.has("playlistCreation"),"pause lost original intent or unrelated fields");
        JSONObject successorCase=new JSONObject(pendingCase.toString()).put("key","music-trust-00000000-0000-0000-0000-000000000003");successorCase.getJSONObject("body").put("reason","Distinct successor report");s.prepareCase(successorCase,()->{});
        boolean oldCaseAck=false,restoreBusy=false;try{s.acknowledgeCase(pendingCase,()->{});}catch(java.io.IOException expected){oldCaseAck=true;}try{s.restoreCase(pendingCase,()->{});}catch(java.io.IOException expected){restoreBusy=true;}check(oldCaseAck&&restoreBusy&&s.load().getJSONObject("caseIntent").getString("key").equals(successorCase.getString("key")),"old case ACK/restore consumed successor");
        s.acknowledgeCase(successorCase,()->{});JSONObject reopened=s.prepareCase(new JSONObject(pendingCase.toString()).put("key","music-trust-00000000-0000-0000-0000-000000000004"),()->{});check(reopened.getString("key").equals(pendingCase.getString("key"))&&s.load().getJSONArray("caseHistory").length()==0,"same-body recovery minted duplicate case key");
        int[] checks={0};boolean retiredPause=false;try{s.pauseCase(reopened,()->{if(++checks[0]>1)throw new java.io.IOException("retired at final write guard");});}catch(java.io.IOException expected){retiredPause=true;}check(retiredPause&&s.load().has("caseIntent")&&s.load().getJSONArray("caseHistory").length()==0,"retired pause persisted after final guard");
        s.pauseCase(reopened,()->{});s.restoreCase(reopened,()->{});check(s.load().getJSONObject("caseIntent").getString("key").equals(reopened.getString("key")),"explicit original restore changed key");s.acknowledgeCase(reopened,()->{});
        JSONObject appeal=new JSONObject(pendingCase.toString());appeal.getJSONObject("body").put("kind","appeal");boolean ownerDenied=false;try{s.prepareCase(appeal,()->{});}catch(java.io.IOException expected){ownerDenied=true;}check(ownerDenied&&!s.load().has("caseIntent"),"new unowned appeal left blocking intent");
        // Historical unknown outcomes remain recoverable even if the current
        // track is missing or changed owner. Do not impose a NEW-owner gate.
        JSONObject legacy=s.load();legacy.put("caseHistory",new JSONArray().put(appeal));s.save(legacy);s.restoreCase(appeal,()->{});check(s.load().has("caseIntent"),"old unknown request was blocked by new owner preflight");s.pauseCase(appeal,()->{});
        MusicStore other=MusicStore.selectAccount(c,"ynx1"+"b".repeat(38));boolean foreign=false,foreignRestore=false;try{s.commitAIEnabled(false,()->{});}catch(java.io.IOException expected){foreign=true;}try{s.restoreCase(appeal,()->{});}catch(java.io.IOException expected){foreignRestore=true;}check(foreign&&foreignRestore&&other.load().getBoolean("aiEnabled")&&!other.load().has("caseHistory"),"field or Trust restore crossed account");
        System.out.println(new JSONObject().put("staleUIFieldMergePreservesNewestStore",true).put("originalPendingSelectorsPreserved",true).put("fieldAcknowledgementRejectsSuccessor",true).put("cacheOnly",true).put("actualSDKAuthority",false));
    }
}

package com.ynxweb4.music;

import org.json.*;
import java.io.*;
import java.util.UUID;

// Shared by the normal picker/retry UI and isolated original-business QA.
// Original device keys, SDK custody and account directories are retained.
final class MusicUpload {
    private final MusicApi api;private final MusicStore store;
    MusicUpload(MusicApi api,MusicStore store){this.api=api;this.store=store;}
    JSONObject stage(InputStream selected,String title,String artist,String evidence,String provenance)throws Exception {
        api.assertCurrent();store.requireAccount(api.account());
        JSONObject state=store.load();if(state.has("uploadIntent"))throw new IOException("Original pending upload must be recovered or cancelled first");
        String[] values={title.trim(),artist.trim(),evidence.trim(),provenance.trim()};for(String value:values)if(value.isEmpty()||value.length()>1000)throw new IOException("Upload metadata is required");
        if(values[0].length()>120||values[1].length()>120)throw new IOException("Upload metadata exceeds limit");
        JSONObject intent=new JSONObject().put("key","music-upload-"+UUID.randomUUID()).put("title",values[0]).put("artist",values[1]).put("evidence",values[2]).put("provenance",values[3]);
        String hash=store.stageUpload(selected,intent.getString("key"),api::assertCurrent);intent.put("audioSHA256",hash);
        api.assertCurrent();store.updateUpload(intent,null,false);return intent;
    }
    JSONObject retry()throws Exception {
        api.assertCurrent();store.requireAccount(api.account());JSONObject state=store.load(),intent=state.getJSONObject("uploadIntent");
        File wav=store.uploadFile(intent.getString("key"));MusicApi.verifyLocal(wav,intent.getString("audioSHA256"));
        api.onboard(intent.getString("artist"));JSONObject track=api.upload(wav,intent.getString("title"),intent.getString("artist"),"owned",intent.getString("evidence"),intent.getString("provenance"),intent.getString("key"));
        verify(track,intent,api.account());JSONObject snapshot=api.get("/api/me");if(!api.account().equals(snapshot.getJSONObject("profile").getString("account")))throw new IOException("Original upload account readback mismatch");
        JSONArray tracks=snapshot.getJSONArray("creatorTracks");boolean found=false;for(int i=0;i<tracks.length();i++){JSONObject candidate=tracks.getJSONObject(i);if(track.getString("id").equals(candidate.getString("id"))){verify(candidate,intent,api.account());found=true;}}
        if(!found)throw new IOException("Original upload readback remains unconfirmed");
        api.assertCurrent();store.requireAccount(api.account());JSONObject latest=store.load(),pending=latest.optJSONObject("uploadIntent");
        if(pending==null||!NativeProductState.canonical(pending).equals(NativeProductState.canonical(intent)))throw new IOException("Original upload intent changed");
        store.updateUpload(intent,snapshot,true);return track;
    }
    void cancel(String key)throws Exception {api.assertCurrent();store.requireAccount(api.account());JSONObject state=store.load(),intent=state.optJSONObject("uploadIntent");if(intent==null||!intent.getString("key").equals(key))throw new IOException("Original upload changed");store.updateUpload(intent,null,true);}
    private static void verify(JSONObject track,JSONObject intent,String account)throws Exception {
        if(!track.getString("id").matches("trk_[0-9a-f]{24}")||!account.equals(track.getString("owner"))||!intent.getString("audioSHA256").equals(track.getString("audioSha256"))||!intent.getString("title").equals(track.getString("title"))||!intent.getString("artist").equals(track.getString("artistName"))||!intent.getString("evidence").equals(track.getJSONObject("rights").getString("evidenceRef"))||!intent.getString("provenance").equals(track.getJSONObject("provenance").getString("audio")))throw new IOException("Original owned upload content readback mismatch");
    }
}

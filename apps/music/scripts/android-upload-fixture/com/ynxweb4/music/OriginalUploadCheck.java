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
        final MusicStore currentStore=store;final MusicApi readApi=api;final JSONObject latest=newestSnapshot;check(reads.commit(newerRead,()->{currentStore.commitSnapshot(latest,readApi::assertCurrent);}),"new original read not published");
        check(!reads.commit(olderRead,()->{JSONObject current=currentStore.load();current.put("remote",olderSnapshot);currentStore.save(current);}),"retired earlier read reached persisted cache");
        check(!reads.failed(olderRead)&&reads.state()==MusicReadBoundary.State.READY,"retired older error replaced ready state");
        check(currentStore.load().getJSONObject("remote").getJSONArray("playlists").getJSONObject(0).getString("name").equals("Newest original snapshot"),"new original playlist snapshot overwritten");
        long retiredRead=reads.begin();reads.retire();check(!reads.commit(retiredRead,()->{throw new AssertionError("retired UI/cache publication ran");})&&reads.state()==MusicReadBoundary.State.UNREAD,"sign-out read boundary not retired");
        long failingRead=reads.begin();boolean commitFailed=false;try{reads.commit(failingRead,()->{throw new IOException("Isolated original cache commit failure");});}catch(IOException expected){commitFailed=true;}check(commitFailed&&reads.failed(failingRead)&&reads.state()==MusicReadBoundary.State.FAILED,"failed cache commit claimed service readiness");
        // Use original profile/library HTTP responses and the production cache
        // transactions; no Activity/Looper execution is claimed by this JVM.
        final MusicApi originalApi=api;
        JSONObject pendingDraft=new MusicUpload(originalApi,currentStore).stage(new ByteArrayInputStream(wav),"Pending during original library sync","Artist","Owned","Original");
        String draftKey=pendingDraft.getString("key");JSONObject local=currentStore.load();local.put("aiEnabled",false).put("favorites",new JSONArray().put(track.getString("id")));currentStore.save(local);
        JSONObject submittedProfile=new JSONObject(latest.getJSONObject("profile").toString()).put("displayName","Original current profile");
        JSONObject savedProfile=originalApi.updateProfile(submittedProfile);JSONObject profileCommit=currentStore.commitProfile(savedProfile,originalApi::assertCurrent);
        check(profileCommit.getJSONObject("uploadIntent").getString("key").equals(draftKey)&&!profileCommit.getBoolean("aiEnabled"),"profile commit replaced pending upload/preferences");
        check(profileCommit.getJSONObject("remote").getJSONArray("playlists").getJSONObject(0).getString("name").equals("Newest original snapshot"),"profile completion restored older playlist cache");
        JSONObject downloadCommit=currentStore.commitDownload(track.getString("id"),originalApi::assertCurrent);
        check(downloadCommit.getJSONObject("uploadIntent").getString("key").equals(draftKey)&&downloadCommit.getJSONArray("favorites").length()==1,"download commit replaced pending original fields");
        String libraryKey=downloadCommit.getJSONObject("libraryIntent").getString("id");
        List<Runnable> queued=new ArrayList<>();MusicLibraryWriter writer=new MusicLibraryWriter(queued::add);
        List<Boolean> acknowledgements=new ArrayList<>();List<Exception> failures=new ArrayList<>();
        MusicLibraryWriter.Completion completed=(ack,error)->{acknowledgements.add(ack);failures.add(error);};
        writer.submit(originalApi,currentStore,downloadCommit,originalApi::assertCurrent,completed);
        downloadCommit.getJSONObject("libraryIntent").getJSONArray("favorites").put("mutated-after-enqueue");
        queued.remove(0).run();check(!acknowledgements.get(0)&&failures.get(0)!=null,"lost original library reply was acknowledged");
        check(currentStore.load().getJSONObject("libraryIntent").getString("id").equals(libraryKey),"unconfirmed original library intent lost");
        bridge.restore();final MusicApi restoredApi=new MusicApi(context,bridge);MusicStore coldStore=MusicStore.selectAccount(context,restoredApi.account());
        JSONObject coldSnapshot=restoredApi.get("/api/me"),coldLibrary=coldStore.commitSnapshot(coldSnapshot,restoredApi::assertCurrent);
        check(!coldLibrary.has("libraryIntent")&&coldLibrary.getJSONArray("favorites").getString(0).equals(track.getString("id")),"original readback did not confirm lost reply without resending");
        check(coldLibrary.getJSONObject("downloads").getString(track.getString("id")).equals("available"),"original cold read lost verified audio availability");
        JSONObject olderIntent=coldStore.prepareLibrary(new JSONObject(coldLibrary.toString()).put("favorites",new JSONArray()),restoredApi::assertCurrent);
        writer.submit(restoredApi,coldStore,olderIntent,restoredApi::assertCurrent,completed);
        JSONObject newerIntent=coldStore.prepareLibrary(new JSONObject(coldStore.load().toString()).put("favorites",new JSONArray().put(track.getString("id"))).put("queue",new JSONArray().put(track.getString("id"))),restoredApi::assertCurrent);
        String newerKey=newerIntent.getJSONObject("libraryIntent").getString("id");writer.submit(restoredApi,coldStore,newerIntent,restoredApi::assertCurrent,completed);
        newerIntent.getJSONObject("libraryIntent").getJSONArray("queue").put("mutated-after-enqueue");
        queued.remove(0).run();check(!acknowledgements.get(1)&&failures.get(1)==null&&coldStore.load().getJSONObject("libraryIntent").getString("id").equals(newerKey),"older library work consumed successor intent");
        queued.remove(0).run();check(acknowledgements.get(2)&&failures.get(2)==null&&!coldStore.load().has("libraryIntent"),"current ordered original library write not confirmed");
        JSONObject ordered=restoredApi.get("/api/me").getJSONObject("listener");check(ordered.getJSONArray("favorites").length()==1&&ordered.getJSONArray("queue").length()==1,"immutable ordered library values not reflected by original service");
        restoredApi.saveLibrary(new JSONArray(),new JSONArray().put(track.getString("id")),new JSONObject());
        JSONObject imported=coldStore.commitSnapshot(restoredApi.get("/api/me"),restoredApi::assertCurrent);check(imported.getJSONArray("favorites").length()==0&&imported.getJSONArray("queue").length()==1,"normal snapshot did not merge original remote library");
        JSONObject retiring=coldStore.prepareLibrary(new JSONObject(imported.toString()).put("favorites",new JSONArray().put(track.getString("id"))),restoredApi::assertCurrent);String retiringKey=retiring.getJSONObject("libraryIntent").getString("id");writer.submit(restoredApi,coldStore,retiring,restoredApi::assertCurrent,completed);
        bridge.restore();queued.remove(0).run();check(!acknowledgements.get(3)&&failures.get(3)!=null&&coldStore.load().getJSONObject("libraryIntent").getString("id").equals(retiringKey),"retired original SDK worker sent or erased library intent");
        final MusicApi newestApi=new MusicApi(context,bridge);coldStore=MusicStore.selectAccount(context,newestApi.account());JSONObject recovered=coldStore.commitSnapshot(newestApi.get("/api/me"),newestApi::assertCurrent);check(recovered.getJSONObject("libraryIntent").getString("id").equals(retiringKey)&&recovered.getJSONArray("favorites").length()==1,"cold snapshot overwrote unconfirmed local original edit");
        writer.submit(newestApi,coldStore,recovered,newestApi::assertCurrent,completed);queued.remove(0).run();check(acknowledgements.get(4)&&!coldStore.load().has("libraryIntent"),"original restored intent could not complete");
        MusicStore switchedStore=MusicStore.selectAccount(context,"ynx1"+"b".repeat(38));boolean profileRetired=false;try{coldStore.commitProfile(savedProfile,newestApi::assertCurrent);}catch(IOException expected){profileRetired=true;}check(profileRetired&&!switchedStore.load().has("uploadIntent"),"old profile cache commit crossed account");
        coldStore=MusicStore.selectAccount(context,newestApi.account());check(coldStore.load().getJSONObject("uploadIntent").getString("key").equals(draftKey),"cache transactions lost original pending upload");new MusicUpload(newestApi,coldStore).cancel(draftKey);check(coldStore.uploadFile(draftKey).isFile(),"library sync discarded original audio draft");
        JSONObject foreignTrack=bridge.foreignTrackFixture();coldStore.commitSnapshot(newestApi.get("/api/me"),newestApi::assertCurrent);
        check(!MusicTrustCase.ownsTrack(coldStore.load(),newestApi.account(),foreignTrack.getString("id")),"foreign original track classified as owned");
        boolean ownerPreflight=false;try{new MusicTrustCase(newestApi,coldStore).stage("appeal",foreignTrack.getString("id"),"Foreign owner appeal","");}catch(IOException expected){ownerPreflight=true;}check(ownerPreflight&&!coldStore.load().has("caseIntent"),"foreign appeal staged an obstructing pending intent");
        JSONObject deniedBody=new JSONObject().put("kind","appeal").put("trackID",foreignTrack.getString("id")).put("reason","Foreign owner appeal").put("evidenceRef","");boolean serverDenied=false;try{newestApi.openCase(deniedBody,"music-trust-"+java.util.UUID.randomUUID());}catch(IOException expected){serverDenied=expected.getMessage().contains("music access denied");}newestApi.assertCurrent();check(serverDenied&&newestApi.get("/api/me").getJSONArray("cases").length()==0,"original owner denial changed SDK session or persisted case");
        for(String ownerKind:new String[]{"takedown"}){
            boolean localDenied=false;try{new MusicTrustCase(newestApi,coldStore).stage(ownerKind,foreignTrack.getString("id"),"Foreign owner request","");}catch(IOException expected){localDenied=true;}check(localDenied&&!coldStore.load().has("caseIntent"),"foreign takedown staged a blocking intent");
            boolean originalDenied=false;try{newestApi.openCase(new JSONObject(deniedBody.toString()).put("kind",ownerKind),"music-trust-"+java.util.UUID.randomUUID());}catch(IOException expected){originalDenied=expected.getMessage().contains("music access denied");}newestApi.assertCurrent();check(originalDenied&&newestApi.get("/api/me").getJSONArray("cases").length()==0,"foreign takedown changed original actor or case store");
        }
        int casesBefore=newestApi.get("/api/me").getJSONArray("cases").length();
        MusicTrustCase trust=new MusicTrustCase(newestApi,coldStore);
        JSONObject caseIntent=trust.stage("report",track.getString("id"),"Original unavailable Trust retry","sha256:original-native-case-evidence");String caseKey=caseIntent.getString("key");
        caseIntent.getJSONObject("body").put("reason","Mutated caller after durable stage");
        boolean duplicateStage=false;try{trust.stage("report",track.getString("id"),"New request must not replace unresolved case","");}catch(IOException expected){duplicateStage=true;}check(duplicateStage,"unresolved original Trust intent overwritten");
        boolean unavailable=false;try{trust.retry();}catch(Exception expected){unavailable=true;}check(unavailable,"unconfigured original Trust was reported successful");
        JSONObject savedIntent=coldStore.load().getJSONObject("caseIntent");check(savedIntent.getString("key").equals(caseKey)&&savedIntent.getJSONObject("body").getString("reason").equals("Original unavailable Trust retry"),"failure lost or mutated original case intent");
        coldStore.pauseCase(savedIntent,newestApi::assertCurrent);check(!coldStore.load().has("caseIntent")&&coldStore.load().getJSONArray("caseHistory").getJSONObject(0).getString("key").equals(caseKey),"local pause lost original key/body");
        bridge.restore();boolean staleTrust=false;try{trust.retry();}catch(IOException expected){staleTrust=true;}check(staleTrust,"retired original SDK sent Trust retry");
        final MusicApi caseApi=new MusicApi(context,bridge);coldStore=MusicStore.selectAccount(context,caseApi.account());trust=new MusicTrustCase(caseApi,coldStore);
        JSONObject coldPaused=coldStore.load();check(!coldPaused.has("caseIntent")&&coldPaused.getJSONArray("caseHistory").length()==1,"cold pause not retained");
        JSONObject restoredIntent=trust.stage("report",track.getString("id"),"Original unavailable Trust retry","sha256:original-native-case-evidence");check(restoredIntent.getString("key").equals(caseKey)&&coldStore.load().getJSONArray("caseHistory").length()==0,"same-body recovery minted a duplicate key");
        unavailable=false;try{trust.retry();}catch(Exception expected){unavailable=true;}check(unavailable,"cold unavailable Trust was acknowledged");
        JSONObject caseSnapshot=caseApi.get("/api/me");int casesAfter=caseSnapshot.getJSONArray("cases").length();check(casesAfter==casesBefore+1,"same original intent duplicated local case after SDK restore");
        JSONObject actualCase=null;for(int i=0;i<casesAfter;i++){JSONObject candidate=caseSnapshot.getJSONArray("cases").getJSONObject(i);if(candidate.getString("reason").equals("Original unavailable Trust retry"))actualCase=candidate;}check(actualCase!=null,"original persisted case missing");
        boolean unconfirmed=false;try{MusicTrustCase.verifyReceipt(actualCase,savedIntent);}catch(IOException expected){unconfirmed=true;}check(unconfirmed,"local case without Central receipt accepted");
        JSONObject tampered=new JSONObject(savedIntent.getJSONObject("body").toString()).put("reason","Changed body under original key");boolean conflict=false;try{caseApi.openCase(tampered,caseKey);}catch(IOException expected){conflict=true;}check(conflict,"original service accepted changed case body");
        MusicStore foreign=MusicStore.selectAccount(context,"ynx1"+"b".repeat(38));boolean foreignRetry=false;try{trust.retry();}catch(IOException expected){foreignRetry=true;}check(foreignRetry&&!foreign.load().has("caseIntent"),"pending Trust request crossed account");
        coldStore=MusicStore.selectAccount(context,caseApi.account());check(coldStore.load().getJSONObject("caseIntent").getString("key").equals(caseKey)&&coldStore.uploadFile(draftKey).isFile(),"Trust recovery discarded original case or audio draft");
        bridge.enableTrustFixture();trust=new MusicTrustCase(caseApi,coldStore);
        boolean lostCase=false;try{trust.retry();}catch(IOException expected){lostCase=true;}check(lostCase&&coldStore.load().getJSONObject("caseIntent").getString("key").equals(caseKey),"lost original successful Trust reply consumed pending intent");
        JSONObject linked=caseApi.get("/api/me");check(linked.getJSONArray("cases").length()==casesBefore+1&&linked.getJSONArray("cases").getJSONObject(0).getString("centralCaseId").equals("isolated-original-trust-receipt-1"),"original successful Trust receipt not committed once");
        bridge.restore();final MusicApi confirmedApi=new MusicApi(context,bridge);coldStore=MusicStore.selectAccount(context,confirmedApi.account());check(coldStore.load().getJSONObject("caseIntent").getString("key").equals(caseKey),"cold successful Trust original intent missing");
        JSONObject confirmed=new MusicTrustCase(confirmedApi,coldStore).retry();check(confirmed.getString("id").equals(actualCase.getString("id"))&&confirmed.getString("centralCaseId").equals("isolated-original-trust-receipt-1")&&!coldStore.load().has("caseIntent")&&coldStore.uploadFile(draftKey).isFile(),"same-key cold Trust confirmed replay failed or discarded audio");
        MusicApi rightsApi=confirmedApi;int expectedCases=casesBefore+1;
        for(String kind:new String[]{"dispute","appeal","takedown"}){
            coldStore.commitSnapshot(rightsApi.get("/api/me"),rightsApi::assertCurrent);String subject=kind.equals("dispute")?foreignTrack.getString("id"):track.getString("id");
            MusicTrustCase rights=new MusicTrustCase(rightsApi,coldStore);JSONObject originalIntent=rights.stage(kind,subject,"Original native "+kind+" recovery","sha256:original-native-"+kind+"-evidence");String originalKey=originalIntent.getString("key");boolean replyLost=false;try{rights.retry();}catch(IOException expected){replyLost=true;}check(replyLost&&coldStore.load().getJSONObject("caseIntent").getString("key").equals(originalKey),"unconfirmed rights request disappeared");
            bridge.restore();boolean oldRights=false;try{rights.retry();}catch(IOException expected){oldRights=true;}check(oldRights,"old SDK rights controller remained active");rightsApi=new MusicApi(context,bridge);coldStore=MusicStore.selectAccount(context,rightsApi.account());check(coldStore.load().getJSONObject("caseIntent").getString("key").equals(originalKey),"cold original rights key changed");
            JSONObject receipt=new MusicTrustCase(rightsApi,coldStore).retry();check(receipt.getString("kind").equals(kind)&&receipt.getString("trackId").equals(subject)&&receipt.getString("centralCaseId").equals("isolated-original-trust-"+kind+"-receipt-1")&&receipt.getString("status").equals("open")&&!coldStore.load().has("caseIntent"),"original rights receipt or matching ACK changed");
            JSONObject originalSnapshot=rightsApi.get("/api/me");check(originalSnapshot.getJSONArray("cases").length()==++expectedCases,"original logical rights request duplicated");coldStore.commitSnapshot(originalSnapshot,rightsApi::assertCurrent);JSONObject cached=coldStore.load().getJSONObject("remote");boolean found=false;for(int i=0;i<cached.getJSONArray("cases").length();i++){JSONObject record=cached.getJSONArray("cases").getJSONObject(i);check(rightsApi.account().equals(record.getString("openedBy")),"case readback leaked foreign account");if(record.getString("id").equals(receipt.getString("id"))){found=true;check(record.getString("reason").equals(originalIntent.getJSONObject("body").getString("reason"))&&record.getString("centralCaseId").equals(receipt.getString("centralCaseId")),"native case record differs from original service receipt");}}check(found&&coldStore.uploadFile(draftKey).isFile(),"original rights record or retained audio missing");
        }
        System.out.println(new JSONObject().put("nativeAllRightsKindsColdRecovery",true).put("nativeOriginalCaseRecordsReadback",true).put("foreignOwnerAppealRejectedWithoutLogout",true).put("originalPausedCaseColdSameKeyRecovery",true).put("actualOrderedOriginalSnapshots",true).put("originalTrustConfirmedLostReplyRecovery",true).put("isolatedTrustReceipt",true).put("actualCentralTrustAcceptance",false).put("originalSameKeyTrustRetrySingleCase",true).put("originalUnconfirmedTrustIntentRetained",true).put("actualMergedOriginalAccountCache",true).put("actualDurableOrderedLibrarySync",true).put("actualShippedJavaUploadController",true).put("actualOriginalSDKProof",true).put("actualBusinessServerReadback",true).put("oneOriginalTrackAfterLostReplyColdRetry",true).put("sameAccountSignedAudioCache",true).put("key",key).put("audioSHA256",intent.getString("audioSHA256")).put("actualOSStorage",false).put("actualWalletConsent",false).put("productionInstalled",false));
    }
}

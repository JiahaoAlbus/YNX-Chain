package com.ynxweb4.music;
import android.content.Context;
import org.json.*;
import java.nio.file.*;
public class TrustAppealBaseline {
 public static void main(String[] args)throws Exception {
  String actor="ynx1"+"a".repeat(38),foreign="ynx1"+"b".repeat(38),track="trk_"+"1".repeat(24);
  MusicStore store=MusicStore.selectAccount(new Context(Files.createTempDirectory("music-appeal-baseline-").toFile()),actor);
  JSONObject state=store.load();state.put("remote",new JSONObject().put("profile",new JSONObject().put("account",actor)).put("catalog",new JSONArray().put(new JSONObject().put("id",track).put("owner",foreign))));store.save(state);
  JSONObject intent=new JSONObject().put("key","music-trust-00000000-0000-0000-0000-000000000001").put("account",actor).put("body",new JSONObject().put("kind","appeal").put("trackID",track).put("reason","Foreign owner appeal").put("evidenceRef",""));
  store.prepareCase(intent,()->{});boolean blocked=false;try{store.prepareCase(new JSONObject(intent.toString()).put("key","music-trust-00000000-0000-0000-0000-000000000002"),()->{});}catch(java.io.IOException expected){blocked=true;}
  if(!blocked||!store.load().has("caseIntent"))throw new AssertionError("baseline defect not reproduced");
  System.out.println("BASELINE: foreign-owner appeal durably accepted locally; pending blocks successor. Cache-only observation; SDK/server permission not claimed. Source ac02f69af77c0b85b42e8a9b76431ac703a5a507.");
 }
}

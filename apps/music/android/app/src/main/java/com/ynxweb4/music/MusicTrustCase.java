package com.ynxweb4.music;

import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

// Same controller for the normal rights dialog and original-business QA.
// A local case alone never confirms that Trust accepted the request.
final class MusicTrustCase {
    private final MusicApi api;private final MusicStore store;
    MusicTrustCase(MusicApi api,MusicStore store){this.api=api;this.store=store;}
    JSONObject stage(String kind,String track,String reason,String evidence)throws Exception {
        api.assertCurrent();store.requireAccount(api.account());
        JSONObject body=new JSONObject().put("kind",kind.trim()).put("trackID",track.trim()).put("reason",reason.trim()).put("evidenceRef",evidence.trim());validateBody(body);
        JSONObject intent=new JSONObject().put("key","music-trust-"+java.util.UUID.randomUUID()).put("account",api.account()).put("body",body);
        store.prepareCase(intent,api::assertCurrent);return new JSONObject(intent.toString());
    }
    JSONObject retry()throws Exception {
        api.assertCurrent();store.requireAccount(api.account());JSONObject intent=store.load().getJSONObject("caseIntent");validateIntent(intent,api.account());
        JSONObject record=api.openCase(intent.getJSONObject("body"),intent.getString("key"));verifyReceipt(record,intent);api.assertCurrent();
        store.acknowledgeCase(intent,api::assertCurrent);return record;
    }
    static void validateIntent(JSONObject intent,String account)throws Exception {
        if(!account.equals(intent.getString("account"))||!intent.getString("key").matches("music-trust-[A-Fa-f0-9-]{36}"))throw new IOException("Original Trust intent account or key changed");validateBody(intent.getJSONObject("body"));
    }
    private static void validateBody(JSONObject body)throws Exception {
        String kind=body.getString("kind"),track=body.getString("trackID"),reason=body.getString("reason"),evidence=body.getString("evidenceRef");
        if(body.length()!=4||!kind.matches("report|takedown|dispute|appeal")||!track.matches("trk_[0-9a-f]{24}")||reason.length()<5||!reason.equals(reason.trim())||!evidence.equals(evidence.trim())||body.toString().getBytes(StandardCharsets.UTF_8).length>16*1024)throw new IOException("Trust request metadata is invalid");
    }
    static void verifyReceipt(JSONObject record,JSONObject intent)throws Exception {
        validateIntent(intent,intent.getString("account"));JSONObject body=intent.getJSONObject("body");String central=record.optString("centralCaseId");
        if(!record.getString("id").matches("case_[0-9a-f]{24}")||!intent.getString("account").equals(record.getString("openedBy"))||!body.getString("kind").equals(record.getString("kind"))||!body.getString("trackID").equals(record.getString("trackId"))||!body.getString("reason").equals(record.getString("reason"))||!body.getString("evidenceRef").equals(record.optString("evidenceRef"))||central.isEmpty()||!central.equals(central.trim())||central.length()>256)throw new IOException("Original Trust receipt remains unconfirmed");
    }
}

package com.ynxweb4.shop;

import org.json.JSONObject;
import org.junit.Test;
import java.time.Instant;
import static org.junit.Assert.*;

public final class PrivacyExportTest {
    private ProductSession session(String account,String token,Instant expiry)throws Exception {
        return ProductSession.parse(new JSONObject().put("account","ynx1"+account.repeat(38)).put("token",token.repeat(24)).put("expiresAt",expiry.toString()).toString(),Instant.now());
    }
    @Test public void fileResultAfterExpiryOrAccountChangeCannotConsumePrivatePayload()throws Exception {
        PrivacyExport export=new PrivacyExport();ProductSession owner=session("q","a",Instant.now().plusSeconds(240));
        int code=export.begin(owner);assertTrue(export.ready(code,owner,"private account export"));
        assertEquals("",export.consume(code,session("q","a",Instant.now().minusSeconds(1))));
        code=export.begin(owner);assertTrue(export.ready(code,owner,"private account export"));
        assertEquals("",export.consume(code,session("p","b",Instant.now().plusSeconds(240))));
    }
    @Test public void cancelledPickerCannotConsumeANewerExportAndPayloadIsOneUse()throws Exception {
        PrivacyExport export=new PrivacyExport();ProductSession owner=session("q","a",Instant.now().plusSeconds(240));
        int old=export.begin(owner);assertTrue(export.ready(old,owner,"old payload"));export.cancel(old);
        int current=export.begin(owner);assertNotEquals(old,current);assertFalse(export.ready(old,owner,"late old response"));
        assertTrue(export.ready(current,owner,"new payload"));assertEquals("",export.consume(old,owner));assertEquals("new payload",export.consume(current,owner));assertEquals("",export.consume(current,owner));
    }
    @Test public void replacementTokenAndLocalSignoutInvalidateThePicker()throws Exception {
        PrivacyExport export=new PrivacyExport();Instant expiry=Instant.now().plusSeconds(240);ProductSession owner=session("q","a",expiry);
        int code=export.begin(owner);assertTrue(export.ready(code,owner,"private export"));assertEquals("",export.consume(code,session("q","b",expiry)));
        code=export.begin(owner);assertTrue(export.ready(code,owner,"private export"));export.clear();assertFalse(export.matches(code));assertEquals("",export.consume(code,owner));
    }
}

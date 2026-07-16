package com.ynxweb4.music;

import android.net.Uri;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import junit.framework.TestCase;

public final class ContractInstrumentedTest extends TestCase {
    public void testWalletContractIsExactAndShortLived() throws Exception {
        long now=System.currentTimeMillis();
        Uri uri=CentralContracts.walletAuthorization(CentralContracts.nonce(),now);
        assertEquals("ynxwallet",uri.getScheme()); assertEquals("authorize",uri.getHost());
        JSONObject q=new JSONObject(new String(Base64.decode(uri.getQueryParameter("request"),Base64.URL_SAFE|Base64.NO_PADDING|Base64.NO_WRAP),StandardCharsets.UTF_8));
        assertEquals("1",q.getString("version")); assertEquals("ynx_6423-1",q.getString("chainId"));
        assertEquals("ynx-music-v1",q.getString("productClientId")); assertEquals("com.ynxweb4.music",q.getString("bundleId"));
        assertEquals("p256-sha256",q.getString("productDeviceAlgorithm"));
        assertTrue(Instant.parse(q.getString("expiresAt")).toEpochMilli()-Instant.parse(q.getString("issuedAt")).toEpochMilli()<=300000);
        JSONArray scopes=q.getJSONArray("scopes");for(int i=1;i<scopes.length();i++)assertTrue(scopes.getString(i-1).compareTo(scopes.getString(i))<0);
        assertEquals(13,q.length());
    }

    public void testAIPayTrustNeverFabricateAuthority() throws Exception {
        JSONObject ai=CentralContracts.aiRequest("playlist","organize",new JSONArray().put("track_owned"),"zh-Hans");
        assertTrue(ai.getBoolean("permission"));assertTrue(ai.getBoolean("explanationRequired"));
        Uri pay=CentralContracts.paySettlement("intent_1",1,"ynx1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assertEquals("requires_wallet_review",pay.getQueryParameter("status"));
        try { CentralContracts.trustCase("report","track","valid reason","sha256:abc",""); fail("empty idempotency accepted"); } catch(IllegalArgumentException expected){}
        assertEquals("open_case",CentralContracts.trustCase("report","track","valid reason","sha256:abc","case-1").getString("type"));
    }

}

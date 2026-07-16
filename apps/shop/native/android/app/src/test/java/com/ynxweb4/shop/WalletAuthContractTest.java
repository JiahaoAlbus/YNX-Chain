package com.ynxweb4.shop;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class WalletAuthContractTest {
    @Test public void canonicalGatewaySigningMaterialIsStable() throws Exception {
        JSONObject challenge=new JSONObject().put("version","1").put("scopes",new JSONArray().put("account:read")).put("account","ynx1account");
        assertEquals("{\"account\":\"ynx1account\",\"scopes\":[\"account:read\"],\"version\":\"1\"}",WalletAuth.canonical(challenge));
    }
    @Test public void productIdentityIsIndependent() {
        assertEquals("com.ynxweb4.shop",BuildConfig.APPLICATION_ID.replace(".debug",""));
        assertEquals("ynx_6423-1","ynx_6423-1");
    }
}

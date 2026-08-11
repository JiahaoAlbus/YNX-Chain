package com.ynxweb4.music;

import android.net.Uri;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.Signature;
import java.security.SecureRandom;
import java.security.MessageDigest;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Iterator;
import java.util.TreeSet;

/** Exact product-side contracts. Central services remain the verification authority. */
public final class CentralContracts {
    public static final String CHAIN = "ynx_6423-1";
    public static final int EVM_CHAIN = 6423;
    public static final String ASSET = "YNXT";
    public static final String CLIENT = "ynx-music-v1";
    public static final String BUNDLE = "com.ynxweb4.music";
    public static final String CALLBACK = "ynxmusic://auth/callback";
    public static final List<String> SCOPES = List.of("music.creator", "music.library", "music.playback", "music.profile");
    private CentralContracts() {}

    public static final class AuthorizationLaunch {
        public final Uri uri; public final JSONObject request;
        AuthorizationLaunch(Uri uri, JSONObject request) { this.uri=uri; this.request=request; }
    }

    public static AuthorizationLaunch walletAuthorization(String nonce, long nowMillis) throws Exception {
        if (!nonce.matches("[A-Za-z0-9_-]{32,64}")) throw new IllegalArgumentException("nonce");
        ArrayList<String> sorted = new ArrayList<>(SCOPES); Collections.sort(sorted);
        JSONObject request = new JSONObject();
        request.put("version", "1"); request.put("nonce", nonce); request.put("chainId", CHAIN);
        request.put("requestingProduct", "music"); request.put("productClientId", CLIENT); request.put("bundleId", BUNDLE);
        request.put("productDeviceAlgorithm", "p256-sha256"); request.put("productDeviceKey", devicePublicKey());
        request.put("callback", CALLBACK); request.put("scopes", new JSONArray(sorted));
        request.put("purpose", "Sign in to YNX Music without sharing Wallet recovery material");
        DateTimeFormatter millis = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
        request.put("issuedAt", millis.format(Instant.ofEpochMilli(nowMillis)));
        request.put("expiresAt", millis.format(Instant.ofEpochMilli(nowMillis + 5 * 60_000L)));
        String encoded = Base64.encodeToString(request.toString().getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        return new AuthorizationLaunch(Uri.parse("ynxwallet://authorize?request=" + encoded), request);
    }

    public static JSONObject walletApproval(String encoded, JSONObject request) throws Exception {
        byte[] raw=Base64.decode(encoded,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
        JSONObject approval=new JSONObject(new String(raw,StandardCharsets.UTF_8));
        for(String key:List.of("nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","purpose"))
            if(!request.getString(key).equals(approval.optString(key)))throw new SecurityException("Wallet approval binding mismatch: "+key);
        if(!request.getJSONArray("scopes").toString().equals(approval.optJSONArray("grantedScopes").toString()))throw new SecurityException("Wallet scope mismatch");
        return approval;
    }

    public static JSONObject gatewayCompletion(JSONObject challenge) throws Exception {
        if(!CLIENT.equals(challenge.getString("productClientId"))||!BUNDLE.equals(challenge.getString("bundleId"))||!devicePublicKey().equals(challenge.getString("productDeviceKey")))throw new SecurityException("Gateway challenge device binding mismatch");
        Signature signature=Signature.getInstance("SHA256withECDSA");
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        signature.initSign((java.security.PrivateKey)ks.getKey("ynx_music_device_v1",null));
        signature.update(("YNX_PRODUCT_SESSION_CHALLENGE_V1\n"+canonical(challenge)).getBytes(StandardCharsets.UTF_8));
        String proof=Base64.encodeToString(signature.sign(),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
        return new JSONObject().put("challenge",challenge).put("deviceSignature",proof);
    }

    public static JSONObject gatewayChallenge(JSONObject approval, long nowMillis) throws Exception {
        Instant now=Instant.ofEpochMilli(nowMillis),approvalExpiry=Instant.parse(approval.getString("expiresAt"));
        Instant expiry=now.plusSeconds(120).isBefore(approvalExpiry)?now.plusSeconds(120):approvalExpiry;
        if(!expiry.isAfter(now))throw new SecurityException("Wallet approval expired");
        DateTimeFormatter millis=new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
        return new JSONObject().put("version","1").put("challenge",nonce()).put("requestDigest",approval.getString("requestDigest"))
            .put("productClientId",CLIENT).put("bundleId",BUNDLE).put("productDeviceAlgorithm","p256-sha256")
            .put("productDeviceKey",devicePublicKey()).put("account",approval.getString("account")).put("scopes",approval.getJSONArray("grantedScopes"))
            .put("issuedAt",millis.format(now)).put("expiresAt",millis.format(expiry));
    }

    public static String productSessionProof(JSONObject session,String requiredScope,long nowMillis)throws Exception{
        if(!"music".equals(session.getString("requestingProduct"))||!CLIENT.equals(session.getString("productClientId"))||!BUNDLE.equals(session.getString("bundleId"))||!devicePublicKey().equals(session.getString("productDeviceKey")))throw new SecurityException("Product Session binding mismatch");
        JSONArray scopes=session.getJSONArray("scopes");boolean granted=false;for(int i=0;i<scopes.length();i++)if(requiredScope.equals(scopes.getString(i)))granted=true;if(!granted)throw new SecurityException("Product Session scope missing");
        Instant now=Instant.ofEpochMilli(nowMillis),sessionExpiry=Instant.parse(session.getString("expiresAt")),expiry=now.plusSeconds(30).isBefore(sessionExpiry)?now.plusSeconds(30):sessionExpiry;
        if(!expiry.isAfter(now))throw new SecurityException("Product Session expired");
        String body=canonical(new JSONObject().put("requiredScopes",new JSONArray().put(requiredScope)));
        String digest=hex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8)));
        DateTimeFormatter millis=new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
        JSONObject unsigned=new JSONObject().put("version","1").put("sessionBinding",session.getString("sessionBinding")).put("productClientId",CLIENT).put("bundleId",BUNDLE).put("productDeviceKey",devicePublicKey()).put("method","POST").put("path","/v1/wallet/sessions/introspect").put("bodyDigest",digest).put("nonce",nonce()).put("issuedAt",millis.format(now)).put("expiresAt",millis.format(expiry));
        Signature signer=Signature.getInstance("SHA256withECDSA");KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);signer.initSign((java.security.PrivateKey)ks.getKey("ynx_music_device_v1",null));signer.update(("YNX_PRODUCT_SESSION_HTTP_PROOF_V1\n"+canonical(unsigned)).getBytes(StandardCharsets.UTF_8));
        JSONObject proof=new JSONObject(unsigned.toString()).put("signature",Base64.encodeToString(signer.sign(),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING));
        return Base64.encodeToString(canonical(proof).getBytes(StandardCharsets.UTF_8),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
    }

    public static String productDeviceKey() throws Exception { return devicePublicKey(); }

    private static String canonical(Object value) throws Exception {
        if(value==JSONObject.NULL)return "null";
        if(value instanceof JSONObject){JSONObject o=(JSONObject)value;StringBuilder b=new StringBuilder("{");boolean first=true;TreeSet<String> keys=new TreeSet<>();Iterator<String> i=o.keys();while(i.hasNext())keys.add(i.next());for(String key:keys){if(!first)b.append(',');first=false;b.append(JSONObject.quote(key)).append(':').append(canonical(o.get(key)));}return b.append('}').toString();}
        if(value instanceof JSONArray){JSONArray a=(JSONArray)value;StringBuilder b=new StringBuilder("[");for(int i=0;i<a.length();i++){if(i>0)b.append(',');b.append(canonical(a.get(i)));}return b.append(']').toString();}
        if(value instanceof String)return JSONObject.quote((String)value);
        if(value instanceof Boolean||value instanceof Number)return value.toString();
        throw new IllegalArgumentException("unsupported canonical JSON value");
    }

    public static JSONObject aiRequest(String kind, String intent, JSONArray trackIds, String language) throws Exception {
        if (!List.of("playlist", "metadata", "discovery", "creator_description", "royalty_explanation").contains(kind)) throw new IllegalArgumentException("AI kind");
        return new JSONObject().put("kind", kind).put("intent", intent).put("provider", "ynx-ai-gateway").put("model", "operator-selected").put("trackIDs", trackIds).put("permission", true).put("outputLanguage", language).put("explanationRequired", true);
    }

    public static Uri paySettlement(String intentId, long amountMicros, String payTo) {
        if (amountMicros <= 0 || !payTo.startsWith("ynx1")) throw new IllegalArgumentException("settlement");
        return Uri.parse("ynxpay://settlement/review").buildUpon().appendQueryParameter("intent", intentId).appendQueryParameter("asset", ASSET).appendQueryParameter("amountMicros", Long.toString(amountMicros)).appendQueryParameter("payTo", payTo).appendQueryParameter("status", "requires_wallet_review").build();
    }

    public static JSONObject trustCase(String kind, String trackId, String reason, String evidenceRef, String idempotencyKey) throws Exception {
        if (!List.of("report", "takedown", "dispute", "appeal").contains(kind) || reason.trim().length() < 5 || idempotencyKey.isBlank()) throw new IllegalArgumentException("Trust case");
        JSONObject evidence = new JSONObject().put("source", "ynx-music").put("digest", evidenceRef).put("summary", reason).put("collectedAt", Instant.now().toString()).put("visibleToSubject", true);
        return new JSONObject().put("type", "open_case").put("idempotencyKey", idempotencyKey).put("subject", trackId).put("requestScope", "music.rights").put("purpose", reason).put("requestedAction", kind).put("evidence", new JSONArray().put(evidence));
    }

    public static String nonce() { byte[] b = new byte[24]; new SecureRandom().nextBytes(b); return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    private static String devicePublicKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias("ynx_music_device_v1")) {
            KeyPairGenerator g = KeyPairGenerator.getInstance("EC", "AndroidKeyStore");
            g.initialize(new android.security.keystore.KeyGenParameterSpec.Builder("ynx_music_device_v1", android.security.keystore.KeyProperties.PURPOSE_SIGN | android.security.keystore.KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256).build()); g.generateKeyPair();
        }
        KeyPair pair = new KeyPair(ks.getCertificate("ynx_music_device_v1").getPublicKey(), (java.security.PrivateKey) ks.getKey("ynx_music_device_v1", null));
        java.security.interfaces.ECPublicKey pub = (java.security.interfaces.ECPublicKey) pair.getPublic();
        byte[] x = fixed(pub.getW().getAffineX().toByteArray()); byte[] out = new byte[33]; out[0] = (byte) (pub.getW().getAffineY().testBit(0) ? 3 : 2); System.arraycopy(x, 0, out, 1, 32);
        return Base64.encodeToString(out, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }
    private static byte[] fixed(byte[] in) { byte[] out = new byte[32]; System.arraycopy(in, Math.max(0, in.length - 32), out, Math.max(0, 32 - in.length), Math.min(32, in.length)); return out; }
    private static String hex(byte[] in){StringBuilder out=new StringBuilder();for(byte value:in)out.append(String.format("%02x",value&255));return out.toString();}
}

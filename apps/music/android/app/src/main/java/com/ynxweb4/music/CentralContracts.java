package com.ynxweb4.music;

import android.net.Uri;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

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

    public static Uri walletAuthorization(String nonce, long nowMillis) throws Exception {
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
        return Uri.parse("ynxwallet://authorize?request=" + encoded);
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
        if (!List.of("report", "takedown", "dispute").contains(kind) || reason.trim().length() < 5 || idempotencyKey.isBlank()) throw new IllegalArgumentException("Trust case");
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
}

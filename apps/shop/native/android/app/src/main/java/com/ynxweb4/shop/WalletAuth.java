package com.ynxweb4.shop;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.temporal.ChronoUnit;
import java.util.*;

final class WalletAuth {
    private static final DateTimeFormatter PROTOCOL_TIME = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    interface Result { void done(String account, Exception error); }
    private static final String KEY_ALIAS = "ynx_shop_product_device_p256_v1";
    private final Context context;
    private final SecureStore secure;
    private final ApiClient api;

    WalletAuth(Context context, SecureStore secure, ApiClient api) { this.context=context; this.secure=secure; this.api=api; }

    void start(Result result) {
        api.request("GET", "/auth/config?surface=buyer", null, (config,error) -> {
            if(error!=null){result.done(null,error);return;}
            try {
                require(config.optString("version").equals("1") && config.optString("chainId").equals("ynx_6423-1"), "unsafe Wallet protocol");
                require(config.optString("productClientId").equals("ynx-shop-v1") && config.optString("bundleId").equals("com.ynxweb4.shop"), "unsafe product binding");
                require(config.optString("callback").equals("ynxshop://wallet-auth/callback") && config.optString("productDeviceAlgorithm").equals("p256-sha256"), "unsafe callback or algorithm");
                require(config.optString("gateway").equals("available"), "central Wallet Gateway unavailable");
                Instant now=Instant.now().truncatedTo(ChronoUnit.MILLIS);
                JSONObject request=new JSONObject();
                request.put("version","1"); request.put("nonce",randomToken(32)); request.put("chainId","ynx_6423-1");
                request.put("requestingProduct","shop"); request.put("productClientId","ynx-shop-v1"); request.put("bundleId","com.ynxweb4.shop");
                request.put("productDeviceAlgorithm","p256-sha256"); request.put("productDeviceKey",compressedPublicKey());
                request.put("callback","ynxshop://wallet-auth/callback");
                request.put("scopes",new JSONArray(List.of("account:read","shop:orders:write","shop:profile:write")));
                request.put("purpose",context.getString(R.string.signing_text)); request.put("issuedAt",PROTOCOL_TIME.format(now)); request.put("expiresAt",PROTOCOL_TIME.format(now.plus(4,ChronoUnit.MINUTES)));
                secure.put("wallet_pending",canonical(request));
                String encoded=Base64.encodeToString(canonical(request).getBytes(StandardCharsets.UTF_8),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
                context.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("ynxwallet://authorize?request="+encoded)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                result.done("",null);
            } catch(Exception failure){result.done(null,failure);}
        });
    }

    void complete(Uri callback, Result result) {
        new Thread(() -> {
            try {
                require(callback!=null && "ynxshop".equals(callback.getScheme()) && "wallet-auth".equals(callback.getHost()) && "/callback".equals(callback.getPath()), "callback route mismatch");
                String encoded=callback.getQueryParameter("response"); require(encoded!=null && !encoded.isEmpty(),"missing Wallet response");
                JSONObject pending=new JSONObject(secure.get("wallet_pending")); require(pending.length()>0,"missing product request");
                JSONObject approval=new JSONObject(new String(Base64.decode(encoded,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),StandardCharsets.UTF_8));
                for(String field:List.of("nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","purpose"))
                    require(Objects.equals(approval.optString(field),pending.optString(field)),"Wallet binding mismatch: "+field);
                require(canonical(approval.getJSONArray("grantedScopes")).equals(canonical(pending.getJSONArray("scopes"))),"scope mismatch");
                require(Instant.parse(approval.getString("expiresAt")).isAfter(Instant.now()) && !Instant.parse(approval.getString("expiresAt")).isAfter(Instant.parse(pending.getString("expiresAt"))),"expiry mismatch");
                String replay="replay_"+approval.getString("requestDigest");
                require(secure.get(replay).isEmpty(),"Wallet callback replay rejected");
                JSONObject envelope=api.requestSync("POST","/auth/gateway/challenges",approval);
                JSONObject challenge=envelope.optJSONObject("challenge"); if(challenge==null)challenge=envelope;
                byte[] material=("YNX_PRODUCT_SESSION_CHALLENGE_V1\n"+canonical(challenge)).getBytes(StandardCharsets.UTF_8);
                Signature signer=Signature.getInstance("SHA256withECDSA"); signer.initSign(privateKey()); signer.update(material);
                JSONObject completion=new JSONObject().put("challenge",challenge).put("deviceSignature",Base64.encodeToString(signer.sign(),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING));
                JSONObject session=api.requestSync("POST","/auth/gateway/sessions",completion);
                String token=session.optString("token"), account=session.optString("account");
                require(token.length()>=24 && account.equals(approval.getString("account")) && Instant.parse(session.getString("expiresAt")).isAfter(Instant.now()),"invalid central product session");
                secure.put("bearer",token); secure.put(replay,Instant.now().toString()); secure.remove("wallet_pending");
                result.done(account,null);
            } catch(Exception failure){result.done(null,failure);}
        }).start();
    }

    private PrivateKey privateKey() throws Exception { return ((KeyStore.PrivateKeyEntry)keyStore().getEntry(KEY_ALIAS,null)).getPrivateKey(); }
    private String compressedPublicKey() throws Exception {
        ECPublicKey key=(ECPublicKey)((KeyStore.PrivateKeyEntry)keyStore().getEntry(KEY_ALIAS,null)).getCertificate().getPublicKey();
        byte[] x=fixed(key.getW().getAffineX(),32), y=fixed(key.getW().getAffineY(),32), out=new byte[33]; out[0]=(byte)(2+(y[31]&1)); System.arraycopy(x,0,out,1,32);
        return Base64.encodeToString(out,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
    }
    private KeyStore keyStore() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if(!store.containsAlias(KEY_ALIAS)){
            KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).setUserAuthenticationRequired(false).build());
            generator.generateKeyPair();
        }
        return store;
    }
    static String canonical(Object value) throws Exception {
        if(value==JSONObject.NULL)return "null";
        if(value instanceof JSONObject object){List<String> keys=new ArrayList<>();object.keys().forEachRemaining(keys::add);Collections.sort(keys);StringBuilder b=new StringBuilder("{");for(int i=0;i<keys.size();i++){if(i>0)b.append(',');String k=keys.get(i);b.append(JSONObject.quote(k)).append(':').append(canonical(object.get(k)));}return b.append('}').toString();}
        if(value instanceof JSONArray array){StringBuilder b=new StringBuilder("[");for(int i=0;i<array.length();i++){if(i>0)b.append(',');b.append(canonical(array.get(i)));}return b.append(']').toString();}
        if(value instanceof String text)return JSONObject.quote(text);
        if(value instanceof Boolean||value instanceof Number)return String.valueOf(value);
        throw new SecurityException("unsupported canonical JSON value");
    }
    private static byte[] fixed(BigInteger number,int size){byte[] raw=number.toByteArray(),out=new byte[size];int source=Math.max(0,raw.length-size),count=Math.min(size,raw.length);System.arraycopy(raw,source,out,size-count,count);return out;}
    private static String randomToken(int bytes){byte[] raw=new byte[bytes];new SecureRandom().nextBytes(raw);return Base64.encodeToString(raw,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);}
    private static void require(boolean condition,String message){if(!condition)throw new SecurityException(message);}
}

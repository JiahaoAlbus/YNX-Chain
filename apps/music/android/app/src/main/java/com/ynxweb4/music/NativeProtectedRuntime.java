package com.ynxweb4.music;

import android.content.Context;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.security.keystore.KeyInfo;
import org.json.JSONObject;
import java.security.KeyStore;
import java.security.KeyPairGenerator;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.math.BigInteger;
import java.util.concurrent.CompletableFuture;
import java.util.Arrays;

// Adapted from verified f4f5fad OS-port structure. Reuses the ORIGINAL Music
// ynx_music_device_v1 signer and ynx_music_session_aes_v1 custody; no exported
// device/account keys, replacement account vault or legacy record migration.
// These ports are callable only by the owner-controlled SDK bridge. They are
// not exported to arbitrary Web content, Intent extras or legacy WalletAuth.
final class NativeProtectedRuntime {
    private static final String KEY_ALIAS="ynx_music_device_v1";
    private final Context application;
    private final NativeProductState state;
    private final PrivateKey privateKey;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final SecureRandom random=new SecureRandom();
    NativeProtectedRuntime(Context context)throws Exception{
 NativeStateCustody secure=new NativeStateCustody(context);
 String inherited=secure.read();
        application=context.getApplicationContext();if(!NativeProductState.APP.equals(application.getPackageName()))throw new SecurityException("Registered native package required; debug suffix is not approved");KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);
        if(!keys.containsAlias(KEY_ALIAS)){if(!inherited.isEmpty()||SecureStore.hasSavedRecord(context))throw new SecurityException("Original protected key missing; preserve recovery state");KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");generator.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).setUserAuthenticationRequired(false).build());generator.generateKeyPair();}
        privateKey=(PrivateKey)keys.getKey(KEY_ALIAS,null);if(privateKey==null||privateKey.getEncoded()!=null)throw new SecurityException("Nonexportable OS P256 key required");ECPublicKey publicKey=(ECPublicKey)keys.getCertificate(KEY_ALIAS).getPublicKey();if(publicKey.getParams().getCurve().getField().getFieldSize()!=256)throw new SecurityException("P256 curve required");KeyInfo info=KeyFactory.getInstance(privateKey.getAlgorithm(),"AndroidKeyStore").getKeySpec(privateKey,KeyInfo.class);String protection=info.isInsideSecureHardware()?"hardware-backed":"os-protected";byte[] compressed=new byte[33];compressed[0]=(byte)(publicKey.getW().getAffineY().testBit(0)?3:2);byte[] x=unsigned32(publicKey.getW().getAffineX());System.arraycopy(x,0,compressed,1,32);String deviceKey=java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(compressed);String deviceId=java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes(32));
        state=new NativeProductState(new NativeProductState.Persistence(){public String read()throws Exception{return secure.read();}public void write(String raw)throws Exception{secure.write(raw);}},deviceId,deviceKey,protection);
    }
    JSONObject readContext()throws Exception{return state.context();}
    void selectAccount(String account)throws Exception{state.selectAccount(account);}
    byte[] randomBytes(int length){if(length!=32)throw new SecurityException("32-byte CSPRNG token required");byte[] bytes=new byte[32];random.nextBytes(bytes);return bytes;}
    void requestCurrentRevocation()throws Exception{state.requestCurrentRevocation(state.context());}
    String sign(JSONObject input,JSONObject expected,boolean revokeOnly)throws Exception{return state.sign(input,expected,revokeOnly,bytes->{Signature signer=Signature.getInstance("SHA256withECDSA");signer.initSign(privateKey);signer.update(bytes);return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign());});}
    CompletableFuture<Boolean> openWallet(JSONObject provided,JSONObject context){CompletableFuture<Boolean> opened=new CompletableFuture<>();final JSONObject input,expected;try{input=new JSONObject(provided.toString());expected=new JSONObject(context.toString());}catch(Exception invalid){opened.completeExceptionally(invalid);return opened;}main.post(()->{try{opened.complete(state.withSigningExpected(expected,()->{if(input.length()!=2)throw new SecurityException("Exact prepared Wallet input required");JSONObject request=input.getJSONObject("request");String text=input.getString("url");Uri uri=Uri.parse(text);if(!"ynxwallet".equals(uri.getScheme())||!"authorize".equals(uri.getHost())||uri.getUserInfo()!=null||uri.getPort()!=-1||uri.getFragment()!=null||!"".equals(uri.getPath())||uri.getQueryParameterNames().size()!=1||!uri.getQueryParameterNames().contains("request"))throw new SecurityException("Original registered Wallet route required");String encoded=uri.getQueryParameter("request");if(encoded==null||encoded.length()>32768||!text.equals("ynxwallet://authorize?request="+encoded)||!encoded.matches("[A-Za-z0-9_-]+"))throw new SecurityException("Original prepared request required");byte[] raw=java.util.Base64.getUrlDecoder().decode(encoded);if(!java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(raw).equals(encoded)||!NativeProductState.canonical(new JSONObject(new String(raw,java.nio.charset.StandardCharsets.UTF_8))).equals(NativeProductState.canonical(request)))throw new SecurityException("Prepared Wallet URL/request changed");NativeProductState.checkWalletRequest(request,expected);try{application.startActivity(new Intent(Intent.ACTION_VIEW,uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));return true;}catch(ActivityNotFoundException absent){return false;}}));}catch(Exception error){opened.completeExceptionally(error);}});return opened;}
    String get(String namespace,String key,JSONObject expected)throws Exception{return state.get(namespace,key,expected);}
    void set(String namespace,String key,String value,JSONObject expected)throws Exception{state.set(namespace,key,value,expected);}
    void remove(String namespace,String key,JSONObject expected)throws Exception{state.remove(namespace,key,expected);}
    void requestRevocation(String namespace,JSONObject expected)throws Exception{state.requestRevocation(namespace,expected);}
    boolean revocationRequested(String namespace,JSONObject expected)throws Exception{return state.revocationRequested(namespace,expected);}
    String saveRevocationIntent(String namespace,String key,String raw,JSONObject expected)throws Exception{return state.saveRevocationIntent(namespace,key,raw,expected);}
    void finishRevocationIntent(String namespace,String key,String raw,JSONObject expected)throws Exception{state.finishRevocationIntent(namespace,key,raw,expected);}
    private static byte[] unsigned32(BigInteger value){byte[] raw=value.toByteArray();if(raw.length>33||raw.length==33&&raw[0]!=0)throw new SecurityException("Invalid public P256 coordinate");return raw.length>=32?Arrays.copyOfRange(raw,raw.length-32,raw.length):pad(raw);}
    private static byte[] pad(byte[] raw){byte[] result=new byte[32];System.arraycopy(raw,0,result,32-raw.length,raw.length);return result;}
}

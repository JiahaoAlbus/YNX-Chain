package com.ynx.social;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.digests.KeccakDigest;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPublicKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.json.JSONArray;
import org.json.JSONObject;

public final class MainActivity extends Activity {
  private static final String BLUE="#002FA7";
  private static final String DEVICE_ALGORITHM="p256-sha256";
  private static final String CALLBACK="ynx-social://com.ynx.social";
  private static final String PREFERENCES="ynx-social-wallet-auth-proof";
  private static final String PENDING_REQUEST="pending-request";
  private static final DateTimeFormatter MILLIS=new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
  private static final Set<String> REQUEST_FIELDS=Set.of("version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","scopes","purpose","issuedAt","expiresAt");
  private static final Set<String> RESPONSE_FIELDS=Set.of("version","requestDigest","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","account","accountPublicKey","grantedScopes","purpose","issuedAt","expiresAt","walletSignature");
  private static final Set<String> CHALLENGE_FIELDS=Set.of("version","challenge","requestDigest","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","account","scopes","issuedAt","expiresAt");

  private TextView status;
  private Button replayButton;
  private KeyPair deviceKey;
  private SharedPreferences preferences;

  @Override public void onCreate(Bundle state){super.onCreate(state);try{preferences=getSharedPreferences(PREFERENCES,MODE_PRIVATE);deviceKey=loadOrCreateDeviceKey();}catch(Exception error){throw new IllegalStateException(error);}render();handle(getIntent());}
  @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handle(intent);}

  private void render(){
    LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setGravity(Gravity.CENTER_HORIZONTAL);root.setPadding(64,120,64,64);root.setBackgroundColor(Color.WHITE);
    root.addView(text("CROSS-APP PROOF",14,Color.parseColor(BLUE)));
    TextView title=text("YNX Social",34,Color.rgb(16,24,40));title.setPadding(0,24,0,18);root.addView(title);
    TextView identity=text("Package com.ynx.social\nProduct client ynx-social-v1\nP-256 device key remains in Android Keystore",16,Color.rgb(102,112,133));identity.setGravity(Gravity.CENTER);root.addView(identity);
    Button button=new Button(this);button.setText("Sign in with YNX Wallet");button.setContentDescription("Social starts Sign in with YNX Wallet");button.setTextColor(Color.WHITE);button.setBackgroundColor(Color.parseColor(BLUE));LinearLayout.LayoutParams buttonParams=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,140);buttonParams.setMargins(0,70,0,42);root.addView(button,buttonParams);button.setOnClickListener(view->startWallet());
    status=text("Ready. Social owns its P-256 device private key; Wallet owns the account key.",16,Color.rgb(52,64,84));status.setGravity(Gravity.CENTER);root.addView(status);
    replayButton=new Button(this);replayButton.setText("Replay exact Wallet callback");replayButton.setContentDescription("Replay exact Wallet callback");replayButton.setVisibility(View.GONE);replayButton.setOnClickListener(view->handle(getIntent()));LinearLayout.LayoutParams replayParams=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,140);replayParams.setMargins(0,42,0,0);root.addView(replayButton,replayParams);
    setContentView(root);
  }

  private TextView text(String value,int size,int color){TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(color);view.setLineSpacing(8,1);return view;}

  private void startWallet(){
    try{
      Instant now=Instant.now();String nonce="social_emulator_nonce_"+Long.toUnsignedString(System.nanoTime(),36);
      if(nonce.length()<32)nonce=(nonce+"abcdefghijklmnopqrstuvwxyz").substring(0,32);if(nonce.length()>64)nonce=nonce.substring(0,64);
      JSONObject request=new JSONObject();
      request.put("version","1");request.put("nonce",nonce);request.put("chainId","ynx_6423-1");request.put("requestingProduct","social");request.put("productClientId","ynx-social-v1");request.put("bundleId",getPackageName());request.put("productDeviceAlgorithm",DEVICE_ALGORITHM);request.put("productDeviceKey",devicePublicKey());request.put("callback",CALLBACK);request.put("scopes",new JSONArray().put("account:read").put("profile:link"));request.put("purpose","Link this exact Social emulator device to the selected YNX account.");request.put("issuedAt",format(now.minusSeconds(30)));request.put("expiresAt",format(now.plusSeconds(240)));
      requireExactFields(request,REQUEST_FIELDS,"request");preferences.edit().putString(PENDING_REQUEST,request.toString()).apply();
      String payload=base64url(request.toString().getBytes(StandardCharsets.UTF_8));
      startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("ynxwallet://authorize?request="+payload)));
    }catch(Exception error){status.setText("Request failed: "+detail(error));}
  }

  private void handle(Intent intent){
    Uri uri=intent.getData();if(uri==null)return;
    try{
      if(!"ynx-social".equals(uri.getScheme())||!"com.ynx.social".equals(uri.getHost())||(uri.getPath()!=null&&!uri.getPath().isEmpty())||uri.getFragment()!=null||!uri.getQueryParameterNames().equals(Set.of("response")))throw new SecurityException("callback route substituted");
      String encoded=uri.getQueryParameter("response");if(encoded==null)throw new IllegalArgumentException("response missing");
      JSONObject response=new JSONObject(new String(Base64.decode(encoded,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),StandardCharsets.UTF_8));
      JSONObject request=pendingRequest();
      verifyWalletApproval(response,request,Instant.now());
      String nonce=response.getString("nonce");if(preferences.getBoolean("consumed."+nonce,false)){status.setText("Replay rejected: verified Wallet response nonce was already consumed.");return;}
      preferences.edit().putBoolean("consumed."+nonce,true).apply();
      JSONObject challenge=createGatewayChallenge(response,Instant.now());
      byte[] signBytes=("YNX_PRODUCT_SESSION_CHALLENGE_V1\n"+canonical(challenge)).getBytes(StandardCharsets.UTF_8);
      Signature signer=Signature.getInstance("SHA256withECDSA");signer.initSign(deviceKey.getPrivate());signer.update(signBytes);byte[] deviceSignature=signer.sign();
      verifyGatewayCompletion(challenge,deviceSignature,response,Instant.now());
      status.setText("Wallet approval verified.\nGateway verifier accepted the P-256 device proof.\nProduct-limited session: ynx-social-v1\nAccount: "+response.getString("account")+"\nNo Wallet secret entered Social.");
      replayButton.setVisibility(View.VISIBLE);
    }catch(Exception error){status.setText("Callback rejected: "+detail(error));}
  }

  private JSONObject pendingRequest() throws Exception {String value=preferences.getString(PENDING_REQUEST,null);if(value==null)throw new SecurityException("pending request missing");JSONObject request=new JSONObject(value);requireExactFields(request,REQUEST_FIELDS,"pending request");return request;}

  private void verifyWalletApproval(JSONObject response,JSONObject request,Instant now) throws Exception {
    requireExactFields(response,RESPONSE_FIELDS,"Wallet approval");
    for(String key:List.of("version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","purpose"))if(!request.getString(key).equals(response.getString(key)))throw new SecurityException("Wallet approval "+key+" binding mismatch");
    if(!"1".equals(response.getString("version"))||!"ynx_6423-1".equals(response.getString("chainId"))||!DEVICE_ALGORITHM.equals(response.getString("productDeviceAlgorithm")))throw new SecurityException("Wallet approval protocol mismatch");
    requireExactScopes(response.getJSONArray("grantedScopes"),request.getJSONArray("scopes"));
    String expectedDigest=hex(sha256(("YNX_WALLET_AUTH_REQUEST_V1\n"+canonical(request)).getBytes(StandardCharsets.UTF_8)));
    if(!expectedDigest.equals(response.getString("requestDigest")))throw new SecurityException("Wallet approval request digest mismatch");
    Instant requestExpiry=strictTime(request.getString("expiresAt"));Instant issued=strictTime(response.getString("issuedAt"));Instant expires=strictTime(response.getString("expiresAt"));
    if(!expires.isAfter(issued)||expires.isAfter(requestExpiry)||!expires.isAfter(now))throw new SecurityException("Wallet approval expiry mismatch");
    String publicKey=response.getString("accountPublicKey"),signature=response.getString("walletSignature");if(!publicKey.matches("^(02|03)[0-9a-f]{64}$")||!signature.matches("^[0-9a-f]{128}$"))throw new SecurityException("Wallet approval key or signature encoding invalid");
    JSONObject payload=new JSONObject(response.toString());payload.remove("walletSignature");byte[] digest=sha256(("YNX_WALLET_AUTH_APPROVAL_V1\n"+canonical(payload)).getBytes(StandardCharsets.UTF_8));
    if(!verifySecp256k1(digest,hexBytes(signature),hexBytes(publicKey)))throw new SecurityException("Wallet approval signature invalid");
    if(!response.getString("account").equals(nativeAccount(hexBytes(publicKey))))throw new SecurityException("Wallet approval account/public-key mismatch");
  }

  private JSONObject createGatewayChallenge(JSONObject approval,Instant now) throws Exception {
    Instant approvalExpiry=strictTime(approval.getString("expiresAt"));Instant expires=now.plusSeconds(60);if(expires.isAfter(approvalExpiry))expires=approvalExpiry;if(!expires.isAfter(now))throw new SecurityException("approval expired before challenge");
    JSONObject challenge=new JSONObject();challenge.put("version","1");challenge.put("challenge",base64url(sha256((approval.getString("requestDigest")+format(now)).getBytes(StandardCharsets.UTF_8))));challenge.put("requestDigest",approval.getString("requestDigest"));challenge.put("productClientId",approval.getString("productClientId"));challenge.put("bundleId",approval.getString("bundleId"));challenge.put("productDeviceAlgorithm",approval.getString("productDeviceAlgorithm"));challenge.put("productDeviceKey",approval.getString("productDeviceKey"));challenge.put("account",approval.getString("account"));challenge.put("scopes",approval.getJSONArray("grantedScopes"));challenge.put("issuedAt",format(now));challenge.put("expiresAt",format(expires));requireExactFields(challenge,CHALLENGE_FIELDS,"Gateway challenge");return challenge;
  }

  private void verifyGatewayCompletion(JSONObject challenge,byte[] signature,JSONObject approval,Instant now) throws Exception {
    requireExactFields(challenge,CHALLENGE_FIELDS,"Gateway challenge");
    for(String key:List.of("requestDigest","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","account"))if(!approval.getString(key).equals(challenge.getString(key)))throw new SecurityException("Gateway "+key+" binding mismatch");
    requireExactScopes(challenge.getJSONArray("scopes"),approval.getJSONArray("grantedScopes"));
    if(!DEVICE_ALGORITHM.equals(challenge.getString("productDeviceAlgorithm"))||!devicePublicKey().equals(challenge.getString("productDeviceKey")))throw new SecurityException("Gateway device algorithm/key mismatch");
    Instant issued=strictTime(challenge.getString("issuedAt")),expires=strictTime(challenge.getString("expiresAt")),approvalIssued=strictTime(approval.getString("issuedAt")),approvalExpiry=strictTime(approval.getString("expiresAt"));
    if(issued.isAfter(now)||issued.isBefore(approvalIssued)||!expires.isAfter(now)||!expires.isAfter(issued)||expires.isAfter(approvalExpiry))throw new SecurityException("Gateway challenge lifetime mismatch");
    Signature verifier=Signature.getInstance("SHA256withECDSA");verifier.initVerify(deviceKey.getPublic());verifier.update(("YNX_PRODUCT_SESSION_CHALLENGE_V1\n"+canonical(challenge)).getBytes(StandardCharsets.UTF_8));if(!verifier.verify(signature))throw new SecurityException("Gateway device proof invalid");
  }

  private static void requireExactFields(JSONObject value,Set<String> fields,String label){if(!objectKeys(value).equals(fields))throw new SecurityException(label+" schema mismatch");}
  private static void requireExactScopes(JSONArray actual,JSONArray expected) throws Exception {if(actual.length()<1||actual.length()>8||actual.length()!=expected.length())throw new SecurityException("scope binding mismatch");Set<String> unique=new HashSet<>();String previous=null;for(int i=0;i<actual.length();i++){String value=actual.getString(i);if(!value.matches("^[a-z][a-z0-9._:-]{1,63}$")||!value.equals(expected.getString(i))||!unique.add(value)||(previous!=null&&previous.compareTo(value)>=0))throw new SecurityException("scope binding mismatch");previous=value;}}

  private String devicePublicKey(){ECPublicKey key=(ECPublicKey)deviceKey.getPublic();byte[] x=fixed32(key.getW().getAffineX());byte[] output=new byte[33];output[0]=(byte)(key.getW().getAffineY().testBit(0)?3:2);System.arraycopy(x,0,output,1,32);return base64url(output);}

  private KeyPair loadOrCreateDeviceKey() throws Exception {String alias="ynx-social-wallet-auth-proof-p256-v2";KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(store.containsAlias(alias))return new KeyPair(store.getCertificate(alias).getPublicKey(),(PrivateKey)store.getKey(alias,null));KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");generator.initialize(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build());return generator.generateKeyPair();}

  private static boolean verifySecp256k1(byte[] digest,byte[] compactSignature,byte[] compressedPublicKey){if(compactSignature.length!=64)return false;X9ECParameters curve=CustomNamedCurves.getByName("secp256k1");ECDomainParameters domain=new ECDomainParameters(curve.getCurve(),curve.getG(),curve.getN(),curve.getH());ECDSASigner verifier=new ECDSASigner();verifier.init(false,new ECPublicKeyParameters(curve.getCurve().decodePoint(compressedPublicKey),domain));return verifier.verifySignature(digest,new BigInteger(1,Arrays.copyOfRange(compactSignature,0,32)),new BigInteger(1,Arrays.copyOfRange(compactSignature,32,64)));}
  private static String nativeAccount(byte[] compressedPublicKey){X9ECParameters curve=CustomNamedCurves.getByName("secp256k1");byte[] uncompressed=curve.getCurve().decodePoint(compressedPublicKey).getEncoded(false);KeccakDigest digest=new KeccakDigest(256);digest.update(uncompressed,1,uncompressed.length-1);byte[] hash=new byte[32];digest.doFinal(hash,0);return bech32(Arrays.copyOfRange(hash,12,32));}
  private static String bech32(byte[] payload){int[] data=convertBits(payload);List<Integer> values=new ArrayList<>();for(char c:"ynx".toCharArray())values.add(((int)c)>>5);values.add(0);for(char c:"ynx".toCharArray())values.add(((int)c)&31);for(int value:data)values.add(value);for(int i=0;i<6;i++)values.add(0);int checksum=polymod(values)^1;String charset="qpzry9x8gf2tvdw0s3jn54khce6mua7l";StringBuilder result=new StringBuilder("ynx1");for(int value:data)result.append(charset.charAt(value));for(int i=0;i<6;i++)result.append(charset.charAt((checksum>>(5*(5-i)))&31));return result.toString();}
  private static int[] convertBits(byte[] bytes){List<Integer> output=new ArrayList<>();int accumulator=0,bits=0;for(byte item:bytes){accumulator=((accumulator<<8)|(item&255))&4095;bits+=8;while(bits>=5){bits-=5;output.add((accumulator>>bits)&31);}}if(bits>0)output.add((accumulator<<(5-bits))&31);return output.stream().mapToInt(Integer::intValue).toArray();}
  private static int polymod(List<Integer> values){int[] generators={0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3};int checksum=1;for(int value:values){int top=checksum>>>25;checksum=((checksum&0x1ffffff)<<5)^value;for(int i=0;i<5;i++)if(((top>>>i)&1)!=0)checksum^=generators[i];}return checksum;}

  private static String canonical(Object value) throws Exception {if(value==null||value==JSONObject.NULL)return "null";if(value instanceof String)return quote((String)value);if(value instanceof Boolean)return value.toString();if(value instanceof JSONArray){JSONArray array=(JSONArray)value;StringBuilder result=new StringBuilder("[");for(int i=0;i<array.length();i++){if(i>0)result.append(',');result.append(canonical(array.get(i)));}return result.append(']').toString();}if(value instanceof JSONObject){JSONObject object=(JSONObject)value;StringBuilder result=new StringBuilder("{");boolean first=true;for(String key:new TreeSet<>(objectKeys(object))){if(!first)result.append(',');first=false;result.append(quote(key)).append(':').append(canonical(object.get(key)));}return result.append('}').toString();}throw new SecurityException("non-canonical JSON value");}
  private static String quote(String value){StringBuilder result=new StringBuilder("\"");for(int i=0;i<value.length();i++){char c=value.charAt(i);switch(c){case '\"':result.append("\\\"");break;case '\\':result.append("\\\\");break;case '\b':result.append("\\b");break;case '\f':result.append("\\f");break;case '\n':result.append("\\n");break;case '\r':result.append("\\r");break;case '\t':result.append("\\t");break;default:if(c<0x20)result.append(String.format("\\u%04x",(int)c));else result.append(c);}}return result.append('\"').toString();}
  private static Set<String> objectKeys(JSONObject value){Set<String> result=new HashSet<>();Iterator<String> keys=value.keys();while(keys.hasNext())result.add(keys.next());return result;}
  private static Instant strictTime(String value){try{Instant parsed=Instant.parse(value);if(!format(parsed).equals(value))throw new SecurityException("non-canonical time");return parsed;}catch(Exception error){throw new SecurityException("invalid canonical time",error);}}
  private static String format(Instant value){return MILLIS.format(value);}
  private static byte[] sha256(byte[] value){try{return MessageDigest.getInstance("SHA-256").digest(value);}catch(Exception error){throw new IllegalStateException(error);}}
  private static String hex(byte[] value){StringBuilder result=new StringBuilder();for(byte item:value)result.append(String.format("%02x",item));return result.toString();}
  private static byte[] hexBytes(String value){if((value.length()&1)!=0)throw new SecurityException("invalid hex");byte[] result=new byte[value.length()/2];for(int i=0;i<result.length;i++)result[i]=(byte)Integer.parseInt(value.substring(i*2,i*2+2),16);return result;}
  private static byte[] fixed32(BigInteger value){byte[] raw=value.toByteArray();if(raw.length==32)return raw;if(raw.length==33&&raw[0]==0)return Arrays.copyOfRange(raw,1,33);byte[] output=new byte[32];System.arraycopy(raw,0,output,32-raw.length,raw.length);return output;}
  private static String base64url(byte[] value){return Base64.encodeToString(value,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);}
  private static String detail(Throwable error){StringBuilder value=new StringBuilder(error.getClass().getSimpleName());Throwable current=error;while(current!=null){if(current.getMessage()!=null&&!current.getMessage().isEmpty())value.append(": ").append(current.getMessage());current=current.getCause();}return value.toString();}
}

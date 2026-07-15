package com.ynxweb4.social;

import android.app.Activity;
import android.content.Intent;
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
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

public final class MainActivity extends Activity {
  private static final String BLUE="#002FA7";
  private final Set<String> consumedNonces=new HashSet<>();
  private TextView status;
  private Button replayButton;
  private KeyPair deviceKey;

  @Override public void onCreate(Bundle state){super.onCreate(state);try{deviceKey=loadOrCreateDeviceKey();}catch(Exception error){throw new IllegalStateException(error);}render();handle(getIntent());}
  @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handle(intent);}

  private void render(){
    LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setGravity(Gravity.CENTER_HORIZONTAL);root.setPadding(64,120,64,64);root.setBackgroundColor(Color.WHITE);
    TextView eyebrow=text("CROSS-APP PROOF",14,Color.parseColor(BLUE));root.addView(eyebrow);
    TextView title=text("YNX Social",34,Color.rgb(16,24,40));title.setPadding(0,24,0,18);root.addView(title);
    TextView identity=text("Package com.ynxweb4.social\nProduct client ynx-social-v1\nProduct device key remains in Social",16,Color.rgb(102,112,133));identity.setGravity(Gravity.CENTER);root.addView(identity);
    Button button=new Button(this);button.setText("Sign in with YNX Wallet");button.setContentDescription("Social starts Sign in with YNX Wallet");button.setTextColor(Color.WHITE);button.setBackgroundColor(Color.parseColor(BLUE));LinearLayout.LayoutParams buttonParams=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,140);buttonParams.setMargins(0,70,0,42);root.addView(button,buttonParams);button.setOnClickListener(view->startWallet());
    status=text("Ready. Social owns its device private key; Wallet owns the account key.",16,Color.rgb(52,64,84));status.setGravity(Gravity.CENTER);root.addView(status);
    replayButton=new Button(this);replayButton.setText("Replay exact Wallet callback");replayButton.setContentDescription("Replay exact Wallet callback");replayButton.setVisibility(View.GONE);replayButton.setOnClickListener(view->handle(getIntent()));LinearLayout.LayoutParams replayParams=new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,140);replayParams.setMargins(0,42,0,0);root.addView(replayButton,replayParams);
    setContentView(root);
  }

  private TextView text(String value,int size,int color){TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(color);view.setLineSpacing(8,1);return view;}

  private void startWallet(){
    try{
      Instant now=Instant.now().truncatedTo(ChronoUnit.MILLIS);String nonce="social_emulator_nonce_"+Long.toUnsignedString(System.nanoTime(),36);
      if(nonce.length()<32)nonce=(nonce+"abcdefghijklmnopqrstuvwxyz").substring(0,32);if(nonce.length()>64)nonce=nonce.substring(0,64);
      JSONObject request=new JSONObject();
      request.put("version","1");request.put("nonce",nonce);request.put("chainId","ynx_6423-1");request.put("requestingProduct","social");request.put("productClientId","ynx-social-v1");request.put("bundleId",getPackageName());request.put("productDeviceKey",devicePublicKey());request.put("callback","ynxsocial://wallet-auth/callback");request.put("scopes",new JSONArray().put("account:read").put("profile:link"));request.put("purpose","Link this exact Social emulator device to the selected YNX account.");request.put("issuedAt",now.minus(60,ChronoUnit.SECONDS).toString());request.put("expiresAt",now.plus(180,ChronoUnit.SECONDS).toString());
      String payload=Base64.encodeToString(request.toString().getBytes(StandardCharsets.UTF_8),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);
      startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("ynxwallet://authorize?request="+payload)));
    }catch(Exception error){status.setText("Request failed: "+error.getMessage());}
  }

  private void handle(Intent intent){
    Uri uri=intent.getData();if(uri==null||!"ynxsocial".equals(uri.getScheme()))return;
    try{
      String encoded=uri.getQueryParameter("response");if(encoded==null)throw new IllegalArgumentException("response missing");
      JSONObject response=new JSONObject(new String(Base64.decode(encoded,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),StandardCharsets.UTF_8));
      if(!"ynx-social-v1".equals(response.getString("productClientId"))||!getPackageName().equals(response.getString("bundleId"))||!devicePublicKey().equals(response.getString("productDeviceKey")))throw new SecurityException("product binding mismatch");
      String nonce=response.getString("nonce");if(!consumedNonces.add(nonce)){status.setText("Replay rejected: Wallet response nonce was already consumed.");return;}
      String challenge="YNX_GATEWAY_PRODUCT_CHALLENGE_V1\n"+response.getString("requestDigest")+"\n"+nonce+"\nynx-social-v1\n"+getPackageName();
      String algorithm="EC".equals(deviceKey.getPublic().getAlgorithm())?"SHA256withECDSA":"Ed25519";
      Signature signer=Signature.getInstance(algorithm);signer.initSign(deviceKey.getPrivate());signer.update(challenge.getBytes(StandardCharsets.UTF_8));byte[] signature=signer.sign();
      Signature verifier=Signature.getInstance(algorithm);verifier.initVerify(deviceKey.getPublic());verifier.update(challenge.getBytes(StandardCharsets.UTF_8));if(!verifier.verify(signature))throw new SecurityException("device challenge failed");
      status.setText("Wallet callback received.\nGateway device challenge completed.\nProduct-limited session: ynx-social-v1\nAccount: "+response.getString("account")+"\nNo Wallet secret entered Social.");
      replayButton.setVisibility(View.VISIBLE);
    }catch(Exception error){status.setText("Callback rejected: "+detail(error));}
  }

  private String devicePublicKey(){try{return Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(deviceKey.getPublic().getEncoded()),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);}catch(Exception error){throw new IllegalStateException(error);}}

  private KeyPair loadOrCreateDeviceKey() throws Exception {
    String alias="ynx-social-wallet-auth-proof";
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    if(store.containsAlias(alias))return new KeyPair(store.getCertificate(alias).getPublicKey(),(PrivateKey)store.getKey(alias,null));
    KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
    generator.initialize(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build());
    return generator.generateKeyPair();
  }

  private static String detail(Throwable error){StringBuilder value=new StringBuilder(error.getClass().getSimpleName());Throwable current=error;while(current!=null){if(current.getMessage()!=null&&!current.getMessage().isEmpty())value.append(": ").append(current.getMessage());current=current.getCause();}return value.toString();}
}

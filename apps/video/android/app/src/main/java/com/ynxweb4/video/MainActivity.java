package com.ynxweb4.video;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.VideoView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.util.UUID;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.text.DateFormat;
import java.text.NumberFormat;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

public final class MainActivity extends Activity {
    private static final int BLUE = Color.rgb(0, 47, 167);
    private static final String[] LOCALES = {"en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"};
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private JSONObject catalog, words;
    private SharedPreferences prefs;
    private LinearLayout content;
    private TextView status;
    private ProgressBar progress;
    private String gatewaySession;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("ynx_video_settings_v1", MODE_PRIVATE);
        loadCatalog();
        selectLanguage(prefs.getString("locale", systemLocale()));
        render();
        handleIntent(getIntent());
        loadVideos("");
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void loadCatalog() {
        try (InputStream in = getAssets().open("catalog.json")) {
            byte[] bytes = new byte[in.available()];
            int read = in.read(bytes);
            if (read != bytes.length) throw new IllegalStateException("catalog truncated");
            catalog = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception error) { throw new IllegalStateException("i18n catalog unavailable", error); }
    }

    private String systemLocale() {
        String tag = Locale.getDefault().toLanguageTag();
        for (String value : LOCALES) if (tag.equalsIgnoreCase(value) || tag.startsWith(value + "-")) return value;
        return "en";
    }

    private void selectLanguage(String locale) {
        if (!Arrays.asList(LOCALES).contains(locale)) locale = "en";
        words = catalog.optJSONObject(locale);
        if (words == null) words = catalog.optJSONObject("en");
        prefs.edit().putString("locale", locale).apply();
        getWindow().getDecorView().setLayoutDirection("ar".equals(locale) ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR);
    }

    private String t(String key) {
        String value = words.optString(key, "");
        if (value.isEmpty()) value = catalog.optJSONObject("en").optString(key, "[" + key + "]");
        return value;
    }

    private void render() {
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.WHITE);
        LinearLayout top = row(); top.setPadding(dp(18), dp(12), dp(18), dp(12)); top.setBackgroundColor(BLUE);
        TextView brand = label("YNX Video", 22, Color.WHITE); brand.setTypeface(Typeface.DEFAULT_BOLD); top.addView(brand, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button signIn = button(t("signIn")); signIn.setTextColor(BLUE); signIn.setContentDescription(t("signIn")); signIn.setOnClickListener(v -> startWallet()); top.addView(signIn);
        root.addView(top);

        LinearLayout controls = row(); controls.setPadding(dp(16), dp(10), dp(16), dp(4));
        EditText search = new EditText(this); search.setHint(t("search")); search.setSingleLine(true); search.setContentDescription(t("search")); controls.addView(search, new LinearLayout.LayoutParams(0, dp(52), 1));
        Button go = button(t("search")); go.setOnClickListener(v -> loadVideos(search.getText().toString())); controls.addView(go);
        root.addView(controls);

        LinearLayout nav = row(); nav.setPadding(dp(16), 0, dp(16), dp(8));
        for (String key : new String[]{"discover","subscriptions","playlists","history"}) {
            Button b = button(t(key)); b.setContentDescription(t(key));
            b.setOnClickListener(v -> { if("discover".equals(key))loadVideos("");else loadCollection("/v1/"+key,key); });
            nav.addView(b, new LinearLayout.LayoutParams(0, dp(46), 1));
        }
        root.addView(nav);

        ScrollView scroll = new ScrollView(this); content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setPadding(dp(18), dp(8), dp(18), dp(36)); scroll.addView(content); root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        LinearLayout state = row(); state.setPadding(dp(18), dp(8), dp(18), dp(12)); progress = new ProgressBar(this); state.addView(progress, new LinearLayout.LayoutParams(dp(32), dp(32))); status = label(t("loading"), 14, Color.DKGRAY); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); state.addView(status, new LinearLayout.LayoutParams(0, dp(44), 1));
        Spinner locale = new Spinner(this); locale.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, LOCALES)); locale.setSelection(Arrays.asList(LOCALES).indexOf(prefs.getString("locale", "en")), false); locale.setContentDescription(t("language")); locale.setOnItemSelectedListener(new SimpleSelection(position -> { String chosen = LOCALES[position]; if (!chosen.equals(prefs.getString("locale", "en"))) { selectLanguage(chosen); recreate(); } })); state.addView(locale, new LinearLayout.LayoutParams(dp(92), dp(48)));
        Spinner aiLocale = new Spinner(this); aiLocale.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, LOCALES)); String selectedAI=prefs.getString("ai_locale",prefs.getString("locale","en")); aiLocale.setSelection(Math.max(0,Arrays.asList(LOCALES).indexOf(selectedAI)),false); aiLocale.setContentDescription(t("aiLanguage")); aiLocale.setOnItemSelectedListener(new SimpleSelection(position -> prefs.edit().putString("ai_locale",LOCALES[position]).apply())); state.addView(aiLocale,new LinearLayout.LayoutParams(dp(92),dp(48))); root.addView(state);
        setContentView(root);
    }

    private void loadVideos(String query) {
        if (!online()) { showState(t("offline"), true); return; }
        showState(t("loading"), false);
        worker.execute(() -> {
            try {
                String path = "/v1/videos?q=" + Uri.encode(query);
                JSONObject response = request(path);
                JSONArray videos = response.optJSONArray("items");
                if (videos == null) videos = response.optJSONArray("data");
                if (videos == null && response.has("array")) videos = response.optJSONArray("array");
                final JSONArray result = videos == null ? new JSONArray() : videos;
                runOnUiThread(() -> renderVideos(result));
            } catch (Exception error) { runOnUiThread(() -> showFailure(error.getMessage())); }
        });
    }

    private JSONObject request(String path) throws Exception {
        return request(path,"GET",null);
    }

    private JSONObject request(String path,String method,JSONObject payload) throws Exception {
        String base = prefs.getString("gateway", "http://10.0.2.2:8423");
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setConnectTimeout(8000); connection.setReadTimeout(12000); connection.setRequestMethod(method); connection.setRequestProperty("Accept", "application/json");
        if (gatewaySession != null) connection.setRequestProperty("X-YNX-App-Session", gatewaySession);
        if (!"GET".equals(method) && !"HEAD".equals(method)) connection.setRequestProperty("Idempotency-Key", UUID.randomUUID().toString());
        if(payload!=null){byte[] body=payload.toString().getBytes(StandardCharsets.UTF_8);connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.setFixedLengthStreamingMode(body.length);try(OutputStream output=connection.getOutputStream()){output.write(body);}}
        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder body = new StringBuilder();
        if (stream != null) try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) { for (String line; (line = reader.readLine()) != null;) body.append(line); }
        if (code < 200 || code >= 300) throw new IllegalStateException(code == 401 ? t("walletPending") : t("unavailable") + " (HTTP " + code + ")");
        String raw = body.toString().trim();
        if (raw.startsWith("[")) return new JSONObject().put("array", new JSONArray(raw));
        return new JSONObject(raw);
    }

    private void loadCollection(String path,String labelKey) {
        if(!online()) { showState(t("offline"),true); return; }
        showState(t("loading"),false);
        worker.execute(() -> {
            try {
                JSONObject response=request(path);
                JSONArray items=response.optJSONArray("array");
                final JSONArray result=items==null ? new JSONArray() : items;
                runOnUiThread(() -> {
                    content.removeAllViews(); progress.setVisibility(View.GONE);
                    if(result.length()==0) { content.addView(label(t(labelKey)+" · "+t("empty"),20,Color.DKGRAY)); return; }
                    for(int i=0;i<result.length();i++) {
                        JSONObject item=result.optJSONObject(i);
                        String text=item==null ? String.valueOf(result.opt(i)) : item.optString("Name",item.optString("name",item.optString("VideoID",item.optString("video_id","record"))));
                        content.addView(label(text,18,Color.DKGRAY));
                    }
                    status.setText(NumberFormat.getIntegerInstance(activeLocale()).format(result.length())+" · "+t(labelKey));
                });
            } catch(Exception error) { runOnUiThread(() -> showFailure(error.getMessage())); }
        });
    }

    private void renderVideos(JSONArray videos) {
        content.removeAllViews(); progress.setVisibility(View.GONE);
        if (videos.length() == 0) { content.addView(label(t("empty"), 20, Color.DKGRAY)); content.addView(label(t("noMetrics"), 14, Color.GRAY)); status.setText(t("empty")); return; }
        for (int i = 0; i < videos.length(); i++) {
            JSONObject video = videos.optJSONObject(i); if (video == null) continue;
            String title = video.optString("title", "Untitled"), id = video.optString("id", ""), description = video.optString("description", "");
            LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL); card.setPadding(dp(16), dp(16), dp(16), dp(16)); card.setBackgroundColor(Color.rgb(245,247,252));
            TextView heading = label(title, 20, Color.BLACK); heading.setTypeface(Typeface.DEFAULT_BOLD); card.addView(heading); card.addView(label(description, 14, Color.DKGRAY));
            Button play = button(t("play")); play.setContentDescription(t("play") + ": " + title); play.setOnClickListener(v -> playVideo(video)); card.addView(play); content.addView(card, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            Space(card);
        }
        status.setText(NumberFormat.getIntegerInstance(activeLocale()).format(videos.length()) + " · " + t("noMetrics"));
    }

    private void playVideo(JSONObject video) {
        String key = ""; JSONArray variants = video.optJSONArray("variants");
        if (variants != null) for (int i=0;i<variants.length();i++) { JSONObject item=variants.optJSONObject(i); if (item != null && ("adaptive-hls".equals(item.optString("name")) || key.isEmpty())) key=item.optString("object_key"); }
        if (key.isEmpty()) { showState(t("unavailable"), true); return; }
        VideoView player = new VideoView(this); player.setContentDescription(t("play") + ": " + video.optString("title")); player.setMediaController(new android.widget.MediaController(this)); player.setVideoURI(Uri.parse(prefs.getString("gateway", "http://10.0.2.2:8423") + "/media/" + key));
        content.removeAllViews(); content.addView(player, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(260)));
        JSONArray captions=video.optJSONArray("captions"); content.addView(label(t("captions") + ": " + (captions == null ? 0 : captions.length()), 14, Color.DKGRAY));
        LinearLayout actions=row();
        Button subscribe=button(t("subscriptions"));subscribe.setOnClickListener(v->postAction("/v1/channels/"+video.optString("channel_id")+"/subscription",new JSONObject(),t("subscriptions")));actions.addView(subscribe,new LinearLayout.LayoutParams(0,dp(52),1));
        Button comments=button(t("comments"));comments.setOnClickListener(v->comment(video));actions.addView(comments,new LinearLayout.LayoutParams(0,dp(52),1));
        Button report=button(t("report"));report.setOnClickListener(v->report(video));actions.addView(report,new LinearLayout.LayoutParams(0,dp(52),1));content.addView(actions);
        if(captions!=null&&captions.length()>0){Button transcript=button(t("captions"));transcript.setOnClickListener(v->loadTranscript(captions.optJSONObject(0)));content.addView(transcript);}
        player.start();
    }

    private void postAction(String path,JSONObject body,String success){worker.execute(()->{try{request(path,"POST",body);runOnUiThread(()->showState(success,false));}catch(Exception error){runOnUiThread(()->showFailure(error.getMessage()));}});}
    private void comment(JSONObject video){EditText input=new EditText(this);input.setHint(t("comments"));new android.app.AlertDialog.Builder(this).setTitle(t("comments")).setView(input).setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(dialog,which)->{try{postAction("/v1/videos/"+video.optString("id")+"/comments",new JSONObject().put("body",input.getText().toString()),t("comments"));}catch(Exception error){showState(error.getMessage(),true);}}).show();}
    private void report(JSONObject video){EditText input=new EditText(this);input.setHint(t("report"));new android.app.AlertDialog.Builder(this).setTitle(t("report")).setMessage(t("noMetrics")).setView(input).setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(dialog,which)->{try{postAction("/v1/videos/"+video.optString("id")+"/reports",new JSONObject().put("reason","viewer_report").put("details",input.getText().toString()),t("report"));}catch(Exception error){showState(error.getMessage(),true);}}).show();}
    private void loadTranscript(JSONObject track){if(track==null||!track.optBoolean("human_approved")){showState(t("unavailable"),true);return;}worker.execute(()->{try{String base=prefs.getString("gateway","http://10.0.2.2:8423");HttpURLConnection connection=(HttpURLConnection)new URL(base+"/media/"+track.optString("object_key")).openConnection();connection.setConnectTimeout(8000);StringBuilder body=new StringBuilder();try(BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),StandardCharsets.UTF_8))){for(String line;(line=reader.readLine())!=null;)if(!line.startsWith("WEBVTT")&&!line.contains("-->"))body.append(line).append('\n');}runOnUiThread(()->{TextView transcript=label(body.toString().trim(),16,Color.DKGRAY);transcript.setContentDescription(t("captions"));content.addView(transcript);});}catch(Exception error){runOnUiThread(()->showFailure(error.getMessage()));}});}

    private void showFailure(String detail) { content.removeAllViews(); content.addView(label(t("unavailable"), 20, Color.DKGRAY)); TextView reason=label(detail,14,Color.GRAY); content.addView(reason); Button retry=button(t("retry")); retry.setOnClickListener(v -> loadVideos("")); content.addView(retry); showState(t("unavailable"), true); }
    private void showState(String message, boolean failed) { status.setText(message); status.setTextColor(failed ? Color.rgb(155,35,53) : Color.DKGRAY); progress.setVisibility(failed ? View.GONE : View.VISIBLE); }

    private void startWallet() {
        try {
            Instant issued = Instant.now().truncatedTo(ChronoUnit.MILLIS), expires = issued.plus(5, ChronoUnit.MINUTES);
            String nonce = randomBase64(24), deviceKey = productDeviceKey();
            String[] scopes = {"video.comment","video.history","video.read","video.report","video.subscribe"};
            String json = "{" +
                "\"bundleId\":\"com.ynxweb4.video\"," +
                "\"callback\":\"ynxvideo://wallet-auth/callback\"," +
                "\"chainId\":\"ynx_6423-1\"," +
                "\"expiresAt\":" + JSONObject.quote(expires.toString()) + "," +
                "\"issuedAt\":" + JSONObject.quote(issued.toString()) + "," +
                "\"nonce\":" + JSONObject.quote(nonce) + "," +
                "\"productClientId\":\"ynx-video-mobile-v1\"," +
                "\"productDeviceAlgorithm\":\"p256-sha256\"," +
                "\"productDeviceKey\":" + JSONObject.quote(deviceKey) + "," +
                "\"purpose\":" + JSONObject.quote(t("privacy")) + "," +
                "\"requestingProduct\":\"ynx-video\"," +
                "\"scopes\":[\"video.comment\",\"video.history\",\"video.read\",\"video.report\",\"video.subscribe\"]," +
                "\"version\":\"1\"}";
            String request = Base64.encodeToString(json.getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("ynxwallet://authorize?request=" + Uri.encode(request))));
        } catch (Exception error) { showState(t("unavailable") + ": " + error.getMessage(), true); }
    }

    private void handleIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData(); if (data == null) return;
        if ("wallet-auth".equals(data.getHost())) { String session = data.getQueryParameter("gateway_session"); gatewaySession = session == null || session.length() < 24 ? null : session; showState(t("walletPending"), gatewaySession == null); if (gatewaySession != null) loadVideos(""); }
        if ("watch".equals(data.getHost())) loadVideos(data.getQueryParameter("video"));
    }

    private String productDeviceKey() throws Exception {
        final String alias = "ynx.video.wallet.product-device.v1";
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(alias)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN).setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).setUserAuthenticationRequired(false).build()); generator.generateKeyPair();
        }
        ECPublicKey publicKey = (ECPublicKey) store.getCertificate(alias).getPublicKey();
        byte[] x = unsigned32(publicKey.getW().getAffineX()), compressed = new byte[33]; compressed[0] = publicKey.getW().getAffineY().testBit(0) ? (byte)3 : (byte)2; System.arraycopy(x,0,compressed,1,32);
        return Base64.encodeToString(compressed, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static byte[] unsigned32(BigInteger value) { byte[] raw=value.toByteArray(), out=new byte[32]; int start=Math.max(0,raw.length-32), count=Math.min(32,raw.length); System.arraycopy(raw,start,out,32-count,count); return out; }
    private static String randomBase64(int count) { byte[] bytes=new byte[count]; new SecureRandom().nextBytes(bytes); return Base64.encodeToString(bytes,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING); }
    private boolean online() { ConnectivityManager cm=(ConnectivityManager)getSystemService(Context.CONNECTIVITY_SERVICE); Network network=cm.getActiveNetwork(); NetworkCapabilities caps=network==null?null:cm.getNetworkCapabilities(network); return caps!=null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET); }
    private Locale activeLocale() { return Locale.forLanguageTag(prefs.getString("locale","en")); }
    String formatDate(java.util.Date value) { return DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT,activeLocale()).format(value); }
    String formatCurrency(long value) { NumberFormat f=NumberFormat.getCurrencyInstance(activeLocale()); f.setCurrency(java.util.Currency.getInstance("CNY")); return f.format(value); }
    String pluralRecords(int count) { return NumberFormat.getIntegerInstance(activeLocale()).format(count)+(count==1?" record":" records"); }
    private LinearLayout row() { LinearLayout x=new LinearLayout(this); x.setOrientation(LinearLayout.HORIZONTAL); x.setGravity(Gravity.CENTER_VERTICAL); return x; }
    private TextView label(String text,int sp,int color) { TextView x=new TextView(this); x.setText(text); x.setTextSize(sp); x.setTextColor(color); x.setPadding(dp(6),dp(6),dp(6),dp(6)); return x; }
    private Button button(String text) { Button x=new Button(this); x.setText(text); x.setAllCaps(false); x.setMinHeight(dp(48)); return x; }
    private int dp(int value) { return Math.round(value*getResources().getDisplayMetrics().density); }
    private void Space(LinearLayout parent) { View space=new View(this); parent.addView(space,new LinearLayout.LayoutParams(1,dp(8))); }

    private static final class SimpleSelection implements android.widget.AdapterView.OnItemSelectedListener {
        interface Choice { void selected(int position); } private final Choice choice; SimpleSelection(Choice value){choice=value;}
        public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id){choice.selected(position);} public void onNothingSelected(android.widget.AdapterView<?> parent){}
    }
}

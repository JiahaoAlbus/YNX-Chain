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
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ImageView;
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
import java.net.HttpURLConnection;
import java.util.UUID;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.DateFormat;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;


public final class MainActivity extends Activity {
    private static final int BLUE = Color.rgb(0, 47, 167);
    private static final String[] LOCALES = {"en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"};
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private JSONObject catalog, words;
    private SharedPreferences prefs;
    private LinearLayout content;
    private TextView status;
    private ProgressBar progress;
    private final VideoRequestBoundary boundary = new VideoRequestBoundary();
    private VideoView activePlayer;
    private VideoPlaybackView privatePlayer;
    private NativeSessionBridge nativeBridge;
    private TextView accountLine;
    private boolean authTransition;
    private NativeSessionIdentity shownIdentity;
    private final Runnable authorityChanged=()->{if(privatePlayer!=null&&nativeBridge.session()==null){privatePlayer.stopPlayback();privatePlayer=null;}if(shownIdentity!=null&&!shownIdentity.same(nativeBridge.session())&&!authTransition){shownIdentity=null;beginNavigation();showState(t("signIn"),true);}if(accountLine!=null)accountLine.setText(nativeBridge.session()==null?t("signIn"):nativeBridge.session().account);};
    private android.app.AlertDialog activeDialog;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("ynx_video_settings_v1", MODE_PRIVATE);
        nativeBridge=NativeSessionBridge.acquire(this);nativeBridge.addListener(authorityChanged);
        loadCatalog();
        selectLanguage(prefs.getString("locale", systemLocale()));
        render();
        if (!handleIntent(getIntent())) restoreSession();
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
        top.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);
        ImageView logo = new ImageView(this); logo.setImageResource(R.drawable.ynx_brand_original); logo.setScaleType(ImageView.ScaleType.FIT_CENTER); logo.setContentDescription("YNX"); logo.setBackgroundColor(Color.WHITE); logo.setPadding(0,0,0,0);
        LinearLayout.LayoutParams logoLayout = new LinearLayout.LayoutParams(dp(46),dp(24)); logoLayout.setMarginEnd(dp(10)); top.addView(logo,logoLayout);
        TextView brand = label("YNX Video", 16, Color.WHITE); brand.setTypeface(Typeface.DEFAULT_BOLD); brand.setMinHeight(dp(48)); top.addView(brand, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        Button signIn = button(t("signIn")); signIn.setTextColor(BLUE); signIn.setContentDescription(t("signIn")); signIn.setOnClickListener(v -> startWallet()); top.addView(signIn);
        root.addView(top);
        LinearLayout identity=row();accountLine=label(t("signIn"),12,Color.DKGRAY);identity.addView(accountLine,new LinearLayout.LayoutParams(0,-2,1));Button restore=button(t("retry"));restore.setOnClickListener(v->restoreSession());identity.addView(restore);Button disconnect=button(t("signOut"));disconnect.setOnClickListener(v->signOut());identity.addView(disconnect);root.addView(identity);Button privacy=button(t("deleteMyData"));privacy.setOnClickListener(v->deleteMyData());root.addView(privacy);

        LinearLayout controls = row(); controls.setPadding(dp(16), dp(10), dp(16), dp(4));
        EditText search = new EditText(this); search.setHint(t("search")); search.setSingleLine(true); search.setMinHeight(dp(48)); search.setTextSize(16*DisplayPreferences.factor(this)); search.setContentDescription(t("search")); controls.addView(search, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
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
        LinearLayout state = row(); state.setPadding(dp(18), dp(8), dp(18), dp(12)); progress = new ProgressBar(this); state.addView(progress, new LinearLayout.LayoutParams(dp(32), dp(32))); status = label(t("loading"), 14, Color.DKGRAY); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); state.addView(status, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        Spinner locale = new Spinner(this); locale.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, LOCALES)); locale.setSelection(Arrays.asList(LOCALES).indexOf(prefs.getString("locale", "en")), false); locale.setContentDescription(t("language")); locale.setOnItemSelectedListener(new SimpleSelection(position -> { String chosen = LOCALES[position]; if (!chosen.equals(prefs.getString("locale", "en"))) { selectLanguage(chosen); recreate(); } })); state.addView(locale, new LinearLayout.LayoutParams(dp(92), dp(48)));
        Spinner aiLocale = new Spinner(this); aiLocale.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, LOCALES)); String selectedAI=prefs.getString("ai_locale",prefs.getString("locale","en")); aiLocale.setSelection(Math.max(0,Arrays.asList(LOCALES).indexOf(selectedAI)),false); aiLocale.setContentDescription(t("aiLanguage")); aiLocale.setOnItemSelectedListener(new SimpleSelection(position -> prefs.edit().putString("ai_locale",LOCALES[position]).apply())); state.addView(aiLocale,new LinearLayout.LayoutParams(dp(92),dp(48))); root.addView(state);
        Button display=button(DisplayPreferences.labels(activeLocale())[0]); display.setOnClickListener(v->DisplayPreferences.show(this,activeLocale(),this::recreate)); root.addView(display);
        setContentView(root);
    }

    private void loadVideos(String query) {
        final long generation = beginNavigation();
        if (!online()) { showState(t("offline"), true); return; }
        showState(t("loading"), false);
        worker.execute(() -> {
            try {
                String path = "/v1/videos?q=" + Uri.encode(query);
                JSONObject response = request(path, "GET", null, generation);
                if(nativeBridge.session()!=null){try{VideoApi originalApi=new VideoApi(nativeBridge,boundary,generation);VideoViewerState viewer=new VideoViewerState(this,originalApi);JSONArray pending=viewer.watchPending();for(int i=0;i<pending.length();i++)sendWatch(originalApi,viewer,pending.getJSONObject(i));}catch(Exception held){currentUI(generation,()->accountLine.setText(t("unavailable")));}}
                JSONArray videos = response.optJSONArray("items");
                if (videos == null) videos = response.optJSONArray("data");
                if (videos == null && response.has("array")) videos = response.optJSONArray("array");
                final JSONArray result = videos == null ? new JSONArray() : videos;
                currentUI(generation, () -> renderVideos(result));
            } catch (Exception error) { currentUI(generation, () -> showFailure(error.getMessage())); }
        });
    }

    private JSONObject request(String path,String method,JSONObject payload,long generation) throws Exception {
        boundary.require(generation);
        return new VideoApi(nativeBridge,boundary,generation).json(path,method,payload);
    }

    private void loadCollection(String path,String labelKey) {
        final long generation = beginNavigation();
        if(!online()) { showState(t("offline"),true); return; }
        showState(t("loading"),false);
        worker.execute(() -> {
            try {
                JSONObject response=request(path,"GET",null,generation);
                JSONArray items=response.optJSONArray("array");
                final JSONArray result=items==null ? new JSONArray() : items;
                currentUI(generation, () -> {
                    shownIdentity=nativeBridge.session();content.removeAllViews(); progress.setVisibility(View.GONE);
                    if("playlists".equals(labelKey)){Button create=button(t("createPlaylist"));create.setOnClickListener(v->createPlaylist(generation));content.addView(create);}
                    if(result.length()==0) { content.addView(label(t(labelKey)+" · "+t("empty"),20,Color.DKGRAY)); return; }
                    for(int i=0;i<result.length();i++) {
                        JSONObject item=result.optJSONObject(i);
                        String text=item==null ? String.valueOf(result.opt(i)) : item.optString("Name",item.optString("name",item.optString("VideoID",item.optString("video_id","record"))));
                        content.addView(label(text,18,Color.DKGRAY));
                        if(item!=null&&"subscriptions".equals(labelKey)){String id=item.optString("id");if(id.matches("[A-Za-z0-9_-]+")){Button unsubscribe=button(t("unsubscribe"));unsubscribe.setOnClickListener(v->{if(!boundary.matches(generation))return;worker.execute(()->{try{new VideoApi(nativeBridge,boundary,generation).json("/v1/channels/"+id+"/subscription","DELETE",null);currentUI(generation,()->loadCollection("/v1/subscriptions","subscriptions"));}catch(Exception held){currentUI(generation,()->showState(held.getMessage(),true));}});});content.addView(unsubscribe);}}
                        if(item!=null&&"playlists".equals(labelKey)){final JSONObject original=item;Button open=button(t("play"));open.setOnClickListener(v->showPlaylist(original));content.addView(open);Button remove=button(t("deletePlaylist"));remove.setOnClickListener(v->deletePlaylist(original.optString("ID",original.optString("id")),generation));content.addView(remove);}
                    }
                    status.setText(NumberFormat.getIntegerInstance(activeLocale()).format(result.length())+" · "+t(labelKey));
                });
            } catch(Exception error) { currentUI(generation, () -> showFailure(error.getMessage())); }
        });
    }

    private void createPlaylist(long generation){
        if(!boundary.matches(generation)||nativeBridge.session()==null){showState(t("signIn"),true);return;}
        final VideoApi originalApi=new VideoApi(nativeBridge,boundary,generation);
        final VideoViewerState viewer;final JSONObject pending;
        try{viewer=new VideoViewerState(this,originalApi);pending=viewer.playlistDraft();}catch(Exception held){showState(held.getMessage(),true);return;}
        EditText input=new EditText(this);input.setHint(t("playlists"));
        if(pending!=null){input.setText(pending.optString("name"));input.setEnabled(false);}
        android.app.AlertDialog.Builder builder=new android.app.AlertDialog.Builder(this).setTitle(t("createPlaylist")).setView(input).setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(dialog,which)->{
            if(!boundary.matches(generation))return;
            try{final JSONObject draft=viewer.reservePlaylist(input.getText().toString()),body=new JSONObject().put("Name",draft.getString("name"));
                worker.execute(()->{try{
                    JSONObject created=originalApi.json("/v1/playlists","POST",body,draft.getString("key"));
                    if(!originalApi.identity.account.equals(created.getString("Owner")))throw new SecurityException("Original playlist owner readback required");
                    JSONArray rows=originalApi.json("/v1/playlists","GET",null).getJSONArray("array");boolean found=false;
                    for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(created.getString("ID").equals(row.getString("ID"))&&originalApi.identity.account.equals(row.getString("Owner")))found=true;}
                    if(!found)throw new SecurityException("Original playlist readback unavailable");
                    viewer.finishPlaylist(draft);currentUI(generation,()->loadCollection("/v1/playlists","playlists"));
                }catch(Exception failed){currentUI(generation,()->showState(failed.getMessage(),true));}});
            }catch(Exception failed){showState(failed.getMessage(),true);}
        });
        if(pending!=null)builder.setNeutralButton(t("discardDraft"),(dialog,which)->{if(!boundary.matches(generation))return;try{viewer.finishPlaylist(pending);dialog.dismiss();createPlaylist(generation);}catch(Exception held){showState(held.getMessage(),true);}});
        activeDialog=builder.show();
    }
    private void deletePlaylist(String id,long generation){
        if(!boundary.matches(generation)||!id.matches("[A-Za-z0-9_-]+"))return;
        activeDialog=new android.app.AlertDialog.Builder(this).setTitle(t("deletePlaylist")).setMessage(t("confirmDelete")).setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(dialog,which)->{if(!boundary.matches(generation))return;final VideoApi originalApi=new VideoApi(nativeBridge,boundary,generation);worker.execute(()->{try{originalApi.json("/v1/playlists/"+id,"DELETE",null);currentUI(generation,()->loadCollection("/v1/playlists","playlists"));}catch(Exception held){currentUI(generation,()->showState(held.getMessage(),true));}});}).show();
    }
    private void choosePlaylist(String videoId,long generation){
        if(!boundary.matches(generation)||!videoId.matches("[A-Za-z0-9_-]+"))return;final VideoApi originalApi=new VideoApi(nativeBridge,boundary,generation);
        worker.execute(()->{try{JSONArray items=originalApi.json("/v1/playlists","GET",null).getJSONArray("array");String[] names=new String[items.length()];for(int i=0;i<items.length();i++)names[i]=items.getJSONObject(i).optString("Name",items.getJSONObject(i).optString("name"));currentUI(generation,()->{if(items.length()==0){createPlaylist(generation);return;}activeDialog=new android.app.AlertDialog.Builder(this).setTitle(t("addToPlaylist")).setItems(names,(dialog,index)->{if(!boundary.matches(generation))return;String id=items.optJSONObject(index).optString("ID",items.optJSONObject(index).optString("id"));if(!id.matches("[A-Za-z0-9_-]+"))return;worker.execute(()->{try{originalApi.json("/v1/playlists/"+id+"/videos","POST",new JSONObject().put("video_id",videoId));currentUI(generation,()->showState(t("playlists"),false));}catch(Exception held){currentUI(generation,()->showState(held.getMessage(),true));}});}).setNegativeButton(android.R.string.cancel,null).show();});}catch(Exception held){currentUI(generation,()->showState(held.getMessage(),true));}});
    }
    private void showPlaylist(JSONObject playlist){
        final long generation=beginNavigation();final VideoApi originalApi=new VideoApi(nativeBridge,boundary,generation);String id=playlist.optString("ID",playlist.optString("id"));if(!id.matches("[A-Za-z0-9_-]+"))return;
        worker.execute(()->{try{JSONArray rows=originalApi.json("/v1/playlists","GET",null).getJSONArray("array");JSONObject current=null;for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(id.equals(row.optString("ID",row.optString("id"))))current=row;}if(current==null)throw new IllegalStateException(t("unavailable"));JSONArray ids=current.optJSONArray("VideoIDs");if(ids==null)ids=current.optJSONArray("video_ids");JSONArray videos=new JSONArray();if(ids!=null)for(int i=0;i<ids.length();i++)videos.put(originalApi.json("/v1/videos/"+ids.getString(i),"GET",null));final JSONArray ownedVideos=videos;currentUI(generation,()->{shownIdentity=nativeBridge.session();renderVideos(ownedVideos);for(int i=0;i<ownedVideos.length();i++){JSONObject video=ownedVideos.optJSONObject(i);if(video==null)continue;String vid=video.optString("id");if(!vid.matches("[A-Za-z0-9_-]+"))continue;Button remove=button(t("removeFromPlaylist")+": "+video.optString("title"));remove.setOnClickListener(v->{if(!boundary.matches(generation))return;worker.execute(()->{try{originalApi.json("/v1/playlists/"+id+"/videos/"+vid,"DELETE",null);currentUI(generation,()->showPlaylist(playlist));}catch(Exception held){currentUI(generation,()->showState(held.getMessage(),true));}});});content.addView(remove);}});}catch(Exception held){currentUI(generation,()->showState(held.getMessage(),true));}});
    }
    private void deleteMyData(){
        final long generation=boundary.current();activeDialog=new android.app.AlertDialog.Builder(this).setTitle(t("deleteMyData")).setMessage(t("confirmDelete")).setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(dialog,which)->{if(!boundary.matches(generation))return;final long original=beginNavigation();final VideoApi originalApi=new VideoApi(nativeBridge,boundary,original);worker.execute(()->{try{originalApi.json("/v1/privacy/account-data","DELETE",null);new VideoViewerState(this,originalApi).deleteMyData();currentUI(original,()->loadCollection("/v1/playlists","playlists"));}catch(Exception held){currentUI(original,()->showState(held.getMessage(),true));}});}).show();
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

    private void sendWatch(VideoApi originalApi,VideoViewerState viewer,JSONObject batch)throws Exception{
        String id=batch.getString("videoId");if(!id.matches("[A-Za-z0-9_-]+"))throw new SecurityException("Original watch target required");
        JSONObject reply=originalApi.json("/v1/videos/"+id+"/watch","POST",new JSONObject().put("seconds",batch.getInt("seconds")).put("completed",batch.getBoolean("completed")).put("playback_id",batch.getString("playbackId")),batch.getString("key"));
        if(!reply.optBoolean("ok"))throw new SecurityException("Original watch acknowledgment required");viewer.finishWatch(batch);
    }

    private void playVideo(JSONObject video) {
        final long generation = beginNavigation();
        String key = ""; JSONArray variants = video.optJSONArray("variants");
        if (variants != null) for (int i=0;i<variants.length();i++) { JSONObject item=variants.optJSONObject(i); if (item != null && ("adaptive-hls".equals(item.optString("name")) || key.isEmpty())) key=item.optString("object_key"); }
        if (key.isEmpty()) { showState(t("unavailable"), true); return; }
        if(nativeBridge.session()==null){
            VideoView player=new VideoView(this);activePlayer=player;player.setContentDescription(t("play")+": "+video.optString("title"));player.setMediaController(new android.widget.MediaController(this));
            try{player.setVideoURI(Uri.parse(VideoRequestBoundary.url("/media/"+key).toString()));}catch(Exception failure){showFailure(failure.getMessage());return;}
            player.setOnPreparedListener(media->{if(boundary.matches(generation))player.start();else player.stopPlayback();});content.removeAllViews();content.addView(player,new LinearLayout.LayoutParams(-1,dp(260)));
        }else{
            JSONObject nativeVariant=null;if(variants!=null)for(int i=0;i<variants.length();i++){JSONObject variant=variants.optJSONObject(i);if(variant!=null&&("video/mp4".equals(variant.optString("mime"))||variant.optString("object_key").endsWith(".mp4"))&&variant.optLong("bytes")>0)nativeVariant=variant;}
            if(nativeVariant==null&&("video/mp4".equals(video.optString("content_type"))||"video/webm".equals(video.optString("content_type")))&&video.optLong("bytes")>0){try{nativeVariant=new JSONObject().put("object_key",video.getString("object_key")).put("bytes",video.getLong("bytes"));}catch(Exception invalid){showState(t("unavailable"),true);return;}}
            if(nativeVariant==null){showState(t("unavailable"),true);return;}
            final JSONObject originalVariant=nativeVariant;final VideoApi originalApi=new VideoApi(nativeBridge,boundary,generation);final String videoId=video.optString("id");
            showState(t("loading"),false);
            worker.execute(()->{try{final VideoViewerState viewer=new VideoViewerState(this,originalApi);JSONObject resume=viewer.playback(videoId);final String playbackId=resume.getString("playbackId");final int resumeAt=Math.min(Integer.MAX_VALUE/1000,resume.getInt("position"));
                VideoMediaSource source=new VideoMediaSource(originalApi,originalVariant.getString("object_key"),originalVariant.getLong("bytes"));
                currentUI(generation,()->{try{originalApi.requireCurrent();privatePlayer=new VideoPlaybackView(this,originalApi,source,resumeAt,new VideoPlaybackView.Events(){public void position(int positionSeconds,int seconds,boolean completed){final JSONObject batch;try{batch=viewer.position(videoId,playbackId,positionSeconds,seconds,completed);}catch(Exception held){showState(held.getMessage(),true);return;}if(batch==null)return;worker.execute(()->{try{sendWatch(originalApi,viewer,batch);}catch(Exception held){currentUI(generation,()->showState(held.getMessage(),true));}});}public void failure(String detail){currentUI(generation,()->showState(detail,true));}});privatePlayer.setContentDescription(t("play")+": "+video.optString("title"));content.addView(privatePlayer,0,new LinearLayout.LayoutParams(-1,dp(260)));progress.setVisibility(View.GONE);}catch(Exception retired){source.close();showState(retired.getMessage(),true);}});
            }catch(Exception failure){currentUI(generation,()->showState(failure.getMessage(),true));}});
        }
        Button replay=button(t("play"));replay.setOnClickListener(v->playVideo(video));content.addView(replay);
        JSONArray captions=video.optJSONArray("captions"); content.addView(label(t("captions") + ": " + (captions == null ? 0 : captions.length()), 14, Color.DKGRAY));
        LinearLayout actions=row();
        Button subscribe=button(t("subscriptions"));subscribe.setOnClickListener(v->{if(!boundary.matches(generation))return;final VideoApi originalApi=new VideoApi(nativeBridge,boundary,generation);worker.execute(()->{try{originalApi.json("/v1/channels/"+video.optString("channel_id")+"/subscription","PUT",null);currentUI(generation,()->showState(t("subscriptions"),false));}catch(Exception held){currentUI(generation,()->showState(held.getMessage(),true));}});});actions.addView(subscribe,new LinearLayout.LayoutParams(0,dp(52),1));
        Button add=button(t("addToPlaylist"));add.setOnClickListener(v->choosePlaylist(video.optString("id"),generation));actions.addView(add,new LinearLayout.LayoutParams(0,dp(52),1));
        Button comments=button(t("comments"));comments.setOnClickListener(v->comment(video));actions.addView(comments,new LinearLayout.LayoutParams(0,dp(52),1));
        Button report=button(t("report"));report.setOnClickListener(v->report(video));actions.addView(report,new LinearLayout.LayoutParams(0,dp(52),1));content.addView(actions);
        if(captions!=null&&captions.length()>0){Button transcript=button(t("captions"));transcript.setOnClickListener(v->loadTranscript(captions.optJSONObject(0)));content.addView(transcript);}
    }

    private void postAction(String path,JSONObject body,String success,long generation){
        if(!boundary.matches(generation))return;
        worker.execute(()->{try{request(path,"POST",body,generation);currentUI(generation,()->{showState(success,false);progress.setVisibility(View.GONE);});}catch(Exception error){currentUI(generation,()->showState(error.getMessage(),true));}});
    }
    private void comment(JSONObject video){
        final long generation=boundary.current();EditText input=new EditText(this);input.setHint(t("comments"));
        activeDialog=new android.app.AlertDialog.Builder(this).setTitle(t("comments")).setView(input).setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(dialog,which)->{if(!boundary.matches(generation))return;try{postAction("/v1/videos/"+video.optString("id")+"/comments",new JSONObject().put("body",input.getText().toString()),t("comments"),generation);}catch(Exception error){showState(error.getMessage(),true);}}).show();
    }
    private void report(JSONObject video){
        final long generation=boundary.current();EditText input=new EditText(this);input.setHint(t("report"));
        activeDialog=new android.app.AlertDialog.Builder(this).setTitle(t("report")).setMessage(t("noMetrics")).setView(input).setNegativeButton(android.R.string.cancel,null).setPositiveButton(android.R.string.ok,(dialog,which)->{if(!boundary.matches(generation))return;try{postAction("/v1/videos/"+video.optString("id")+"/reports",new JSONObject().put("reason","viewer_report").put("details",input.getText().toString()),t("report"),generation);}catch(Exception error){showState(error.getMessage(),true);}}).show();
    }
    private void loadTranscript(JSONObject track){
        if(track==null||!track.optBoolean("human_approved")){showState(t("unavailable"),true);return;}
        final long generation=boundary.current();worker.execute(()->{
            try{VideoApi originalApi=new VideoApi(nativeBridge,boundary,generation);String text=originalApi.text("/media/"+track.optString("object_key"));StringBuilder body=new StringBuilder();for(String line:text.split("\n")){if(!line.startsWith("WEBVTT")&&!line.contains("-->"))body.append(line).append('\n');}
                currentUI(generation,()->{TextView transcript=label(body.toString().trim(),16,Color.DKGRAY);transcript.setContentDescription(t("captions"));content.addView(transcript);});
            }catch(Exception error){currentUI(generation,()->showState(error.getMessage(),true));}
        });
    }

    private long beginNavigation(){
        long generation=boundary.advance();
        if(activePlayer!=null){activePlayer.stopPlayback();activePlayer=null;}
        if(privatePlayer!=null){privatePlayer.stopPlayback();privatePlayer=null;}
        if(activeDialog!=null){activeDialog.dismiss();activeDialog=null;}
        if(content!=null)content.removeAllViews();
        return generation;
    }
    private void currentUI(long generation,Runnable action){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed()&&boundary.matches(generation))action.run();});}
    @Override protected void onStop(){if(activePlayer!=null)activePlayer.pause();if(privatePlayer!=null)privatePlayer.pause();super.onStop();}
    @Override protected void onDestroy(){beginNavigation();nativeBridge.removeListener(authorityChanged);worker.shutdownNow();super.onDestroy();}

    private void showFailure(String detail) { content.removeAllViews(); content.addView(label(t("unavailable"), 20, Color.DKGRAY)); TextView reason=label(detail,14,Color.GRAY); content.addView(reason); Button retry=button(t("retry")); retry.setOnClickListener(v -> restoreSession()); content.addView(retry); showState(t("unavailable"), true); }
    private void showState(String message, boolean failed) { status.setText(message); status.setTextColor(failed ? Color.rgb(155,35,53) : Color.DKGRAY); progress.setVisibility(failed ? View.GONE : View.VISIBLE); }

    private void refreshNativeBridge(){
        NativeSessionBridge current=NativeSessionBridge.acquire(this);
        if(current!=nativeBridge){nativeBridge.removeListener(authorityChanged);nativeBridge=current;nativeBridge.addListener(authorityChanged);}
    }
    private void startWallet(){
        refreshNativeBridge();
        final long generation=beginNavigation();authTransition=true;shownIdentity=null;showState(t("loading"),false);
        nativeBridge.disconnect((value,error)->{if(!boundary.matches(generation))return;if(error!=null){authTransition=false;showState(error.getMessage(),true);return;}
            nativeBridge.connect((launched,failure)->{if(!boundary.matches(generation))return;authTransition=false;showState(failure==null?t("signIn"):failure.getMessage(),failure!=null);progress.setVisibility(View.GONE);});});
    }
    private void restoreSession(){restoreSession("");}
    private void restoreSession(String query){
        refreshNativeBridge();
        final long generation=beginNavigation();authTransition=true;shownIdentity=null;showState(t("loading"),false);
        nativeBridge.restore((value,error)->{if(!boundary.matches(generation))return;authTransition=false;if(error!=null){showFailure(error.getMessage());return;}accountLine.setText(nativeBridge.session()==null?t("signIn"):nativeBridge.session().account);loadVideos(query);});
    }
    private void signOut(){
        refreshNativeBridge();
        final long generation=beginNavigation();authTransition=true;shownIdentity=null;showState(t("loading"),false);
        nativeBridge.disconnect((value,error)->{if(!boundary.matches(generation))return;authTransition=false;accountLine.setText(t("signIn"));if(error!=null){showFailure(error.getMessage());return;}loadVideos("");});
    }
    private boolean handleIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData(); if (data == null) return false;
        if (!"ynxvideo".equals(data.getScheme()) || data.getUserInfo()!=null || data.getPort()!=-1 || data.getFragment()!=null) return false;
        if ("wallet-auth".equals(data.getHost()) && "/callback".equals(data.getPath())) {
            final String originalCallback=data.toString();setIntent(new Intent(intent).setData(null));
            final long generation=beginNavigation();authTransition=true;shownIdentity=null;showState(t("loading"),false);
            refreshNativeBridge();
            nativeBridge.handleReturn(originalCallback,(value,error)->{if(!boundary.matches(generation))return;authTransition=false;if(error!=null||nativeBridge.session()==null){showFailure(error==null?t("signIn"):error.getMessage());return;}accountLine.setText(nativeBridge.session().account);loadVideos("");});
            return true;
        }
        if ("watch".equals(data.getHost())) { restoreSession(data.getQueryParameter("video")==null?"":data.getQueryParameter("video")); return true; }
        return false;
    }

    private boolean online() { ConnectivityManager cm=(ConnectivityManager)getSystemService(Context.CONNECTIVITY_SERVICE); Network network=cm.getActiveNetwork(); NetworkCapabilities caps=network==null?null:cm.getNetworkCapabilities(network); return caps!=null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET); }
    private Locale activeLocale() { return Locale.forLanguageTag(prefs.getString("locale","en")); }
    String formatDate(java.util.Date value) { return DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT,activeLocale()).format(value); }
    String formatCurrency(long value) { NumberFormat f=NumberFormat.getCurrencyInstance(activeLocale()); f.setCurrency(java.util.Currency.getInstance("CNY")); return f.format(value); }
    String pluralRecords(int count) { return NumberFormat.getIntegerInstance(activeLocale()).format(count)+(count==1?" record":" records"); }
    private LinearLayout row() { LinearLayout x=new LinearLayout(this); x.setOrientation(LinearLayout.HORIZONTAL); x.setGravity(Gravity.CENTER_VERTICAL); return x; }
    private TextView label(String text,int sp,int color) { TextView x=new TextView(this); x.setText(text); x.setTextSize(sp*DisplayPreferences.factor(this)); x.setTextColor(color); x.setPadding(dp(6),dp(6),dp(6),dp(6)); return x; }
    private Button button(String text) { Button x=new Button(this); x.setText(text); x.setAllCaps(false); x.setTextSize(14*DisplayPreferences.factor(this)); x.setMinHeight(dp(48)); return x; }
    private int dp(int value) { return Math.round(value*getResources().getDisplayMetrics().density); }
    private void Space(LinearLayout parent) { View space=new View(this); parent.addView(space,new LinearLayout.LayoutParams(1,dp(8))); }

    private static final class SimpleSelection implements android.widget.AdapterView.OnItemSelectedListener {
        interface Choice { void selected(int position); } private final Choice choice; SimpleSelection(Choice value){choice=value;}
        public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id){choice.selected(position);} public void onNothingSelected(android.widget.AdapterView<?> parent){}
    }
}

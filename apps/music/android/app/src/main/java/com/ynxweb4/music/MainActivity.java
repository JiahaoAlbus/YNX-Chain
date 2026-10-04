package com.ynxweb4.music;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.*;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.file.Files;
import java.text.NumberFormat;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.*;

public final class MainActivity extends Activity {
    private static final int BLUE=Color.rgb(0,47,167), PICK_AUDIO=42;
    private int canvas,primaryText,secondaryText; private volatile long authGeneration=0; private long audioPickerGeneration=-1;
    private volatile long caseBusyGeneration=-1;private volatile long uploadBusyGeneration=-1;private long visibleNativeEpoch=-1;private AlertDialog uploadDialog;private final Runnable nativeChanged=()->{if(this.nativeBridge.session()==null){if(visibleNativeEpoch>=0)retireUI();detachUI();}};
    private final MusicReadBoundary snapshotReads=new MusicReadBoundary();
    private final Set<AlertDialog> accountDialogs=new HashSet<>();
    private final java.util.concurrent.ExecutorService libraryExecutor=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final MusicLibraryWriter libraryWriter=new MusicLibraryWriter(libraryExecutor);
    private AlertDialog playlistDialog; private LinearLayout content; private TextView status,now; private EditText search; private JSONObject state; private MusicStore store; private MusicApi api; private NativeSessionBridge nativeBridge; private String view="home";
    @Override protected void attachBaseContext(Context base){super.attachBaseContext(LocaleSupport.wrap(base));}
    @Override public void onCreate(Bundle b){super.onCreate(b);boolean dark=(getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_NIGHT_MASK)==android.content.res.Configuration.UI_MODE_NIGHT_YES;canvas=dark?Color.rgb(28,28,30):Color.rgb(247,247,248);primaryText=dark?Color.rgb(245,245,247):Color.rgb(29,29,31);secondaryText=dark?Color.rgb(174,174,178):Color.rgb(110,110,115);MusicStore.detach(this);store=new MusicStore(this);nativeBridge=NativeSessionBridge.acquire(this);api=new MusicApi(this,nativeBridge);state=store.load();build();nativeBridge.addListener(nativeChanged);if(!handleCallback(getIntent()))recover();if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},5);}
    @Override protected void onNewIntent(Intent i){super.onNewIntent(i);setIntent(i);handleCallback(i);}
    @Override public void onAttachedToWindow(){super.onAttachedToWindow();View frame=findViewById(android.R.id.content);frame.setOnApplyWindowInsetsListener((v,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);}else{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());}return insets;});frame.requestApplyInsets();}
    private TextView text(String value,int sp){TextView v=new TextView(this);v.setText(value);v.setTextSize(sp*DisplayPreferences.factor(this));v.setTextColor(primaryText);v.setPadding(dp(16),dp(10),dp(16),dp(10));return v;}
    private Button button(String label){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(14*DisplayPreferences.factor(this));b.setContentDescription(label);b.setTextColor(Color.WHITE);b.setMinHeight(dp(48));android.graphics.drawable.GradientDrawable background=new android.graphics.drawable.GradientDrawable();background.setColor(BLUE);background.setCornerRadius(dp(12));b.setBackground(background);b.setPadding(dp(16),dp(10),dp(16),dp(10));return b;}
    private void build(){LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(canvas);LinearLayout branding=new LinearLayout(this);branding.setOrientation(LinearLayout.HORIZONTAL);branding.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);branding.setGravity(Gravity.CENTER_VERTICAL);branding.setPadding(dp(12),dp(12),dp(12),dp(8));ImageView logo=new ImageView(this);logo.setImageResource(R.drawable.ynx_brand_original);logo.setScaleType(ImageView.ScaleType.FIT_CENTER);logo.setContentDescription("YNX");logo.setBackgroundColor(Color.WHITE);logo.setPadding(0,0,0,0);LinearLayout.LayoutParams logoLayout=new LinearLayout.LayoutParams(dp(46),dp(24));logoLayout.setMarginEnd(dp(12));branding.addView(logo,logoLayout);TextView title=text(getString(R.string.app_name),16);title.setTextColor(primaryText);title.setTypeface(null,android.graphics.Typeface.BOLD);branding.addView(title,new LinearLayout.LayoutParams(0,LinearLayout.LayoutParams.WRAP_CONTENT,1));root.addView(branding);Button wallet=button(getString(R.string.sign_in_wallet));wallet.setOnClickListener(v->wallet());root.addView(wallet);status=text(getString(R.string.loading),13);status.setTextColor(secondaryText);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);search=new EditText(this);search.setHint(R.string.search_hint);search.setSingleLine();search.setContentDescription(getString(R.string.search));search.setOnEditorActionListener((v,a,e)->{renderCatalog();return true;});root.addView(search,new LinearLayout.LayoutParams(-1,-2));LinearLayout nav=new LinearLayout(this);String[] labels={getString(R.string.home),getString(R.string.library),getString(R.string.settings)};String[] ids={"home","library","settings"};for(int i=0;i<ids.length;i++){Button n=button(labels[i]);final String id=ids[i];n.setOnClickListener(v->{view=id;render();});nav.addView(n,new LinearLayout.LayoutParams(0,-2,1));}root.addView(nav);ScrollView scroll=new ScrollView(this);content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(dp(16),dp(10),dp(16),dp(120));scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));LinearLayout player=new LinearLayout(this);player.setGravity(Gravity.CENTER_VERTICAL);player.setBackgroundColor(canvas);now=text(getString(R.string.nothing_playing),16);player.addView(now,new LinearLayout.LayoutParams(0,-2,1));Button play=button(getString(R.string.play));play.setOnClickListener(v->startService(new Intent(this,PlaybackService.class).setAction(PlaybackService.PLAY)));Button pause=button(getString(R.string.pause));pause.setOnClickListener(v->startService(new Intent(this,PlaybackService.class).setAction(PlaybackService.PAUSE)));player.addView(play);player.addView(pause);root.addView(player);setContentView(root);}
    private void refresh(){
        if(nativeBridge.session()==null){recover();return;}
        final long generation=authGeneration,readGeneration=snapshotReads.begin();final MusicApi requestApi=api;
        status.setText(R.string.loading);render();
        new Thread(()->{try{
            JSONObject remote=requestApi.get("/api/me");
            runOnUiThread(()->{
                if(generation!=authGeneration||!snapshotReads.current(readGeneration))return;
                try{
                    if(!snapshotReads.commit(readGeneration,()->{
                    JSONObject profile=remote.optJSONObject("profile");if(profile==null)throw new IOException("Verified Music profile missing");
                    String account=profile.getString("account");requestApi.assertCurrent();if(!account.equals(requestApi.account()))throw new IOException("Original Music account readback mismatch");
                    MusicStore selected=MusicStore.selectAccount(this,account);JSONObject received=selected.commitSnapshot(remote,requestApi::assertCurrent);
                    // A failed cache commit must not publish service readiness.
                    // UI-thread publication serializes this with retireUI.
                    store=selected;state=received;visibleNativeEpoch=nativeBridge.epoch();
                    }))return;
                    status.setText(state.has("libraryIntent")?R.string.loading:R.string.ready);render();if(state.has("libraryIntent"))publishLibrary();
                }catch(Exception e){snapshotReads.failed(readGeneration);status.setText(getString(R.string.retry)+": "+e.getMessage());render();}
            });
        }catch(Exception e){runOnUiThread(()->{if(generation!=authGeneration||!snapshotReads.failed(readGeneration))return;status.setText(getString(R.string.offline_mode)+": "+e.getMessage());render();});}}).start();
    }
    private void render(){content.removeAllViews();if("settings".equals(view)){creatorEntry();renderSettings();return;}if(!hasCurrentSnapshot()){renderSnapshotNotice();return;}if(snapshotReads.state()!=MusicReadBoundary.State.READY)renderSnapshotNotice();if("creator".equals(view)){renderCreator();return;}if("library".equals(view)){heading(R.string.library);renderPendingCase();renderIds(state.optJSONArray("favorites"),getString(R.string.favorites));renderIds(state.optJSONArray("queue"),getString(R.string.queue));JSONObject remote=state.optJSONObject("remote"),listener=remote==null?null:remote.optJSONObject("listener");renderIds(listener==null?null:listener.optJSONArray("history"),getString(R.string.private_history));JSONObject downloads=state.optJSONObject("downloads");content.addView(text(getString(R.string.download_ready)+": "+(downloads==null?0:downloads.length()),14));Button playlist=button(getString(R.string.library)+" · "+getString(R.string.favorites));playlist.setOnClickListener(v->createPlaylist());content.addView(playlist);renderPlaylists();return;}renderCatalog();}
    private boolean hasCurrentSnapshot(){return nativeBridge.session()!=null && visibleNativeEpoch==nativeBridge.epoch() && state.optJSONObject("remote")!=null;}
    private void renderSnapshotNotice(){
        MusicReadBoundary.State read=snapshotReads.state();
        content.addView(text(getString(read==MusicReadBoundary.State.LOADING?R.string.loading:read==MusicReadBoundary.State.FAILED?R.string.offline_mode:R.string.sign_in_wallet),16));
        if(read!=MusicReadBoundary.State.LOADING){Button retry=button(getString(R.string.retry));retry.setOnClickListener(v->{if(nativeBridge.session()!=null)refresh();else recover();});content.addView(retry);}
    }
    private void creatorEntry(){Button studio=button(getString(R.string.creator));studio.setOnClickListener(v->{view="creator";render();});content.addView(studio);content.addView(text(getString(R.string.creator_truth),13));}
    private void renderCatalog(){content.removeAllViews();heading(R.string.catalog);if(!hasCurrentSnapshot()){renderSnapshotNotice();return;}if(snapshotReads.state()!=MusicReadBoundary.State.READY)renderSnapshotNotice();JSONArray tracks=state.optJSONObject("remote")!=null?state.optJSONObject("remote").optJSONArray("catalog"):new JSONArray();String q=search.getText().toString().toLowerCase(Locale.ROOT);int shown=0;for(int i=0;i<tracks.length();i++){JSONObject t=tracks.optJSONObject(i);if(t==null)continue;String hay=t.optString("title")+" "+t.optString("artistName")+" "+t.optString("album");if(!q.trim().isEmpty()&&!hay.toLowerCase(Locale.ROOT).contains(q))continue;trackCard(t);shown++;}if(shown==0){content.addView(text(getString(tracks.length()==0?R.string.empty_catalog:R.string.no_search_results),16));Button retry=button(getString(R.string.retry));retry.setOnClickListener(v->refresh());content.addView(retry);}}
    private void trackCard(JSONObject t){LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(12),dp(12),dp(12),dp(12));TextView name=text(t.optString("title")+" — "+t.optString("artistName"),18);name.setTypeface(null,android.graphics.Typeface.BOLD);name.setOnClickListener(v->trackDialog(new AlertDialog.Builder(this).setTitle(t.optString("title")).setMessage(t.optString("artistName")+"\n"+t.optString("album")+"\n"+getString(R.string.rights)+": "+t.optJSONObject("rights").optString("basis")+"\n"+getString(R.string.provenance)+": "+t.optJSONObject("provenance").optString("audio")).setPositiveButton(android.R.string.ok,null).show()));card.addView(name);card.addView(text(getString(R.string.rights)+": "+t.optJSONObject("rights").optString("basis")+" · "+getString(R.string.provenance)+": "+t.optJSONObject("provenance").optString("audio"),12));LinearLayout actions=new LinearLayout(this);Button play=button(getString(R.string.play));play.setOnClickListener(v->play(t));Button fav=button(getString(R.string.favorite));fav.setOnClickListener(v->toggle("favorites",t.optString("id")));Button queue=button(getString(R.string.add_queue));queue.setOnClickListener(v->toggle("queue",t.optString("id")));Button dl=button(getString(R.string.download));dl.setOnClickListener(v->download(t));Button report=button(getString(R.string.rights));report.setOnClickListener(v->caseDialog(t));actions.addView(play);actions.addView(fav);actions.addView(queue);actions.addView(dl);actions.addView(report);card.addView(actions);content.addView(card);}
    private void play(JSONObject track){
        status.setText(R.string.downloading);
        runAccountTask((requestApi,requestState,generation)->{try{
            String id=track.getString("id");File local=store.offline(id);if(!local.isFile())local=requestApi.download(id);MusicApi.verifyLocal(local,track.getString("audioSha256"));requestApi.assertCurrent();
            final File ready=local;runAccountUI(generation,()->{try{requestApi.assertCurrent();int position=id.equals(state.optString("trackId"))?state.optInt("position"):0;
                Intent intent=new Intent(this,PlaybackService.class).setAction(PlaybackService.PLAY).putExtra("trackId",id).putExtra("title",track.optString("title")).putExtra("uri",Uri.fromFile(ready).toString()).putExtra("position",position).putExtra("account",requestApi.account());
                if(Build.VERSION.SDK_INT>=26)startForegroundService(intent);else startService(intent);now.setText(track.optString("title"));status.setText(R.string.ready);
            }catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());}});
        }catch(Exception error){runAccountUI(generation,()->status.setText(getString(R.string.retry)+": "+error.getMessage()));}});
    }
    private void download(JSONObject t){
        if(!hasCurrentSnapshot())return;
        final MusicStore selected=store;final String id=t.optString("id");status.setText(R.string.downloading);
        runAccountTask((requestApi,requestState,generation)->{try{
            requestApi.download(id);
            runAccountUI(generation,()->{try{state=selected.commitDownload(id,requestApi::assertCurrent);status.setText(R.string.download_ready);render();publishLibrary();}catch(Exception e){status.setText(getString(R.string.download_failed)+": "+e.getMessage());}});
        }catch(Exception e){runAccountUI(generation,()->status.setText(getString(R.string.download_failed)+": "+e.getMessage()));}});
    }
    private void toggle(String key,String id){
        if(!hasCurrentSnapshot())return;
        try{
            api.assertCurrent();state=store.toggleLibrary(key,id,api::assertCurrent);render();publishLibrary();
        }catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());}
    }
    private void publishLibrary(){
        if(!hasCurrentSnapshot()||!state.has("libraryIntent"))return;
        final long generation=authGeneration;final MusicApi requestApi=api;final MusicStore selected=store;
        try{libraryWriter.submit(requestApi,selected,state,()->{if(generation!=authGeneration)throw new IOException("Original Music view retired");},(acknowledged,failure)->runAccountUI(generation,()->{
            if(failure!=null){status.setText(getString(R.string.offline_mode)+": "+failure.getMessage());return;}
            if(acknowledged){try{requestApi.assertCurrent();selected.requireAccount(requestApi.account());state=selected.load();render();if(snapshotReads.state()==MusicReadBoundary.State.READY&&!state.has("libraryIntent"))status.setText(R.string.ready);}catch(Exception error){status.setText(R.string.retry);}}
        }));}catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());}
    }
    private JSONObject findTrack(String id){JSONObject remote=state.optJSONObject("remote");if(remote!=null)for(String key:new String[]{"catalog","creatorTracks"}){JSONArray tracks=remote.optJSONArray(key);if(tracks!=null)for(int i=0;i<tracks.length();i++){JSONObject track=tracks.optJSONObject(i);if(track!=null&&id.equals(track.optString("id")))return track;}}return null;}
    private void renderPlaylists(){
        content.addView(text(getString(R.string.playlists),20));
        JSONObject remote=state.optJSONObject("remote");JSONArray playlists=remote==null?null:remote.optJSONArray("playlists");
        if(playlists==null||playlists.length()==0){content.addView(text(getString(R.string.empty_playlists),14));return;}
        final long openedGeneration=authGeneration;
        for(int i=0;i<playlists.length();i++){
            JSONObject playlist=playlists.optJSONObject(i);if(playlist==null)continue;
            String id=playlist.optString("id");Button edit=button(playlist.optString("name"));
            edit.setOnClickListener(v->runAccountTask(openedGeneration,(requestApi,requestState,generation)->{
                try{JSONObject fresh=requestApi.playlist(id);runAccountUI(generation,()->editPlaylist(fresh,generation));}
                catch(Exception e){runAccountUI(generation,()->status.setText(getString(R.string.retry)+": "+e.getMessage()));}
            }));content.addView(edit);
        }
    }
    private void editPlaylist(JSONObject playlist,long openedGeneration){
        if(openedGeneration!=authGeneration)return;
        ArrayList<String> ids=new ArrayList<>();JSONArray source=playlist.optJSONArray("trackIds");
        if(source!=null)for(int i=0;i<source.length();i++)ids.add(source.optString(i));
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);
        EditText name=new EditText(this);name.setHint(R.string.playlist_name);name.setText(playlist.optString("name"));panel.addView(name);
        EditText description=new EditText(this);description.setHint(R.string.playlist_description);description.setText(playlist.optString("description"));panel.addView(description);
        LinearLayout rows=new LinearLayout(this);rows.setOrientation(LinearLayout.VERTICAL);panel.addView(rows);
        TextView error=text("",14);panel.addView(error);
        Runnable[] draw=new Runnable[1];draw[0]=()->{
            rows.removeAllViews();
            for(String id:new ArrayList<>(ids)){
                JSONObject track=findTrack(id);rows.addView(text(track==null?id:track.optString("title",id),16));
                LinearLayout controls=new LinearLayout(this);controls.setOrientation(LinearLayout.VERTICAL);
                Button up=button(getString(R.string.move_up)),down=button(getString(R.string.move_down)),remove=button(getString(R.string.remove_track));
                up.setEnabled(ids.indexOf(id)>0);down.setEnabled(ids.indexOf(id)<ids.size()-1);
                up.setOnClickListener(v->{int at=ids.indexOf(id);if(at>0)Collections.swap(ids,at,at-1);draw[0].run();});
                down.setOnClickListener(v->{int at=ids.indexOf(id);if(at>=0&&at+1<ids.size())Collections.swap(ids,at,at+1);draw[0].run();});
                remove.setOnClickListener(v->{ids.remove(id);draw[0].run();});
                controls.addView(up);controls.addView(down);controls.addView(remove);rows.addView(controls);
            }
            rows.addView(text(getString(R.string.add_track),18));
            JSONObject remote=state.optJSONObject("remote");JSONArray catalog=remote==null?null:remote.optJSONArray("catalog");
            if(catalog!=null)for(int i=0;i<catalog.length();i++){
                JSONObject track=catalog.optJSONObject(i);if(track==null)continue;String id=track.optString("id");if(ids.contains(id))continue;
                Button add=button(track.optString("title",id));add.setOnClickListener(v->{ids.add(id);draw[0].run();});rows.addView(add);
            }
        };draw[0].run();
        ScrollView scroll=new ScrollView(this);scroll.addView(panel);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle(R.string.edit_playlist).setView(scroll).setNegativeButton(R.string.cancel,null).setPositiveButton(R.string.save,null).create();
        playlistDialog=dialog;dialog.setOnDismissListener(d->{if(playlistDialog==dialog)playlistDialog=null;});trackDialog(dialog);dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            if(openedGeneration!=authGeneration){dialog.dismiss();return;}
            String submittedName=name.getText().toString(),submittedDescription=description.getText().toString();
            if(submittedName.trim().isEmpty())return;
            JSONArray submittedIDs=new JSONArray(ids);String playlistID=playlist.optString("id");
            setPlaylistControls(panel,false);dialog.setCancelable(false);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);error.setText("");
            runAccountTask(openedGeneration,(requestApi,requestState,generation)->{
                try{
                    requestApi.savePlaylist(playlistID,submittedName,submittedDescription,submittedIDs);
                    JSONObject readback=requestApi.playlist(playlistID);
                    if(!submittedName.equals(readback.optString("name"))||!submittedDescription.equals(readback.optString("description"))||!submittedIDs.toString().equals(readback.optJSONArray("trackIds").toString()))throw new IOException("Playlist readback differs");
                    runAccountUI(generation,()->{dialog.dismiss();refresh();});
                }catch(Exception e){runAccountUI(generation,()->{setPlaylistControls(panel,true);draw[0].run();dialog.setCancelable(true);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);error.setText(R.string.playlist_save_failed);});}
            });
        });
    }
    private void setPlaylistControls(View view,boolean enabled){view.setEnabled(enabled);if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)setPlaylistControls(group.getChildAt(i),enabled);}}
    private void createPlaylist(){
        final long openedGeneration=authGeneration;JSONObject saved=state.optJSONObject("playlistCreation");JSONArray favorites=state.optJSONArray("favorites");
        if(saved==null&&(favorites==null||favorites.length()==0)){status.setText(R.string.empty_library);return;}
        final String[] originalCreationKey={saved==null?"":saved.optString("key")};
        final JSONArray initialIDs;try{initialIDs=new JSONArray((saved==null?favorites:saved.getJSONArray("trackIDs")).toString());}catch(Exception e){status.setText(R.string.playlist_save_failed);return;}
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);
        EditText name=new EditText(this);name.setHint(R.string.playlist_name);name.setText(saved==null?"":saved.optString("name"));name.setEnabled(saved==null);panel.addView(name);
        TextView warning=text(saved==null?"":getString(R.string.playlist_pending),14);panel.addView(warning);
        Button fresh=button(getString(R.string.new_playlist));fresh.setVisibility(saved==null?View.GONE:View.VISIBLE);panel.addView(fresh);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle(R.string.playlists).setView(panel).setNegativeButton(R.string.cancel,null).setPositiveButton(R.string.save,null).create();
        playlistDialog=dialog;dialog.setOnDismissListener(d->{if(playlistDialog==dialog)playlistDialog=null;});trackDialog(dialog);dialog.show();
        fresh.setOnClickListener(v->trackDialog(new AlertDialog.Builder(this).setTitle(R.string.new_playlist).setMessage(R.string.playlist_pending).setNegativeButton(R.string.cancel,null).setPositiveButton(R.string.new_playlist,(d,w)->{
            if(openedGeneration!=authGeneration)return;
            try{state=store.finishPlaylist(originalCreationKey[0],"",new JSONArray(),true,api::assertCurrent);dialog.dismiss();createPlaylist();}catch(Exception e){status.setText(R.string.playlist_save_failed);}
        }).show()));
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            if(openedGeneration!=authGeneration){dialog.dismiss();return;}
            final String submitted,key;final JSONArray ids;
            try{
                state=store.preparePlaylist(name.getText().toString(),initialIDs,api::assertCurrent);JSONObject intent=state.getJSONObject("playlistCreation");
                key=intent.getString("key");originalCreationKey[0]=key;submitted=intent.getString("name");ids=new JSONArray(intent.getJSONArray("trackIDs").toString());
            }catch(Exception e){warning.setText(R.string.playlist_save_failed);return;}
            name.setText(submitted);name.setEnabled(false);fresh.setEnabled(false);dialog.setCancelable(false);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
            runAccountTask(openedGeneration,(requestApi,requestState,generation)->{
                try{requestApi.createPlaylist(submitted,ids,key);runAccountUI(generation,()->{
                    try{state=store.finishPlaylist(key,submitted,ids,false,requestApi::assertCurrent);dialog.dismiss();refresh();}
                    catch(Exception e){fresh.setEnabled(true);fresh.setVisibility(View.VISIBLE);dialog.setCancelable(true);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);warning.setText(R.string.playlist_save_failed);}
                });}
                catch(Exception e){runAccountUI(generation,()->{fresh.setEnabled(true);fresh.setVisibility(View.VISIBLE);dialog.setCancelable(true);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);warning.setText(R.string.playlist_pending);status.setText(R.string.playlist_save_failed);});}
            });
        });
    }
    private void renderIds(JSONArray ids,String label){content.addView(text(label,18));if(ids==null||ids.length()==0){content.addView(text(getString(R.string.empty_library),14));return;}for(int i=0;i<ids.length();i++){Object value=ids.opt(i);content.addView(text(value instanceof JSONObject?((JSONObject)value).toString():String.valueOf(value),14));}}
    private void renderCreator(){heading(R.string.creator);content.addView(text(getString(R.string.creator_truth),14));renderPendingUpload();renderPendingCase();Button pick=button(getString(R.string.upload_owned_audio));pick.setEnabled(nativeBridge.session()!=null&&visibleNativeEpoch==nativeBridge.epoch()&&uploadBusyGeneration!=authGeneration&&!state.has("uploadIntent"));pick.setOnClickListener(v->{audioPickerGeneration=authGeneration;startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/wav").addCategory(Intent.CATEGORY_OPENABLE),PICK_AUDIO);});content.addView(pick);JSONObject remote=state.optJSONObject("remote");JSONArray tracks=remote==null?null:remote.optJSONArray("creatorTracks");if(tracks!=null)for(int i=0;i<tracks.length();i++){JSONObject t=tracks.optJSONObject(i);if(t==null)continue;Button release=button(t.optString("title")+" · "+t.optString("releaseState"));release.setEnabled("draft".equals(t.optString("releaseState")));release.setOnClickListener(v->release(t));content.addView(release);Button rights=button(t.optString("title")+" · "+getString(R.string.rights));rights.setOnClickListener(v->caseDialog(t));content.addView(rights);}JSONArray usage=remote==null?null:remote.optJSONArray("usage"),allocations=remote==null?null:remote.optJSONArray("allocations"),settlements=remote==null?null:remote.optJSONArray("settlements"),cases=remote==null?null:remote.optJSONArray("cases"),proposals=remote==null?null:remote.optJSONArray("aiProposals");content.addView(text(getString(R.string.usage_records)+": "+NumberFormat.getIntegerInstance().format(usage==null?0:usage.length()),14));content.addView(text(getString(R.string.revenue_truth),13));content.addView(text("YNX Pay: "+(settlements==null?0:settlements.length())+" · YNX Trust: "+(cases==null?0:cases.length())+" · AI: "+(proposals==null?0:proposals.length()),13));if(allocations!=null)for(int i=0;i<allocations.length();i++){JSONObject a=allocations.optJSONObject(i);Button pay=button("YNX Pay · "+a.optLong("amountMicros")+" µYNXT");pay.setOnClickListener(v->settle(a));content.addView(pay);}Button ai=button(getString(R.string.ai_enabled));ai.setEnabled(state.optBoolean("aiEnabled",true));ai.setOnClickListener(v->requestAI());content.addView(ai);content.addView(text(getString(R.string.ai_explanation),13));}
    private void requestAI(){JSONArray ids=state.optJSONArray("favorites");if(ids==null||ids.length()==0){status.setText(R.string.empty_library);return;}status.setText(R.string.loading);runAccountTask((requestApi,requestState,generation)->{try{JSONObject candidate=requestApi.createAI(ids,getSharedPreferences("settings",0).getString("aiLanguage","system"));requestApi.streamAI(candidate.getString("id"));JSONObject p=requestApi.get("/api/ai/proposals/"+candidate.getString("id"));if(!"completed".equals(p.optString("status")))throw new IOException("AI result is not complete");runAccountUI(generation,()->trackDialog(new AlertDialog.Builder(this).setTitle("YNX AI · "+p.optString("status")).setMessage(p.optString("result")+"\n\n"+getString(R.string.ai_explanation)).setNegativeButton(R.string.cancel,(d,w)->reviewAI(p,"reject",generation)).setPositiveButton(R.string.upload,(d,w)->reviewAI(p,"apply",generation)).show()));}catch(Exception e){runAccountUI(generation,()->status.setText(getString(R.string.retry)+": "+e.getMessage()));}});}
    private void reviewAI(JSONObject p,String action,long expectedGeneration){runAccountTask(expectedGeneration,(requestApi,requestState,generation)->{try{requestApi.reviewAI(p.getString("id"),action,"AI reviewed library");runAccountUI(generation,()->{status.setText(R.string.ready);refresh();});}catch(Exception e){runAccountUI(generation,()->status.setText(getString(R.string.retry)+": "+e.getMessage()));}});}
    private void release(JSONObject t){runAccountTask((requestApi,requestState,generation)->{try{requestApi.release(t.getString("id"),"published","");runAccountUI(generation,()->refresh());}catch(Exception e){runAccountUI(generation,()->status.setText(getString(R.string.retry)+": "+e.getMessage()));}});}
    private void settle(JSONObject allocation){JSONObject remote=state.optJSONObject("remote"),profile=remote==null?null:remote.optJSONObject("profile");String account=profile==null?"":profile.optString("account");runAccountTask((requestApi,requestState,generation)->{try{JSONObject intent=requestApi.settlement(allocation.getString("id"),account);String review=intent.optString("reviewUri");runAccountUI(generation,()->{status.setText(intent.optString("status"));if(review.startsWith("ynxpay://"))startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(review)));});}catch(Exception e){runAccountUI(generation,()->status.setText(getString(R.string.retry)+": "+e.getMessage()));}});}
    private void caseDialog(JSONObject track){
        if(!hasCurrentSnapshot())return;
        if(state.has("caseIntent")){status.setText(R.string.trust_pending);return;}
        final long openedGeneration=authGeneration;final String[] kinds=MusicTrustCase.ownsTrack(state,api.account(),track.optString("id"))?new String[]{"report","dispute","appeal"}:new String[]{"report","dispute"};
        LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);Spinner kind=new Spinner(this);String[] labels=kinds.length==3?new String[]{getString(R.string.trust_report),getString(R.string.trust_dispute),getString(R.string.trust_appeal)}:new String[]{getString(R.string.trust_report),getString(R.string.trust_dispute)};kind.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,labels));EditText reason=new EditText(this);reason.setHint(R.string.rights_declaration);EditText evidence=new EditText(this);evidence.setHint(R.string.rights_evidence);form.addView(kind);form.addView(reason);form.addView(evidence);
        trackDialog(new AlertDialog.Builder(this).setTitle(R.string.rights).setView(form).setNegativeButton(R.string.cancel,null).setPositiveButton(R.string.upload,(d,w)->{
            if(openedGeneration!=authGeneration||!hasCurrentSnapshot()||caseBusyGeneration==openedGeneration)return;
            try{new MusicTrustCase(api,store).stage(kinds[kind.getSelectedItemPosition()],track.optString("id"),reason.getText().toString(),evidence.getText().toString());state=store.load();retryCase(openedGeneration);}catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());}
        }).show());
    }
    private void renderPendingCase(){
        JSONObject pending=state.optJSONObject("caseIntent");final long generation=authGeneration;
        if(pending!=null){
            content.addView(text(getString(R.string.trust_pending),14));JSONObject body=pending.optJSONObject("body");if(body!=null)content.addView(text(body.optString("reason"),14));
            Button retry=button(getString(R.string.retry));retry.setEnabled(caseBusyGeneration!=generation);retry.setOnClickListener(v->retryCase(generation));content.addView(retry);
            Button pause=button(getString(R.string.trust_pause));pause.setEnabled(caseBusyGeneration!=generation);pause.setOnClickListener(v->trackDialog(new AlertDialog.Builder(this).setTitle(R.string.trust_pause).setMessage(R.string.trust_pause_confirm).setNegativeButton(R.string.cancel,null).setPositiveButton(android.R.string.ok,(d,w)->{
                if(generation!=authGeneration||caseBusyGeneration==generation)return;try{state=store.pauseCase(pending,api::assertCurrent);status.setText(R.string.trust_paused);render();}catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());}
            }).show()));content.addView(pause);
        }
        JSONArray history=state.optJSONArray("caseHistory");if(history!=null&&history.length()>0){content.addView(text(getString(R.string.trust_paused),14));for(int i=0;i<history.length();i++){final JSONObject saved=history.optJSONObject(i);if(saved==null)continue;JSONObject body=saved.optJSONObject("body");Button restore=button(getString(R.string.trust_restore)+" · "+(body==null?"":body.optString("reason")));restore.setEnabled(pending==null&&caseBusyGeneration!=generation);restore.setOnClickListener(v->{if(generation!=authGeneration||caseBusyGeneration==generation)return;try{state=store.restoreCase(saved,api::assertCurrent);render();status.setText(R.string.trust_pending);}catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());}});content.addView(restore);}}
    }
    private void retryCase(long generation){
        if(generation!=authGeneration||caseBusyGeneration==generation||!hasCurrentSnapshot())return;
        final MusicApi requestApi=api;final MusicStore selected=store;
        try{requestApi.assertCurrent();selected.requireAccount(requestApi.account());}catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());return;}
        caseBusyGeneration=generation;render();status.setText(R.string.loading);
        new Thread(()->{Exception failure=null;try{new MusicTrustCase(requestApi,selected).retry();}catch(Exception error){failure=error;}final Exception result=failure;runAccountUI(generation,()->{caseBusyGeneration=-1;state=selected.load();render();status.setText(result==null?getString(R.string.ready):getString(R.string.trust_pending)+": "+result.getMessage());if(result==null)refresh();});}).start();
    }
    @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(req==PICK_AUDIO){long expected=audioPickerGeneration;audioPickerGeneration=-1;if(expected==authGeneration&&result==RESULT_OK&&data!=null)uploadDialog(data.getData());}}
    private void uploadDialog(Uri uri){
        final long openedGeneration=authGeneration;if(uri==null||state.has("uploadIntent")||uploadBusyGeneration==openedGeneration)return;
        LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);EditText title=new EditText(this);title.setHint(R.string.track_title);EditText artist=new EditText(this);artist.setHint(R.string.artist_name);EditText evidence=new EditText(this);evidence.setHint(R.string.rights_evidence);EditText provenance=new EditText(this);provenance.setHint(R.string.provenance);for(EditText field:new EditText[]{title,artist,evidence,provenance})form.addView(field);
        uploadDialog=trackDialog(new AlertDialog.Builder(this).setTitle(R.string.rights_declaration).setView(form).setNegativeButton(R.string.cancel,null).setPositiveButton(R.string.upload,(d,w)->{
            final String name=title.getText().toString(),author=artist.getText().toString(),rights=evidence.getText().toString(),origin=provenance.getText().toString();
            if(openedGeneration!=authGeneration||uploadBusyGeneration==openedGeneration)return;uploadBusyGeneration=openedGeneration;final MusicStore selected=store;render();
            runAccountTask(openedGeneration,(requestApi,requestState,generation)->{try{MusicUpload upload=new MusicUpload(requestApi,selected);try(InputStream in=getContentResolver().openInputStream(uri)){upload.stage(in,name,author,rights,origin);}upload.retry();uploadFinished(generation,null);}catch(Exception e){uploadFinished(generation,e);}});
        }).show());
    }
    private void uploadFinished(long generation,Exception error){runAccountUI(generation,()->{uploadBusyGeneration=-1;state=store.load();status.setText(error==null?getString(R.string.uploaded_draft):getString(R.string.upload_failed)+": "+error.getMessage());render();if(error==null)refresh();});}
    private void renderPendingUpload(){
        JSONObject pending=state.optJSONObject("uploadIntent");if(pending==null)return;final long generation=authGeneration;final MusicStore selected=store;final String key=pending.optString("key");content.addView(text(pending.optString("title")+" · "+pending.optString("artist"),16));
        Button retry=button(getString(R.string.retry));retry.setEnabled(uploadBusyGeneration!=generation);retry.setOnClickListener(v->{if(generation!=authGeneration||uploadBusyGeneration==generation)return;uploadBusyGeneration=generation;render();runAccountTask(generation,(requestApi,requestState,captured)->{try{new MusicUpload(requestApi,selected).retry();uploadFinished(captured,null);}catch(Exception e){uploadFinished(captured,e);}});});content.addView(retry);
        Button cancel=button(getString(R.string.cancel_upload));cancel.setEnabled(uploadBusyGeneration!=generation);cancel.setOnClickListener(v->{if(generation!=authGeneration||uploadBusyGeneration==generation)return;uploadDialog=trackDialog(new AlertDialog.Builder(this).setMessage(R.string.cancel_upload_draft).setNegativeButton(R.string.cancel,null).setPositiveButton(R.string.cancel_upload,(d,w)->runAccountTask(generation,(requestApi,requestState,captured)->{try{new MusicUpload(requestApi,selected).cancel(key);runAccountUI(captured,()->{state=store.load();render();});}catch(Exception e){runAccountUI(captured,()->status.setText(getString(R.string.retry)+": "+e.getMessage()));}})).show());});content.addView(cancel);
    }
    private void renderSettings(){final long openedGeneration=authGeneration;heading(R.string.settings);Button display=button(DisplayPreferences.labels(getResources().getConfiguration().getLocales().get(0))[0]);display.setOnClickListener(v->DisplayPreferences.show(this,getResources().getConfiguration().getLocales().get(0),this::recreate));content.addView(display);content.addView(text(getString(R.string.language),14));Spinner locales=new Spinner(this);ArrayAdapter<String>a=new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,LocaleSupport.TAGS);locales.setAdapter(a);String current=getSharedPreferences("settings",0).getString("locale","system");locales.setSelection(Math.max(0,Arrays.asList(LocaleSupport.TAGS).indexOf(current)));locales.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){boolean first=true;public void onNothingSelected(android.widget.AdapterView<?>p){}public void onItemSelected(android.widget.AdapterView<?>p,View v,int pos,long id){if(first){first=false;return;}LocaleSupport.set(MainActivity.this,LocaleSupport.TAGS[pos]);recreate();}});content.addView(locales);content.addView(text(getString(R.string.profile),14));if(!hasCurrentSnapshot())renderSnapshotNotice();JSONObject profile=!hasCurrentSnapshot()?null:state.optJSONObject("remote").optJSONObject("profile");Switch explicit=new Switch(this);explicit.setText(R.string.explicit_content);explicit.setEnabled(hasCurrentSnapshot());explicit.setChecked(profile!=null&&profile.optBoolean("explicitAllowed"));Switch history=new Switch(this);history.setText(R.string.private_history);history.setEnabled(hasCurrentSnapshot());history.setChecked(profile==null||profile.optBoolean("privateHistory",true));CompoundButton.OnCheckedChangeListener saveProfile=(b,on)->saveProfile(explicit.isChecked(),history.isChecked());explicit.setOnCheckedChangeListener(saveProfile);history.setOnCheckedChangeListener(saveProfile);content.addView(explicit);content.addView(history);Switch ai=new Switch(this);ai.setText(R.string.ai_enabled);ai.setChecked(state.optBoolean("aiEnabled",true));ai.setEnabled(hasCurrentSnapshot());ai.setOnCheckedChangeListener((b,on)->{if(openedGeneration!=authGeneration)return;try{api.assertCurrent();state=store.commitAIEnabled(on,api::assertCurrent);}catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());render();}});content.addView(ai);content.addView(text(getString(R.string.ai_explanation),13));content.addView(text(getString(R.string.ai_output_language),14));Spinner aiLanguage=new Spinner(this);aiLanguage.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,LocaleSupport.TAGS));String aiTag=getSharedPreferences("settings",0).getString("aiLanguage","system");aiLanguage.setSelection(Math.max(0,Arrays.asList(LocaleSupport.TAGS).indexOf(aiTag)));aiLanguage.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){boolean first=true;public void onNothingSelected(android.widget.AdapterView<?>p){}public void onItemSelected(android.widget.AdapterView<?>p,View v,int pos,long id){if(first){first=false;return;}getSharedPreferences("settings",0).edit().putString("aiLanguage",LocaleSupport.TAGS[pos]).apply();}});content.addView(aiLanguage);Button signout=button(getString(R.string.sign_out));signout.setOnClickListener(v->signOut());content.addView(signout);Button clear=button(getString(R.string.clear_private_data));clear.setOnClickListener(v->trackDialog(new AlertDialog.Builder(this).setMessage(R.string.clear_confirm).setNegativeButton(R.string.cancel,null).setPositiveButton(R.string.delete,(d,w)->{if(openedGeneration!=authGeneration)return;stopService(new Intent(this,PlaybackService.class));try{store.clearCurrent();}catch(Exception e){status.setText(getString(R.string.retry)+": "+e.getMessage());return;}signOut();}).show()));content.addView(clear);}
    private void saveProfile(boolean explicit,boolean privateHistory){
        if(!hasCurrentSnapshot())return;
        final MusicStore selected=store;JSONObject current=state.optJSONObject("remote").optJSONObject("profile"),submitted=new JSONObject();
        try{submitted.put("displayName",current==null?"YNX listener":current.optString("displayName","YNX listener")).put("bio",current==null?"":current.optString("bio")).put("explicitAllowed",explicit).put("privateHistory",privateHistory);}
        catch(Exception error){status.setText(R.string.retry);return;}
        runAccountTask((requestApi,requestState,generation)->{try{JSONObject saved=requestApi.updateProfile(submitted);runAccountUI(generation,()->{try{state=selected.commitProfile(saved,requestApi::assertCurrent);render();}catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());}});}catch(Exception error){runAccountUI(generation,()->status.setText(getString(R.string.retry)+": "+error.getMessage()));}});
    }
    private AlertDialog trackDialog(AlertDialog dialog){
        accountDialogs.add(dialog);dialog.setOnDismissListener(d->{accountDialogs.remove(dialog);if(playlistDialog==dialog)playlistDialog=null;if(uploadDialog==dialog)uploadDialog=null;});return dialog;
    }
    private void dismissAccountDialogs(){for(AlertDialog dialog:new ArrayList<>(accountDialogs))dialog.dismiss();accountDialogs.clear();}
    private void retireUI(){snapshotReads.retire();authGeneration++;visibleNativeEpoch=-1;if(uploadDialog!=null)uploadDialog.dismiss();if(playlistDialog!=null)playlistDialog.dismiss();dismissAccountDialogs();audioPickerGeneration=-1;stopService(new Intent(this,PlaybackService.class));}
    private boolean signOut(){
        retireUI();final long generation=authGeneration;status.setText(R.string.loading);
        nativeBridge.disconnect((value,error)->{if(generation!=authGeneration)return;if(error!=null){status.setText(getString(R.string.retry)+": "+error.getMessage());return;}try{
            // Explicit user sign-out only. A new Native login never migrates or
            // clears the original V1 ciphertext or inherited pending request.
            SecureStore.clear(this);getSharedPreferences("auth",0).edit().clear().apply();getSharedPreferences("playback",0).edit().clear().apply();detachUI();
        }catch(RuntimeException e){status.setText(getString(R.string.retry)+": "+e.getMessage());}});return true;
    }
    private void detachUI(){MusicStore.detach(this);store=new MusicStore(this);state=store.load();api=new MusicApi(this,nativeBridge);now.setText(R.string.nothing_playing);status.setText(R.string.sign_in_wallet);render();}
    private void wallet(){
        retireUI();final long generation=authGeneration;detachUI();status.setText(R.string.loading);
        // Finish the original SDK's durable negative authority before attempting
        // a new grant. A late cancel cannot borrow a newly opened UI generation.
        nativeBridge.disconnect((value,error)->{if(generation!=authGeneration)return;if(error!=null){status.setText(getString(R.string.retry)+": "+error.getMessage());return;}
            nativeBridge.connect((launched,failure)->{if(generation!=authGeneration)return;if(failure!=null){status.setText(getString(R.string.wallet_unavailable)+": "+failure.getMessage());return;}status.setText(R.string.sign_in_wallet);});
        });
    }
    private void recover(){
        retireUI();detachUI();final long generation=authGeneration;status.setText(R.string.loading);
        nativeBridge.restore((result,error)->{if(generation!=authGeneration)return;if(error!=null){status.setText(getString(R.string.offline_mode)+": "+error.getMessage());render();return;}
            if(nativeBridge.session()==null){status.setText(R.string.sign_in_wallet);render();return;}api=new MusicApi(this,nativeBridge);refresh();
        });
    }
    private boolean handleCallback(Intent intent){
        Uri uri=intent==null?null:intent.getData();if(uri==null||!"ynxmusic".equals(uri.getScheme()))return false;
        retireUI();final long generation=authGeneration;status.setText(R.string.loading);
        // Only the actual SDK interprets the original registered callback. No
        // callback JSON or old response string becomes a local private session.
        nativeBridge.handleReturn(uri.toString(),(result,error)->{if(generation!=authGeneration)return;if(error!=null||nativeBridge.session()==null){status.setText(getString(R.string.auth_rejected)+(error==null?"":": "+error.getMessage()));return;}
            api=new MusicApi(this,nativeBridge);status.setText(R.string.authenticated);refresh();
        });return true;
    }
    private interface AccountWork{void run(MusicApi requestApi,JSONObject requestState,long generation);}
    private void runAccountTask(AccountWork work){runAccountTask(authGeneration,work);}
    private void runAccountTask(long generation,AccountWork work){
        if(generation!=authGeneration)return;final MusicApi requestApi=api;final JSONObject requestState;
        try{requestApi.assertCurrent();requestState=new JSONObject(state.toString());}catch(Exception error){status.setText(getString(R.string.retry)+": "+error.getMessage());return;}
        new Thread(()->{if(generation!=authGeneration)return;try{requestApi.assertCurrent();work.run(requestApi,requestState,generation);}catch(Exception error){runAccountUI(generation,()->status.setText(getString(R.string.retry)+": "+error.getMessage()));}}).start();
    }
    private void runAccountUI(long generation,Runnable task){runOnUiThread(()->{if(generation==authGeneration)task.run();});}
    @Override protected void onDestroy(){authGeneration++;libraryExecutor.shutdownNow();dismissAccountDialogs();nativeBridge.removeListener(nativeChanged);if(uploadDialog!=null)uploadDialog.dismiss();if(playlistDialog!=null)playlistDialog.dismiss();super.onDestroy();}
    private void heading(int id){TextView h=text(getString(id),26);h.setTextColor(BLUE);h.setTypeface(null,android.graphics.Typeface.BOLD);content.addView(h);}
    private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
}

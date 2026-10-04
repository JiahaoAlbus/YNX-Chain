package com.ynxweb4.music;

import android.app.*;
import android.content.*;
import android.media.*;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.*;
import org.json.JSONObject;
import java.io.File;

public final class PlaybackService extends Service implements MediaPlayer.OnPreparedListener, MediaPlayer.OnCompletionListener {
    public static final String PLAY="com.ynxweb4.music.PLAY",PAUSE="com.ynxweb4.music.PAUSE",SEEK="com.ynxweb4.music.SEEK";
    private NativeSessionBridge nativeBridge;private NativeSessionIdentity capturedNative;private long playbackRevision,capturedNativeEpoch;private final Runnable authorityListener=()->{if(this.player!=null&&!current()){release();stopForeground(STOP_FOREGROUND_REMOVE);}}; private MediaPlayer player; private MediaSession session; private String trackId="",title="",sessionRef=""; private final Handler timer=new Handler(Looper.getMainLooper());
    @Override public void onCreate(){super.onCreate();nativeBridge=NativeSessionBridge.acquire(this);nativeBridge.addListener(authorityListener);createChannel();session=new MediaSession(this,"YNXMusic");session.setCallback(new MediaSession.Callback(){@Override public void onPlay(){resume();}@Override public void onPause(){pause();}@Override public void onSeekTo(long p){if(player!=null)player.seekTo((int)p);}});session.setActive(true);timer.post(positionWriter);}
    @Override public int onStartCommand(Intent i,int flags,int id){if(i==null)return START_STICKY;String action=i.getAction();if(PLAY.equals(action)&&i.hasExtra("uri")){release();trackId=i.getStringExtra("trackId");title=i.getStringExtra("title");play(Uri.parse(i.getStringExtra("uri")),i.getIntExtra("position",0));}else if(PLAY.equals(action))resume();else if(PAUSE.equals(action))pause();else if(SEEK.equals(action)&&player!=null)player.seekTo(i.getIntExtra("position",0));return START_STICKY;}
    private boolean current(){return capturedNative!=null&&capturedNativeEpoch==nativeBridge.epoch()&&capturedNative.same(nativeBridge.session());}
    private void play(Uri uri,int position){
        capturedNative=nativeBridge.session();capturedNativeEpoch=nativeBridge.epoch();if(!current())return;
        try{MusicStore owned=new MusicStore(this);File permitted=owned.offline(trackId);if(!capturedNative.account.equals(owned.load().optString("account"))||!"file".equals(uri.getScheme())||!permitted.getCanonicalFile().equals(new File(uri.getPath()).getCanonicalFile())||!permitted.isFile())throw new SecurityException("Original account local audio required");
            android.content.SharedPreferences prefs=getSharedPreferences("playback",0);sessionRef=trackId.equals(prefs.getString("trackId",""))?prefs.getString("sessionRef",""):"";if(sessionRef.trim().isEmpty())sessionRef=java.util.UUID.randomUUID().toString();prefs.edit().putString("sessionRef",sessionRef).apply();
            player=new MediaPlayer();player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());player.setWakeMode(this,PowerManager.PARTIAL_WAKE_LOCK);player.setOnPreparedListener(this);player.setOnCompletionListener(this);player.setDataSource(this,uri);player.prepareAsync();startForeground(17,notification(false));prefs.edit().putInt("pendingPosition",position).apply();
        }catch(Exception error){release();stopForeground(STOP_FOREGROUND_REMOVE);}
    }
    @Override public void onPrepared(MediaPlayer p){if(p!=player||!current()){release();return;}int pos=getSharedPreferences("playback",0).getInt("pendingPosition",0);if(pos>0)p.seekTo(pos);p.start();session.setPlaybackState(state(PlaybackState.STATE_PLAYING));startForeground(17,notification(true));}
    @Override public void onCompletion(MediaPlayer p){if(p!=player||!current()){release();return;}persist(p.getDuration(),true);getSharedPreferences("playback",0).edit().putInt("position",0).remove("sessionRef").apply();if(playNext())return;session.setPlaybackState(state(PlaybackState.STATE_STOPPED));stopForeground(STOP_FOREGROUND_DETACH);sendBroadcast(new Intent("com.ynxweb4.music.COMPLETED").setPackage(getPackageName()).putExtra("trackId",trackId));}
    private boolean playNext(){try{
        if(!current())return false;JSONObject state=new MusicStore(this).load();org.json.JSONArray queue=state.optJSONArray("queue");JSONObject remote=state.optJSONObject("remote");org.json.JSONArray catalog=remote==null?null:remote.optJSONArray("catalog");if(queue==null||catalog==null||queue.length()<2)return false;
        int at=-1;for(int i=0;i<queue.length();i++)if(trackId.equals(queue.optString(i)))at=i;if(at<0||at+1>=queue.length())return false;String next=queue.optString(at+1);
        for(int i=0;i<catalog.length();i++){JSONObject track=catalog.optJSONObject(i);if(track==null||!next.equals(track.optString("id")))continue;
            final JSONObject originalTrack=track;final NativeSessionIdentity original=capturedNative;final long epoch=playbackRevision,nativeEpoch=capturedNativeEpoch;final MusicApi requestApi=new MusicApi(this,nativeBridge);
            new Thread(()->{try{File local=new MusicStore(this).offline(next);if(!local.isFile())local=requestApi.download(next);MusicApi.verifyLocal(local,originalTrack.getString("audioSha256"));requestApi.assertCurrent();final File ready=local;
                timer.post(()->{if(epoch!=playbackRevision||nativeEpoch!=nativeBridge.epoch()||!original.same(nativeBridge.session()))return;release();trackId=next;title=originalTrack.optString("title");play(Uri.fromFile(ready),0);});
            }catch(Exception failure){timer.post(()->{if(epoch==playbackRevision){release();stopForeground(STOP_FOREGROUND_REMOVE);}});}}).start();return true;
        }
    }catch(Exception ignored){}return false;}
    private void resume(){if(player!=null&&current()){playbackRevision++;player.start();session.setPlaybackState(state(PlaybackState.STATE_PLAYING));startForeground(17,notification(true));}}
    private void pause(){if(player==null)return;playbackRevision++;if(player.isPlaying())player.pause();persist(player.getCurrentPosition(),false);session.setPlaybackState(state(PlaybackState.STATE_PAUSED));startForeground(17,notification(false));}
    private PlaybackState state(int state){return new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_SEEK_TO).setState(state,player==null?0:player.getCurrentPosition(),state==PlaybackState.STATE_PLAYING?1:0).build();}
    private Notification notification(boolean playing){Intent toggle=new Intent(this,PlaybackService.class).setAction(playing?PAUSE:PLAY);PendingIntent pi=PendingIntent.getService(this,2,toggle,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);return new Notification.Builder(this,"playback").setSmallIcon(com.ynxweb4.music.R.drawable.ic_music).setContentTitle(title.trim().isEmpty()?getString(R.string.app_name):title).setContentText(getString(R.string.background_playback)).setOngoing(playing).addAction(new Notification.Action.Builder(null,playing?getString(R.string.pause):getString(R.string.play),pi).build()).setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken())).build();}
    private void createChannel(){if(Build.VERSION.SDK_INT>=26)getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("playback",getString(R.string.background_playback),NotificationManager.IMPORTANCE_LOW));}
    private final Runnable positionWriter=new Runnable(){public void run(){if(player!=null){if(!current()){release();stopForeground(STOP_FOREGROUND_REMOVE);}else if(player.isPlaying())persist(player.getCurrentPosition(),false);}timer.postDelayed(this,5000);}};
    private void persist(int position,boolean completed){
        if(trackId.trim().isEmpty()||!current())return;final NativeSessionIdentity original=capturedNative;final long nativeEpoch=capturedNativeEpoch;final MusicApi reportingApi=new MusicApi(this,nativeBridge);
        getSharedPreferences("playback",0).edit().putString("trackId",trackId).putString("sessionRef",sessionRef).putInt("position",position).apply();
        try{MusicStore store=new MusicStore(this);store.requireAccount(original.account);store.commitPlayback(trackId,position,reportingApi::assertCurrent);}catch(Exception ignored){}
        final String id=trackId,ref=sessionRef;new Thread(()->{try{if(nativeEpoch!=nativeBridge.epoch()||!original.same(nativeBridge.session()))return;reportingApi.reportPosition(id,ref,position,completed);}catch(Exception ignored){}}).start();
    }
    private void release(){playbackRevision++;if(player!=null){persist(player.getCurrentPosition(),false);player.release();player=null;}}
    @Override public void onDestroy(){timer.removeCallbacks(positionWriter);nativeBridge.removeListener(authorityListener);release();session.release();super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
}

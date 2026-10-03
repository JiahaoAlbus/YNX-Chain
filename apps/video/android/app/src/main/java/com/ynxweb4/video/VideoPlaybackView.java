package com.ynxweb4.video;

import android.content.Context;
import android.media.MediaPlayer;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.widget.FrameLayout;
import android.widget.MediaController;
import android.os.Handler;
import android.os.Looper;

final class VideoPlaybackView extends FrameLayout implements SurfaceHolder.Callback,MediaController.MediaPlayerControl {
 interface Events {void position(int positionSeconds,int observedSeconds,boolean completed);void failure(String message);}
 private final VideoApi api;private final VideoMediaSource source;private final Events events;
 private final SurfaceView surface;private final MediaController controller;
 private final Handler main=new Handler(Looper.getMainLooper());private MediaPlayer player;
 private boolean prepared,closed,lastPlaying,ended;private long lastObserved,unreportedMillis;private int lastPosition;private final int resumeSeconds;
 private final Runnable sample=new Runnable(){public void run(){if(closed)return;try{api.requireCurrent();if(prepared&&player.isPlaying())emit(false);}catch(Exception invalid){events.failure(invalid.getMessage());stopPlayback();return;}main.postDelayed(this,5000);}};
 VideoPlaybackView(Context context,VideoApi api,VideoMediaSource source,int resumeSeconds,Events events){super(context);this.api=api;this.source=source;this.events=events;this.resumeSeconds=Math.max(0,resumeSeconds);surface=new SurfaceView(context);addView(surface,new LayoutParams(-1,-1));surface.getHolder().addCallback(this);controller=new MediaController(context);controller.setMediaPlayer(this);controller.setAnchorView(this);surface.setOnTouchListener((v,event)->{if(prepared)controller.show();return true;});main.postDelayed(sample,5000);}
 @Override public void surfaceCreated(SurfaceHolder holder){if(closed||player!=null)return;try{api.requireCurrent();player=new MediaPlayer();player.setDisplay(holder);player.setDataSource(source);player.setOnPreparedListener(p->{try{if(closed||p!=player)return;api.requireCurrent();prepared=true;if(resumeSeconds>0)p.seekTo(Math.min(Math.max(0,p.getDuration()-1),resumeSeconds*1000));p.start();lastObserved=android.os.SystemClock.elapsedRealtime();lastPosition=p.getCurrentPosition();lastPlaying=true;controller.show();}catch(Exception invalid){events.failure(invalid.getMessage());stopPlayback();}});player.setOnCompletionListener(p->{if(closed||p!=player)return;try{api.requireCurrent();ended=true;emit(true);}catch(Exception invalid){events.failure(invalid.getMessage());}});player.setOnErrorListener((p,what,extra)->{if(!closed){events.failure("Original Video playback unavailable");stopPlayback();}return true;});player.prepareAsync();}catch(Exception failure){events.failure(failure.getMessage());stopPlayback();}}
 @Override public void surfaceChanged(SurfaceHolder holder,int format,int width,int height){}
 @Override public void surfaceDestroyed(SurfaceHolder holder){stopPlayback();}
 void stopPlayback(){if(closed)return;closed=true;main.removeCallbacks(sample);controller.hide();if(player!=null){if(prepared&&!ended){try{api.requireCurrent();emit(false);}catch(Exception ignored){}}player.release();player=null;}source.close();prepared=false;}
 @Override public void start(){try{api.requireCurrent();if(prepared&&!closed&&!ended){player.start();lastObserved=android.os.SystemClock.elapsedRealtime();lastPosition=player.getCurrentPosition();lastPlaying=true;}}catch(Exception invalid){stopPlayback();}}
 @Override public void pause(){if(prepared&&!closed&&!ended){try{api.requireCurrent();emit(false);player.pause();lastPlaying=false;}catch(Exception invalid){stopPlayback();}}}
 private void emit(boolean completed){long now=android.os.SystemClock.elapsedRealtime();int position=player.getCurrentPosition();if(lastPlaying)unreportedMillis+=Math.max(0,Math.min(Math.min(10000,now-lastObserved),position-lastPosition));lastObserved=now;lastPosition=position;int watched=(int)(unreportedMillis/1000);unreportedMillis%=1000;events.position(player.getCurrentPosition()/1000,watched,completed);if(completed)lastPlaying=false;}
 @Override public int getDuration(){return prepared&&!closed?player.getDuration():0;}
 @Override public int getCurrentPosition(){return prepared&&!closed?player.getCurrentPosition():0;}
 @Override public void seekTo(int position){try{api.requireCurrent();if(prepared&&!closed&&!ended){emit(false);player.seekTo(Math.max(0,position));lastPosition=Math.max(0,position);lastObserved=android.os.SystemClock.elapsedRealtime();}}catch(Exception invalid){stopPlayback();}}
 @Override public boolean isPlaying(){return prepared&&!closed&&player.isPlaying();}
 @Override public int getBufferPercentage(){return 0;}
 @Override public boolean canPause(){return true;}
 @Override public boolean canSeekBackward(){return true;}
 @Override public boolean canSeekForward(){return true;}
 @Override public int getAudioSessionId(){return player==null?0:player.getAudioSessionId();}
}

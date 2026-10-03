package com.ynxweb4.video;

import android.media.MediaDataSource;
import java.io.IOException;

// Each Range read gets a fresh SDK action proof. MediaPlayer never replays a
// one-shot request header for later ranges or after the original restore epoch.
final class VideoMediaSource extends MediaDataSource {
 private final VideoApi api;private final String path;private final long size;
 private volatile boolean closed;
 VideoMediaSource(VideoApi api,String objectKey,long size)throws Exception{api.requireCurrent();if(objectKey==null||!objectKey.matches("[A-Za-z0-9_-]+(?:/[A-Za-z0-9_.-]+)*")||objectKey.contains("..")||size<1||size>2L*1024*1024*1024)throw new SecurityException("Original video object required");this.api=api;this.path="/media/"+objectKey;this.size=size;}
 @Override public synchronized int readAt(long position,byte[] target,int offset,int count)throws IOException{
  try{if(closed)throw new IOException("Original Video playback closed");api.requireCurrent();if(position<0||offset<0||count<0||offset>target.length-count)throw new IOException("Invalid media buffer");if(count==0)return 0;if(position>=size)return -1;byte[] bytes=api.range(path,position,Math.min(count,262144),size);if(closed)throw new IOException("Original Video playback closed");api.requireCurrent();System.arraycopy(bytes,0,target,offset,bytes.length);return bytes.length;}catch(Exception failure){throw new IOException("Original Video media unavailable",failure);}
 }
 @Override public long getSize()throws IOException{try{if(closed)throw new IOException("Original Video playback closed");api.requireCurrent();return size;}catch(Exception failure){throw new IOException("Original Video playback retired",failure);}}
 @Override public void close(){closed=true;}
}

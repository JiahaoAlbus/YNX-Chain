package com.ynxweb4.music;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;

final class MusicStore {
    private final Context c;
    MusicStore(Context c){this.c=c;}
    JSONObject load(){try{File f=new File(c.getFilesDir(),"music-state.json");if(!f.exists())return fresh();byte[] b;try(FileInputStream in=new FileInputStream(f)){b=in.readAllBytes();}JSONObject s=new JSONObject(new String(b,java.nio.charset.StandardCharsets.UTF_8));if(s.optInt("version")!=1)throw new Exception("version");return s;}catch(Exception e){JSONObject s=fresh();try{s.put("recoveryWarning",true);}catch(Exception ignored){}return s;}}
    void save(JSONObject s)throws Exception{File f=new File(c.getFilesDir(),"music-state.json"),t=new File(c.getFilesDir(),"music-state.tmp");try(FileOutputStream out=new FileOutputStream(t)){out.write(s.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));out.getFD().sync();}if(!t.renameTo(f))throw new Exception("atomic state replace failed");}
    File offline(String trackId){return new File(c.getFilesDir(),"offline/"+trackId+".wav");}
    private JSONObject fresh(){JSONObject s=new JSONObject();try{s.put("version",1);s.put("favorites",new JSONArray());s.put("queue",new JSONArray());s.put("playlists",new JSONArray());s.put("downloads",new JSONObject());s.put("position",0);s.put("trackId","");s.put("locale","");s.put("aiEnabled",true);s.put("aiOutputLanguage","system");}catch(Exception ignored){}return s;}
}

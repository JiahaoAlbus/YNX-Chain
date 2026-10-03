package com.ynxweb4.music;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class MusicStore {
    private static final Object WRITE_LOCK=new Object();
    private final Context c;
    private final String account;
    private final File directory;
    private boolean recoveryBlocked;
    MusicStore(Context c){this(c,c.getSharedPreferences("music-identity",0).getString("account",""));}
    private MusicStore(Context c,String account){this.c=c;this.account=account;directory=new File(c.getFilesDir(),"music-accounts/"+partition(account));}
    // Call only with the account returned by the authenticated /api/me read.
    static MusicStore selectAccount(Context c,String account)throws Exception{synchronized(WRITE_LOCK){
        if(!account.matches("ynx1[0-9a-z]{20,80}"))throw new IOException("Invalid verified Music account");
        MusicStore selected=new MusicStore(c,account);
        if(!c.getSharedPreferences("music-identity",0).edit().putString("account",account).commit()||!account.equals(c.getSharedPreferences("music-identity",0).getString("account","")))throw new IOException("Original Music account selection is unconfirmed");
        File target=selected.file(),legacy=new File(c.getFilesDir(),"music-state.json");
        if(!target.exists()&&!new File(selected.directory,"legacy-migration-disabled").exists()&&legacy.isFile()){
            try{JSONObject old=read(legacy),remote=old.optJSONObject("remote"),profile=remote==null?null:remote.optJSONObject("profile");
            // Unattributed legacy caches stay untouched; they are never assigned to a new account.
            if(profile!=null&&account.equals(profile.optString("account"))&&(!old.has("account")||account.equals(old.optString("account")))){selected.save(old);selected.retainVerifiedOffline(remote);}}catch(Exception migrationFailure){JSONObject fresh=selected.fresh();fresh.put("recoveryWarning",true);selected.save(fresh);}
        }
        return selected;
    }}
    static void detach(Context c){synchronized(WRITE_LOCK){c.getSharedPreferences("music-identity",0).edit().remove("account").commit();}}
    JSONObject load(){synchronized(WRITE_LOCK){if(account.isEmpty())return fresh();try{File f=file();if(!f.exists())return fresh();JSONObject s=read(f);if(s.optInt("version")!=1||!account.equals(s.optString("account")))throw new IOException("account binding");return s;}catch(Exception e){
        JSONObject s=fresh();try{File original=file();if(original.exists()){File retained=new File(directory,"music-state.recovery-"+java.util.UUID.randomUUID()+".json");try(InputStream in=new FileInputStream(original);FileOutputStream out=new FileOutputStream(retained)){MusicIO.copy(in,out,8L*1024*1024,null);out.getFD().sync();}}recoveryBlocked=false;s.put("recoveryWarning",true);}catch(Exception preservationFailure){recoveryBlocked=true;try{s.put("recoveryWarning",true);}catch(Exception ignored){}}return s;
    }}}
    void save(JSONObject s)throws Exception{synchronized(WRITE_LOCK){
        if(account.isEmpty()||!account.equals(c.getSharedPreferences("music-identity",0).getString("account","")))throw new IOException("Music account changed");
        if(recoveryBlocked)throw new IOException("Original damaged Music state must be preserved before replacement");
        if(s.has("account")&&!account.equals(s.optString("account")))throw new IOException("Music cache belongs to another account");
        JSONObject output=new JSONObject(s.toString());output.put("account",account);
        if(!directory.exists()&&!directory.mkdirs())throw new IOException("private directory unavailable");
        File f=file(),t=new File(directory,"music-state.tmp");try(FileOutputStream out=new FileOutputStream(t)){out.write(output.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}if(!t.renameTo(f))throw new IOException("atomic state replace failed");
    }}
    File offline(String trackId){if(!trackId.matches("[A-Za-z0-9_-]{1,128}"))throw new IllegalArgumentException("Invalid Music track");return new File(directory,"offline/"+trackId+".wav");}
    void requireAccount(String expected)throws IOException{synchronized(WRITE_LOCK){if(account.isEmpty()||!account.equals(expected)||!account.equals(c.getSharedPreferences("music-identity",0).getString("account","")))throw new IOException("Original upload account changed");}}
    void updateUpload(JSONObject intent,JSONObject snapshot,boolean acknowledge)throws Exception{synchronized(WRITE_LOCK){
        requireAccount(account);JSONObject current=load(),pending=current.optJSONObject("uploadIntent");
        if(!acknowledge){if(pending!=null)throw new IOException("Original pending upload already exists");current.put("uploadIntent",new JSONObject(intent.toString()));}
        else{if(pending==null||!NativeProductState.canonical(pending).equals(NativeProductState.canonical(intent)))throw new IOException("Original upload intent changed");current.remove("uploadIntent");if(snapshot!=null)current.put("remote",snapshot);}
        save(current);
    }}
    File uploadFile(String key)throws IOException {
        requireAccount(account);if(!key.matches("music-upload-[A-Fa-f0-9-]{36}"))throw new IOException("Invalid original upload key");return new File(directory,"upload-drafts/"+key+".wav");
    }
    String stageUpload(InputStream selected,String key,MusicIO.Guard guard)throws Exception{synchronized(WRITE_LOCK){
        requireAccount(account);File target=uploadFile(key);if(target.exists())throw new IOException("Original staged upload already exists");
        if(!target.getParentFile().exists()&&!target.getParentFile().mkdirs())throw new IOException("Original upload draft directory unavailable");File temp=File.createTempFile("upload-",".tmp",target.getParentFile());boolean saved=false;
        try{try(FileOutputStream out=new FileOutputStream(temp)){MusicIO.copy(selected,out,50L*1024*1024,guard);out.getFD().sync();}String hash=MusicApi.fileDigest(temp);MusicApi.verifyLocal(temp,hash);guard.check();requireAccount(account);if(!temp.renameTo(target))throw new IOException("Original upload staging is unconfirmed");saved=true;return hash;}finally{if(!saved)temp.delete();}
    }}
    void clearCurrent()throws Exception{synchronized(WRITE_LOCK){
        if(account.isEmpty())return;
        requireAccount(account);
        if(!directory.exists()&&!directory.mkdirs())throw new IOException("Private Music directory unavailable");
        try(FileOutputStream marker=new FileOutputStream(new File(directory,"legacy-migration-disabled"))){marker.write(1);marker.getFD().sync();}
        File offline=new File(directory,"offline");File[] files=offline.listFiles();
        if(files!=null)for(File f:files)if(f.getName().matches("[A-Za-z0-9_-]{1,128}\\.wav")&&f.isFile()&&!java.nio.file.Files.isSymbolicLink(f.toPath())&&!f.delete())throw new IOException("Offline deletion failed");
        File[] drafts=new File(directory,"upload-drafts").listFiles();if(drafts!=null)for(File f:drafts)if(f.getName().matches("music-upload-[A-Fa-f0-9-]{36}\\.wav")&&f.isFile()&&!java.nio.file.Files.isSymbolicLink(f.toPath())&&!f.delete())throw new IOException("Upload draft deletion failed");
        for(String name:new String[]{"music-state.json","music-state.tmp"}){File f=new File(directory,name);if(f.exists()&&!java.nio.file.Files.isSymbolicLink(f.toPath())&&!f.delete())throw new IOException("Music state deletion failed");}
    }}
    private void retainVerifiedOffline(JSONObject remote)throws Exception{
        JSONArray tracks=remote.optJSONArray("catalog");if(tracks==null)return;
        for(int i=0;i<tracks.length();i++){
            JSONObject track=tracks.optJSONObject(i);if(track==null)continue;
            String id=track.optString("id"),expected=track.optString("audioSha256");
            if(!id.matches("[A-Za-z0-9_-]{1,128}")||!expected.matches("[0-9a-f]{64}"))continue;
            File legacy=new File(c.getFilesDir(),"offline/"+id+".wav"),target=offline(id);
            if(!legacy.isFile()||target.exists()||java.nio.file.Files.isSymbolicLink(legacy.toPath()))continue;
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            try(FileInputStream in=new FileInputStream(legacy)){byte[] b=new byte[32768];for(int n;(n=in.read(b))!=-1;)digest.update(b,0,n);}
            StringBuilder actual=new StringBuilder();for(byte b:digest.digest())actual.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
            if(!expected.equals(actual.toString()))continue;
            if(!target.getParentFile().exists()&&!target.getParentFile().mkdirs())throw new IOException("Offline migration unavailable");
            File temp=new File(target+".tmp");try(FileInputStream in=new FileInputStream(legacy);FileOutputStream out=new FileOutputStream(temp)){MusicIO.copy(in,out,64L*1024*1024,null);out.getFD().sync();}
            if(!temp.renameTo(target))throw new IOException("Offline migration replace failed");
        }
    }
    private File file(){return new File(directory,"music-state.json");}
    private static JSONObject read(File f)throws Exception{try(FileInputStream in=new FileInputStream(f)){return new JSONObject(new String(MusicIO.bounded(in,8*1024*1024),StandardCharsets.UTF_8));}}
    private static String partition(String value){if(value.isEmpty())return "disconnected";try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder result=new StringBuilder();for(byte b:bytes)result.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return result.toString();}catch(Exception e){throw new IllegalStateException(e);}}
    private JSONObject fresh(){JSONObject s=new JSONObject();try{s.put("version",1);s.put("account",account);s.put("favorites",new JSONArray());s.put("queue",new JSONArray());s.put("playlists",new JSONArray());s.put("downloads",new JSONObject());s.put("position",0);s.put("trackId","");s.put("locale","");s.put("aiEnabled",true);s.put("aiOutputLanguage","system");}catch(Exception ignored){}return s;}
}

package com.ynxweb4.music;
import android.content.Context;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.json.*;
public final class NativeStoreCheck {
    static void check(boolean ok,String description){if(!ok)throw new AssertionError(description);}
    static String account(char c){return "ynx1"+String.valueOf(c).repeat(38);}
    public static void main(String[] args)throws Exception{
        Path directory=Files.createTempDirectory("ynx-music-owned-native-store-");Context context=new Context(directory.toFile());
        String a=account('a'),b=account('b');
        byte[] wave=new byte[44];System.arraycopy("RIFF".getBytes(),0,wave,0,4);System.arraycopy("WAVE".getBytes(),0,wave,8,4);
        String sha=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(wave));
        JSONObject legacy=new JSONObject().put("version",1).put("favorites",new JSONArray().put("track_owned")).put("queue",new JSONArray().put("track_owned")).put("remote",new JSONObject().put("profile",new JSONObject().put("account",a)).put("catalog",new JSONArray().put(new JSONObject().put("id","track_owned").put("audioSha256",sha))));
        Path old=directory.resolve("music-state.json");Files.writeString(old,legacy.toString());byte[] oldBytes=Files.readAllBytes(old);Files.createDirectories(directory.resolve("offline"));Files.write(directory.resolve("offline/track_owned.wav"),wave);
        MusicStore ownerA=MusicStore.selectAccount(context,a);JSONObject stateA=ownerA.load();
        check(a.equals(stateA.getString("account")),"verified legacy account migration");check(stateA.getJSONArray("favorites").length()==1,"old favorites retained");check(java.util.Arrays.equals(Files.readAllBytes(ownerA.offline("track_owned").toPath()),wave),"verified offline bytes retained");
        MusicStore ownerB=MusicStore.selectAccount(context,b);check(ownerB.load().getJSONArray("favorites").length()==0,"B never sees A favorites");check(!ownerB.offline("track_owned").exists(),"B never sees A offline audio");
        boolean rejected=false;try{ownerA.save(stateA);}catch(java.io.IOException expected){rejected=true;}check(rejected,"old worker cannot save after switching accounts");
        JSONObject stateB=ownerB.load();stateB.put("favorites",new JSONArray().put("track_b"));ownerB.save(stateB);
        rejected=false;try{ownerB.save(stateA);}catch(java.io.IOException expected){rejected=true;}check(rejected,"old account cache cannot be rewritten as B");
        ownerA=MusicStore.selectAccount(context,a);check(ownerA.load().getJSONArray("favorites").getString(0).equals("track_owned"),"returning A restores A records");
        MusicStore.detach(context);rejected=false;try{ownerA.save(ownerA.load());}catch(java.io.IOException expected){rejected=true;}check(rejected,"detached worker cannot save");check(new MusicStore(context).load().getJSONArray("favorites").length()==0,"detached state hides private data");
        ownerB=MusicStore.selectAccount(context,b);ownerB.clearCurrent();check(MusicStore.selectAccount(context,a).load().getJSONArray("favorites").length()==1,"explicit B clear retains A data");
        ownerA=MusicStore.selectAccount(context,a);ownerA.clearCurrent();check(!ownerA.offline("track_owned").exists(),"explicit clear removes this account offline file");check(MusicStore.selectAccount(context,a).load().getJSONArray("favorites").length()==0,"explicit clear cannot remigrate deleted legacy cache");
        check(java.util.Arrays.equals(oldBytes,Files.readAllBytes(old)),"original legacy file unchanged");check(Files.exists(directory.resolve("offline/track_owned.wav")),"original legacy offline file unchanged");
        rejected=false;try{ownerA.offline("../other");}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"offline path traversal rejected");
        Path statePath=ownerA.offline("bound").toPath().getParent().getParent().resolve("music-state.json");byte[] damaged="original-damaged-private-state".getBytes(java.nio.charset.StandardCharsets.UTF_8);Files.write(statePath,damaged);JSONObject recoveredState=ownerA.load();check(recoveredState.optBoolean("recoveryWarning"),"damaged state was exposed");ownerA.save(recoveredState);
        try(java.util.stream.Stream<Path> retained=Files.list(statePath.getParent())){Path recovery=retained.filter(p->p.getFileName().toString().startsWith("music-state.recovery-")).findFirst().orElseThrow();check(java.util.Arrays.equals(Files.readAllBytes(recovery),damaged),"damaged source overwritten without retained copy");}
        byte[] oversized=new byte[9*1024*1024];Files.write(statePath,oversized);JSONObject held=ownerA.load();rejected=false;try{ownerA.save(held);}catch(java.io.IOException expected){rejected=true;}check(rejected&&Files.size(statePath)==oversized.length,"unpreserved original state was overwritten");
        System.out.println("PASS: verified legacy preservation, two-account state/offline isolation, stale worker rejection, detach, scoped clear and path binding; host fixture only");
    }
}

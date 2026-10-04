package android.content;
import java.io.File;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
// Isolated ordinary files only. Recreated JVMs read actual persisted bytes;
// this is not Android SharedPreferences, keystore or OS custody evidence.
public final class Context {
 private final Path directory;
 public Context(File directory)throws Exception{this.directory=directory.toPath();Files.createDirectories(this.directory);}
 public Preferences getSharedPreferences(String name,int mode){if(!name.matches("ynx_video_viewer_v2_[0-9a-f]{64}"))throw new SecurityException("Only original ordinary viewer namespace allowed");return new Preferences(directory.resolve(name+".json"));}
 public static final class Preferences {
  private final Path path;Preferences(Path path){this.path=path;}
  private JSONObject read(){try{if(!Files.exists(path))return new JSONObject();byte[] raw=Files.readAllBytes(path);if(raw.length>1024*1024)throw new SecurityException("Bounded original ordinary cache required");return new JSONObject(new String(raw,StandardCharsets.UTF_8));}catch(Exception failure){throw new IllegalStateException("Original ordinary file unavailable; preserve bytes",failure);}}
  public String getString(String key,String fallback){JSONObject saved=read();return saved.has(key)?saved.getString(key):fallback;}
  public Editor edit(){return new Editor();}
  public final class Editor {
   private String key,value;private boolean remove;
   public Editor putString(String key,String value){this.key=key;this.value=value;return this;}
   public Editor remove(String key){this.key=key;remove=true;return this;}
   public boolean commit(){Path temporary=null;try{JSONObject saved=read();if(remove)saved.remove(key);else saved.put(key,value);temporary=Files.createTempFile(path.getParent(),"ordinary-viewer-",".tmp");Files.writeString(temporary,saved.toString(),StandardCharsets.UTF_8);Files.move(temporary,path,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);return true;}catch(Exception failure){return false;}finally{if(temporary!=null)try{Files.deleteIfExists(temporary);}catch(Exception ignored){}}}
  }
 }
}

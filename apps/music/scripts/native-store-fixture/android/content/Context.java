package android.content;
import java.io.File;
import java.util.HashMap;
import java.util.Map;
// Host fixture for Android's private file/preferences boundary. No device or user data is used.
public final class Context {
    private final File files;
    private final Map<String,Preferences> prefs=new HashMap<>();
    public Context(File files){this.files=files;}
    public File getFilesDir(){return files;}
    public Preferences getSharedPreferences(String name,int mode){return prefs.computeIfAbsent(name,key->new Preferences());}
    public static final class Preferences {
        private final Map<String,String> values=new HashMap<>();
        public String getString(String key,String fallback){return values.getOrDefault(key,fallback);}
        public Editor edit(){return new Editor();}
        public final class Editor {
            public Editor putString(String key,String value){values.put(key,value);return this;}
            public Editor remove(String key){values.remove(key);return this;}
            public boolean commit(){return true;}
        }
    }
}

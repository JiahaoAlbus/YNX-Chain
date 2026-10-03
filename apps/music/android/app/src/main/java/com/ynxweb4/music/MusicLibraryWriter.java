package com.ynxweb4.music;

import org.json.JSONObject;
import java.util.concurrent.Executor;

// Preserve the UI's original library edit order and values. Session authority
// remains in MusicApi; retired queued work never prepares a new request.
final class MusicLibraryWriter {
    interface Completion {void complete(boolean acknowledged,Exception failure);}
    private final Executor executor;
    MusicLibraryWriter(Executor executor){this.executor=executor;}
    void submit(MusicApi api,MusicStore store,JSONObject state,MusicIO.Guard current,Completion completion)throws Exception {
        current.check();api.assertCurrent();store.requireAccount(api.account());
        final JSONObject captured=new JSONObject(state.getJSONObject("libraryIntent").toString());
        executor.execute(()->{
            Exception failure=null;boolean acknowledged=false;
            try{
                current.check();api.assertCurrent();
                if(store.libraryPending(captured)){
                    JSONObject returned=api.saveLibrary(captured.getJSONArray("favorites"),captured.getJSONArray("queue"),captured.getJSONObject("downloads"));
                    if(!MusicStore.libraryMatches(captured,returned))throw new java.io.IOException("Original library confirmation differs");
                    current.check();api.assertCurrent();acknowledged=store.acknowledgeLibrary(captured,()->{current.check();api.assertCurrent();});
                }
            }catch(Exception error){failure=error;}
            completion.complete(acknowledged,failure);
        });
    }
}

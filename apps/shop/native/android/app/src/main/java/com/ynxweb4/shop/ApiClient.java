package com.ynxweb4.shop;

import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class ApiClient {
    interface Callback { void done(JSONObject value, Exception error); }
    private final ExecutorService executor=Executors.newFixedThreadPool(3);
    private final Handler main=new Handler(Looper.getMainLooper());
    private final SecureStore secure;
    private volatile boolean closed;
    private Runnable sessionRejected=()->{};
    void onSessionRejected(Runnable listener){sessionRejected=listener;}
    private void observeResponse(String method,String path,ProductSession expected,Response response)throws Exception{
        if(!rejectsSession(method,path,expected,response.status))return;
        try{secure.rejectSession(expected);}finally{main.post(()->{if(!closed)sessionRejected.run();});}
    }
    static boolean rejectsSession(String method,String path,ProductSession expected,int status){return status==401&&expected!=null&&!publicRoute(method,path);}
    private static boolean publicRoute(String method,String path){return path.startsWith("/auth/")||(method.equals("GET")&&(path.equals("/capabilities")||path.equals("/products")||path.startsWith("/products/")||path.startsWith("/stores/")));}
    ApiClient(SecureStore secure){this.secure=secure;}
    ProductSession session()throws Exception{secure.privacy();return ProductSession.parse(secure.get("commerce_session"),Instant.now());}
    PrivacyLifecycle privacy()throws Exception{return secure.privacy();}
    void requireWritable()throws Exception{ProductSession current=session();if(current!=null)PrivacyLifecycle.requireWritable(secure,current.account);}
    private boolean current(ProductSession expected)throws Exception{if(closed)return false;ProductSession actual=session();return expected==null?actual==null:expected.same(actual);}
    private boolean context(ProductSession expected,long generation)throws Exception{return current(expected)&&(expected==null||privacy().current(expected.account,generation));}
    private static boolean businessMutation(String method,String path){return !method.equals("GET")&&!method.equals("HEAD")&&!path.startsWith("/auth/");}
    private PrivacyLifecycle.Ticket admit(String method,String path,JSONObject body,ProductSession expected)throws Exception{
        if(!businessMutation(method,path))return null;
        if(path.equals("/privacy/delete"))throw new SecurityException("Use the durable deletion lifecycle");
        if(expected==null)throw new SecurityException("Connect Wallet for an active Shop session");
        return privacy().admit(expected.account,method,path,body);
    }
    void request(String method,String path,JSONObject body,Callback callback){request(method,path,body,()->true,callback);}
    void request(String method,String path,JSONObject body,ContextCheck presentation,Callback callback){
        final ProductSession expected;final JSONObject frozen;final PrivacyLifecycle.Ticket ticket;final long generation;
        try{expected=session();frozen=body==null?null:new JSONObject(body.toString());ticket=admit(method,path,frozen,expected);generation=expected==null?0:privacy().generation(expected.account);}
        catch(Exception error){callback.done(null,error);return;}
        try{executor.execute(()->{
            JSONObject value=null;Exception error=null;
            try{value=executeTracked(privacy(),ticket,()->current(expected)&&presentation.current()&&(ticket==null||privacy().current(ticket.account,ticket.generation)),()->network(method,path,frozen,expected),response->observeResponse(method,path,expected,response));}catch(Exception failure){error=failure;}
            final JSONObject result=value;final Exception failure=error;
            main.post(()->{try{if(context(expected,generation)&&presentation.current())callback.done(result,failure);}catch(Exception ignored){}});
        });}catch(Exception error){try{privacy().notSent(ticket);}catch(Exception storage){error.addSuppressed(storage);}if(!closed)callback.done(null,error);}
    }
    JSONObject requestSync(String method,String path,JSONObject body)throws Exception{return requestForSession(method,path,body,session());}
    JSONObject requestForAccount(String method,String path,JSONObject body,String account)throws Exception{
        ProductSession expected=session();if(expected==null||!expected.account.equals(account))throw new SecurityException("Queued request belongs to a different or expired account");return requestForSession(method,path,body,expected);
    }
    JSONObject requestForSession(String method,String path,JSONObject body,ProductSession expected)throws Exception{
        JSONObject frozen=body==null?null:new JSONObject(body.toString());PrivacyLifecycle.Ticket ticket=admit(method,path,frozen,expected);return execute(method,path,frozen,expected,ticket);
    }
    JSONObject requestForSession(String method,String path,JSONObject body,ProductSession expected,long generation)throws Exception{
        if(expected==null)throw new SecurityException("Active Shop account required");
        JSONObject frozen=body==null?null:new JSONObject(body.toString());
        PrivacyLifecycle.Ticket ticket=privacy().admit(expected.account,method,path,frozen,generation);return execute(method,path,frozen,expected,ticket);
    }
    private JSONObject execute(String method,String path,JSONObject body,ProductSession expected,PrivacyLifecycle.Ticket ticket)throws Exception{
        return executeTracked(privacy(),ticket,()->current(expected)&&(ticket==null||privacy().current(ticket.account,ticket.generation)),()->network(method,path,body,expected),response->observeResponse(method,path,expected,response));
    }
    interface ContextCheck { boolean current() throws Exception; }
    interface NetworkCall { Response send() throws Exception; }
    // The production network path uses this seam; JVM tests can drive genuine
    // admission/dispatch/result ordering without pretending to exercise Android.
    interface ResponseObserver { void received(Response response)throws Exception; }
    static JSONObject executeTracked(PrivacyLifecycle lifecycle,PrivacyLifecycle.Ticket ticket,ContextCheck context,NetworkCall network)throws Exception{return executeTracked(lifecycle,ticket,context,network,response->{});}
    static JSONObject executeTracked(PrivacyLifecycle lifecycle,PrivacyLifecycle.Ticket ticket,ContextCheck context,NetworkCall network,ResponseObserver observer)throws Exception{
        boolean dispatched=false,recorded=false;
        try{
            if(!context.current()){lifecycle.notSent(ticket);throw new SecurityException("Product session changed");}
            if(ticket!=null){lifecycle.dispatch(ticket);dispatched=true;}
            Response response=network.send();
            // Record the authoritative response even when the Activity was
            // destroyed or the current account changed while HTTP was running.
            try{if(ticket!=null){lifecycle.outcome(ticket,definitive(response.status));recorded=true;}}finally{observer.received(response);}
            if(!context.current())throw new SecurityException("Product session changed");
            if(response.status<200||response.status>=300)throw new ApiException(response.status,response.value.optString("error","Request failed "+response.status));
            return response.value;
        }catch(Exception error){
            if(ticket!=null&&!recorded)try{if(dispatched)lifecycle.outcome(ticket,false);else lifecycle.notSent(ticket);}catch(Exception storage){error.addSuppressed(storage);}
            throw error;
        }
    }
    private static boolean definitive(int status){return status>=200&&status<500&&status!=408;}
    void deleteBuyerData(ProductSession expected,boolean retry,Callback callback){
        try{if(expected==null||!current(expected))throw new SecurityException("Active Shop account required");if(!retry)privacy().begin(expected.account);}
        catch(Exception error){main.post(()->callback.done(null,error));return;}
        // This worker never blocks the main thread and remains able to save a
        // receipt after Activity teardown. Restart recovery uses the same ID.
        new Thread(()->{
            JSONObject request=null,result=null;Exception failure=null;
            try{
                long deadline=System.nanoTime()+25_000_000_000L;
                do{request=privacy().plan(expected.account);if(request!=null)break;if(System.nanoTime()>=deadline)throw new PrivacyLifecycle.Blocked(PrivacyLifecycle.DRAINING);privacy().waitForChanges(100);}while(true);
                if(!current(expected))throw new SecurityException("Product session changed before deletion was sent");
                Response response=network("POST","/privacy/delete",request,expected);
                if(response.status>=200&&response.status<300){privacy().confirm(expected.account,request,response.value);result=response.value;}
                else{
                    if(!retry&&definitive(response.status))privacy().rejected(expected.account,request);else privacy().markUnknown(expected.account,request);
                    observeResponse("POST","/privacy/delete",expected,response);
                    throw new ApiException(response.status,response.value.optString("error","Deletion was not confirmed"));
                }
            }catch(Exception error){failure=error;if(request!=null)try{privacy().markUnknown(expected.account,request);}catch(Exception storage){error.addSuppressed(storage);}}
            final JSONObject value=result;final Exception error=failure;
            main.post(()->{try{if(current(expected))callback.done(value,error);}catch(Exception ignored){}});
        },"shop-privacy-delete").start();
    }
    static final class Response{final int status;final JSONObject value;Response(int status,JSONObject value){this.status=status;this.value=value;}}
    private Response network(String method,String path,JSONObject body,ProductSession expected)throws Exception{
        boolean publicRoute=publicRoute(method,path);
        if(!publicRoute&&expected==null)throw new SecurityException("Connect Wallet for an active Shop session");
        URL url=new URL(BuildConfig.API_BASE_URL+"/api"+path);if(!url.getProtocol().equals("https")&&!BuildConfig.DEBUG)throw new SecurityException("release API requires HTTPS");
        HttpURLConnection connection=(HttpURLConnection)url.openConnection();
        try{
            connection.setConnectTimeout(8000);connection.setReadTimeout(12000);connection.setRequestMethod(method);connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Content-Type","application/json");
            if(expected!=null)connection.setRequestProperty("Authorization","Bearer "+expected.token);
            if(body!=null){connection.setDoOutput(true);try(OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=connection.getResponseCode();
            try{String text=read(status>=200&&status<300?connection.getInputStream():connection.getErrorStream());return new Response(status,text.isEmpty()?new JSONObject():new JSONObject(text));}
            catch(Exception malformed){if(status==401)return new Response(status,new JSONObject().put("error","Shop session rejected"));throw malformed;}
        }finally{connection.disconnect();}
    }
    void close(){closed=true;executor.shutdownNow();main.removeCallbacksAndMessages(null);}
    private static String read(InputStream input)throws IOException{
        if(input==null)return "";try(input;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int count,total=0;while((count=input.read(buffer))!=-1){total+=count;if(total>1_048_576)throw new IOException("response exceeds limit");out.write(buffer,0,count);}return out.toString(StandardCharsets.UTF_8);
        }
    }
    static final class ApiException extends IOException{final int status;ApiException(int status,String message){super(message);this.status=status;}}
}

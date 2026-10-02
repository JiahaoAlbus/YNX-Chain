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
    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SecureStore secure;
    ApiClient(SecureStore secure) { this.secure = secure; }
    ProductSession session() throws Exception { return ProductSession.parse(secure.get("commerce_session"),Instant.now()); }
    private boolean current(ProductSession expected) throws Exception { ProductSession actual=session();return expected==null?actual==null:expected.same(actual); }
    void request(String method,String path,JSONObject body,Callback callback) {
        final ProductSession expected;
        final JSONObject frozenBody;
        try{expected=session();frozenBody=body==null?null:new JSONObject(body.toString());}
        catch(Exception error){callback.done(null,error);return;}
        executor.execute(()->{
            JSONObject value=null;Exception error=null;
            try{value=requestSync(method,path,frozenBody,expected);}catch(Exception failure){error=failure;}
            final JSONObject result=value;final Exception failure=error;
            // Deliver on the UI thread, with a final context check immediately
            // before the caller can render an order, profile or privacy export.
            main.post(()->{try{if(current(expected))callback.done(result,failure);}catch(Exception ignored){}});
        });
    }
    JSONObject requestSync(String method,String path,JSONObject body) throws Exception {return requestSync(method,path,body,session());}
    JSONObject requestForAccount(String method,String path,JSONObject body,String account) throws Exception {
        ProductSession expected=session();
        if(expected==null||!expected.account.equals(account))throw new SecurityException("Queued request belongs to a different or expired account");
        return requestSync(method,path,body,expected);
    }
    private JSONObject requestSync(String method,String path,JSONObject body,ProductSession expected) throws Exception {
        if(!current(expected))throw new SecurityException("Product session changed");
        boolean publicRoute=path.startsWith("/auth/")||path.equals("/capabilities")||path.startsWith("/products")||path.startsWith("/stores/");
        if(!publicRoute&&expected==null)throw new SecurityException("Connect Wallet for an active Shop session");
        URL url=new URL(BuildConfig.API_BASE_URL+"/api"+path);
        if(!url.getProtocol().equals("https")&&!BuildConfig.DEBUG)throw new SecurityException("release API requires HTTPS");
        HttpURLConnection connection=(HttpURLConnection)url.openConnection();
        try{
            connection.setConnectTimeout(8000);connection.setReadTimeout(12000);connection.setRequestMethod(method);
            connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Content-Type","application/json");
            if(expected!=null)connection.setRequestProperty("Authorization","Bearer "+expected.token);
            if(body!=null){connection.setDoOutput(true);try(OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=connection.getResponseCode();
            String text=read(status>=200&&status<300?connection.getInputStream():connection.getErrorStream());
            JSONObject value=text.isEmpty()?new JSONObject():new JSONObject(text);
            if(!current(expected))throw new SecurityException("Product session changed");
            if(status<200||status>=300)throw new ApiException(status,value.optString("error","Request failed "+status));
            return value;
        }finally{connection.disconnect();}
    }
    void close(){executor.shutdownNow();main.removeCallbacksAndMessages(null);}
    private static String read(InputStream input) throws IOException {
        if(input==null)return "";
        try(input;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int count,total=0;
            while((count=input.read(buffer))!=-1){total+=count;if(total>1_048_576)throw new IOException("response exceeds limit");out.write(buffer,0,count);}
            return out.toString(StandardCharsets.UTF_8);
        }
    }
    static final class ApiException extends IOException {final int status;ApiException(int status,String message){super(message);this.status=status;}}
}

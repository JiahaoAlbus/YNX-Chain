package com.ynxweb4.shop;

import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class ApiClient {
    interface Callback { void done(JSONObject value, Exception error); }
    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final SecureStore secure;

    ApiClient(SecureStore secure) { this.secure = secure; }

    void request(String method, String path, JSONObject body, Callback callback) {
        executor.execute(() -> {
            try { callback.done(requestSync(method, path, body), null); }
            catch (Exception error) { callback.done(null, error); }
        });
    }

    JSONObject requestSync(String method, String path, JSONObject body) throws Exception {
        URL url = new URL(BuildConfig.API_BASE_URL + "/api" + path);
        if (!url.getProtocol().equals("https") && !BuildConfig.DEBUG && !url.getHost().equals("127.0.0.1")) throw new SecurityException("release API requires HTTPS");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(8000); connection.setReadTimeout(12000); connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("Content-Type", "application/json");
        String token = secure.get("bearer");
        if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) { connection.setDoOutput(true); try(OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));} }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String text = read(stream);
        JSONObject value = text.isEmpty() ? new JSONObject() : new JSONObject(text);
        if (status < 200 || status >= 300) {
            if (status == 401) secure.remove("bearer");
            throw new ApiException(status, value.optString("error", "Request failed " + status));
        }
        return value;
    }

    void close() { executor.shutdownNow(); }
    private static String read(InputStream input) throws IOException {
        if (input == null) return "";
        try(input; ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192]; int count, total=0;
            while((count=input.read(buffer))!=-1){ total+=count; if(total>1_048_576) throw new IOException("response exceeds limit"); out.write(buffer,0,count); }
            return out.toString(StandardCharsets.UTF_8);
        }
    }
    static final class ApiException extends IOException {
        final int status; ApiException(int status,String message){super(message);this.status=status;}
    }
}

package com.ynxweb4.shop;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class ImageLoader {
    private static final int MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final LruCache<String, Bitmap> cache = new LruCache<>(16);

    void load(String rawURL, ImageView target) {
        if (!isSafeMediaURL(rawURL)) return;
        Bitmap cached = cache.get(rawURL);
        if (cached != null) {
            target.setImageBitmap(cached);
            return;
        }
        executor.execute(() -> {
            try {
                URL url = new URL(rawURL);
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(8_000);
                connection.setReadTimeout(12_000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Accept", "image/png,image/jpeg,image/webp");
                if (connection.getResponseCode() != 200) return;
                int declared = connection.getContentLength();
                if (declared > MAX_IMAGE_BYTES) return;
                byte[] bytes;
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[16_384];
                    int count, total = 0;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > MAX_IMAGE_BYTES) return;
                        output.write(buffer, 0, count);
                    }
                    bytes = output.toByteArray();
                } finally {
                    connection.disconnect();
                }
                Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap == null || bitmap.getWidth() < 1 || bitmap.getHeight() < 1) return;
                cache.put(rawURL, bitmap);
                main.post(() -> target.setImageBitmap(bitmap));
            } catch (Exception ignored) {
                // The catalog remains usable when optional media is unavailable.
            }
        });
    }

    static boolean isSafeMediaURL(String rawURL) {
        try {
            URL url = new URL(rawURL);
            return url.getProtocol().equals("https")
                    && url.getHost().equals("shop.ynxweb4.com")
                    && url.getUserInfo() == null
                    && url.getPort() == -1
                    && url.getPath().startsWith("/shop/assets/");
        } catch (Exception error) {
            return false;
        }
    }

    void close() {
        executor.shutdownNow();
        cache.evictAll();
    }
}

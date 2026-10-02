package com.ynxweb4.video;

import java.net.HttpURLConnection;
import java.net.URL;

/** Product navigation/account isolation; it grants no session authority. */
final class VideoRequestBoundary {
    static final String API = "https://video.ynxweb4.com/video/api";
    private long generation;
    synchronized long advance() { return ++generation; }
    synchronized long current() { return generation; }
    synchronized boolean matches(long expected) { return generation == expected; }
    synchronized void require(long expected) {
        if (!matches(expected)) throw new IllegalStateException("Request is no longer current");
    }
    static URL url(String path) throws Exception {
        String route = path.split("\\?", 2)[0].toLowerCase(java.util.Locale.ROOT);
        if (!(path.startsWith("/v1/") || path.startsWith("/media/")) || route.contains("..") ||
            path.contains("\\") || path.contains("#") || path.matches(".*[\\r\\n].*") ||
            route.contains("%2e") || route.contains("%2f") || route.contains("%5c")) {
            throw new IllegalArgumentException("Invalid Video path");
        }
        return new URL(API + path);
    }
    static void configure(HttpURLConnection connection) {
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(12000);
        connection.setUseCaches(false);
    }
    static boolean publicRead(String path, String method) {
        if (!"GET".equals(method)) return false;
        String route = path.split("\\?", 2)[0];
        return route.equals("/v1/videos") || route.matches("/v1/videos/[A-Za-z0-9_-]+(?:/comments)?") ||
            route.matches("/v1/channels/[A-Za-z0-9_-]+");
    }
}

package com.ynxweb4.browser;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Only new request-target deltas. Synthetic connections, no Android/DNS/TLS/SAF/network. */
public final class BrowserDownloadTargetDeltaTest {
  private static int passed;
  private interface Checked { void run() throws Exception; }
  private static void require(boolean value, String detail) { if (!value) throw new AssertionError(detail); }
  private static void test(String name, Checked body) throws Exception { body.run(); passed++; System.out.println("PASS " + name); }
  private static void reject(Checked body) throws Exception {
    try { body.run(); } catch (IllegalArgumentException | IOException expected) { return; }
    throw new AssertionError("Unsafe request accepted");
  }
  private static final class Response extends HttpURLConnection {
    final String location;
    Response(String expectedURL, String location) throws Exception { super(new URL(expectedURL)); this.location = location; }
    @Override public int getResponseCode() { return location == null ? 200 : 302; }
    @Override public String getHeaderField(String name) {
      if ("Location".equals(name)) return location;
      if ("Content-Length".equals(name)) return "3";
      return null;
    }
    @Override public String getContentType() { return "application/octet-stream"; }
    @Override public InputStream getInputStream() { return new ByteArrayInputStream(new byte[]{1, 2, 3}); }
    @Override public void connect() {}
    @Override public void disconnect() {}
    @Override public boolean usingProxy() { return false; }
  }
  private static final class Connections implements BrowserDownloadTransfer.Connections {
    final List<Response> responses;
    final List<String> actual = new ArrayList<>();
    Connections(Response... responses) { this.responses = Arrays.asList(responses); }
    @Override public HttpURLConnection open(URL url) {
      actual.add(url.toString());
      require(actual.size() <= responses.size(), "Unapproved additional request");
      Response response = responses.get(actual.size() - 1);
      require(url.toString().equals(response.getURL().toString()), "Actual request target changed: " + url + " != " + response.getURL());
      return response;
    }
  }
  private static BrowserDownloadTransfer.Result download(String url, Connections connections, ByteArrayOutputStream out) throws Exception {
    return new BrowserDownloadTransfer(connections).execute(new BrowserDownloadTransfer.Request(url, "SyntheticTargetTest", ""),
      () -> out, new BrowserDownloadTransfer.Control(), (bytes, total) -> {});
  }
  public static void main(String[] args) throws Exception {
    test("actual download preserves encoded path and opaque signed query bytes", () -> {
      String original = "https://one.leak.test/object/%7e/%2e%2e/report?token=%41%2f&signature=abc%7e";
      Connections connections = new Connections(new Response(original, null)); ByteArrayOutputStream out = new ByteArrayOutputStream();
      BrowserDownloadTransfer.Result result = download(original, connections, out);
      require(result.finalUrl.equals(original) && result.bytes == 3 && out.size() == 3, "Wrong saved target/result");
    });
    test("relative redirect preserves encoded path and query target", () -> {
      String start = "https://one.leak.test/start", next = "https://one.leak.test/assets/%7e/file?token=%61%2b%7e";
      Connections connections = new Connections(new Response(start, "/assets/%7e/file?token=%61%2b%7e"), new Response(next, null));
      require(download(start, connections, new ByteArrayOutputStream()).finalUrl.equals(next), "Redirect target changed");
      require(connections.actual.size() == 2, "Unexpected request count");
    });
    test("fragment never enters HTTP target while encoded hash remains", () -> {
      String expected = "https://one.leak.test/file%23name?token=%23%41";
      Connections connections = new Connections(new Response(expected, null));
      require(download(expected + "#preview", connections, new ByteArrayOutputStream()).finalUrl.equals(expected), "Fragment leaked into target");
    });
    test("duplicate query order plus spelling and percent case stay intact", () -> {
      String expected = "https://one.leak.test/file?key=%61&key=a&space=+&plus=%2b&slash=%2f";
      require(BrowserDownloadPolicy.requireHttps(expected).equals(expected), "Opaque query rewritten");
      download(expected, new Connections(new Response(expected, null)), new ByteArrayOutputStream());
    });
    test("normal host default port validation remains in the request path", () -> {
      String expected = "https://one.leak.test/file?token=%41";
      require(BrowserDownloadPolicy.requireHttps("HTTPS://ONE.LEAK.TEST:443/file?token=%41").equals(expected), "Authority validation lost");
    });
    test("library canonical identity still normalizes but cannot select a download target", () -> {
      String encoded = "https://one.leak.test/%7e/file?q=%41#view";
      require(BrowserNavigationPolicy.canonicalUrl(encoded).equals("https://one.leak.test/~/file?q=A"), "Library identity behavior changed");
      require(BrowserDownloadPolicy.requireHttps(encoded).equals("https://one.leak.test/%7e/file?q=%41"), "Request incorrectly uses identity");
    });
    test("changed request validation still rejects nonHTTPS credentials controls and backslashes", () -> {
      for (String target : new String[]{"http://one.leak.test/file?token=%41", "https://u:p@one.leak.test/file", "https://one.leak.test/file?token=%0d%0aX", "https://one.leak.test/a\\b", "file:///tmp/private"})
        reject(() -> BrowserDownloadPolicy.requireHttps(target));
    });
    test("encoded redirect remains HTTPS only and never opens the downgraded target", () -> {
      String start = "https://one.leak.test/file?token=%41";
      Connections connections = new Connections(new Response(start, "http://two.leak.test/file?token=%41"));
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      reject(() -> download(start, connections, out));
      require(connections.actual.size() == 1 && out.size() == 0, "Downgrade connected or was saved");
    });
    System.out.println("RESULT " + passed + " target deltas passed; Android runtime/SAF/TLS/Internet NOT_RUN");
  }
}

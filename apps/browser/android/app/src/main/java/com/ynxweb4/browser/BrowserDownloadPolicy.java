package com.ynxweb4.browser;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Pure request policy shared by the SAF consumer and offline transport checks. */
public final class BrowserDownloadPolicy {
  public static final int MAX_REDIRECTS = 5;
  private BrowserDownloadPolicy() {}

  public static String requireHttps(String value) {
    // Library/history identity decodes unreserved escapes and normalizes encoded dot paths.
    // A real download must preserve its request path and opaque signed query bytes instead.
    String checked = BrowserNavigationPolicy.requireWebUrl(value);
    if (!"https".equals(URI.create(checked).getScheme()))
      throw new IllegalArgumentException("Downloads require HTTPS");
    int fragment = checked.indexOf('#');
    return fragment < 0 ? checked : checked.substring(0, fragment);
  }

  public static String redirect(String from, String location) {
    if (location == null || location.trim().isEmpty() || location.length() > 16384)
      throw new IllegalArgumentException("Missing redirect destination");
    return requireHttps(URI.create(from).resolve(location).toString());
  }

  public static boolean sameOrigin(String first, String second) {
    URI a = URI.create(requireHttps(first)), b = URI.create(requireHttps(second));
    return a.getHost().equalsIgnoreCase(b.getHost()) && port(a) == port(b);
  }

  private static int port(URI uri) { return uri.getPort() < 0 ? 443 : uri.getPort(); }

  public static String header(String value) {
    if (value == null) return "";
    if (value.length() > 16384) throw new IllegalArgumentException("Oversized request header");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (c < 32 || c == 127 || c > 255) throw new IllegalArgumentException("Unsafe request header");
    }
    return value;
  }

  public static String mime(String value) {
    if (value == null) return "application/octet-stream";
    String bare = value.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
    return bare.matches("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+")
      ? bare : "application/octet-stream";
  }

  public static String filename(String url, String disposition) {
    String candidate = null;
    // Prefer RFC 5987 UTF-8 filename*, then a quoted/plain filename parameter.
    if (disposition != null && disposition.length() <= 16384) {
      java.util.regex.Matcher encoded = java.util.regex.Pattern.compile(
        "(?i)(?:^|;)\\s*filename\\*\\s*=\\s*UTF-8''([^;]+)").matcher(disposition);
      if (encoded.find()) {
        try { candidate = URLDecoder.decode(encoded.group(1).trim().replace("+", "%2B"), "UTF-8"); }
        catch (Exception ignored) { /* Fall back to the non-extended name or URL. */ }
      }
      if (candidate == null) {
        java.util.regex.Matcher plain = java.util.regex.Pattern.compile(
          "(?i)(?:^|;)\\s*filename\\s*=\\s*(?:\"([^\"]*)\"|([^;]*))").matcher(disposition);
        if (plain.find()) candidate = plain.group(1) == null ? plain.group(2).trim() : plain.group(1);
      }
    }
    if (candidate == null || candidate.isEmpty()) {
      try {
        String path = URI.create(requireHttps(url)).getRawPath();
        candidate = URLDecoder.decode(path.substring(path.lastIndexOf('/') + 1).replace("+", "%2B"), "UTF-8");
      } catch (Exception ignored) { candidate = "download"; }
    }
    // A suggested name is a single display name, never a path, control or bidi payload.
    candidate = candidate.replace('\\', '/');
    candidate = candidate.substring(candidate.lastIndexOf('/') + 1);
    StringBuilder safe = new StringBuilder();
    for (int offset = 0; offset < candidate.length();) {
      int cp = candidate.codePointAt(offset); offset += Character.charCount(cp);
      if (Character.isISOControl(cp) || Character.getType(cp) == Character.FORMAT
          || cp == ':' || cp == '*' || cp == '?' || cp == '"' || cp == '<' || cp == '>' || cp == '|')
        safe.append('_');
      else if (cp >= 0xD800 && cp <= 0xDFFF) safe.append('_');
      else safe.appendCodePoint(cp);
    }
    String result = safe.toString().trim().replaceAll("^[. ]+|[. ]+$", "");
    while (result.getBytes(StandardCharsets.UTF_8).length > 180)
      result = result.substring(0, result.offsetByCodePoints(result.length(), -1));
    return result.isEmpty() ? "download" : result;
  }
}

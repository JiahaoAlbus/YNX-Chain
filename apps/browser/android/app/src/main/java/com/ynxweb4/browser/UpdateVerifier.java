package com.ynxweb4.browser;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

final class UpdateVerifier {
  static boolean allowed(String current, String offered, String payload, String signatureBase64, String publicKeyBase64) {
    try {
      if (compare(offered, current) <= 0) return false;
      byte[] key = Base64.getDecoder().decode(publicKeyBase64);
      byte[] signature = Base64.getDecoder().decode(signatureBase64);
      Signature verifier = Signature.getInstance("Ed25519");
      verifier.initVerify(KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(key)));
      verifier.update(payload.getBytes(StandardCharsets.UTF_8));
      return verifier.verify(signature);
    } catch (Exception ignored) {
      return false;
    }
  }

  static int compare(String left, String right) {
    String[] a = left.split("\\.");
    String[] b = right.split("\\.");
    if (a.length != 3 || b.length != 3) return -1;
    try {
      for (int i = 0; i < 3; i++) {
        int delta = Integer.compare(Integer.parseInt(a[i]), Integer.parseInt(b[i]));
        if (delta != 0) return delta;
      }
      return 0;
    } catch (NumberFormatException error) {
      return -1;
    }
  }
}

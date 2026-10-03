import com.ynx.social.matrix.ImagePreviewBudget;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;

/** Header-only fixtures. These are not evidence of raster decoding or device UI. */
public final class HeaderBudgetCheck {
  private static int passed;
  private static Path fixtures;

  private static byte[] ascii(String value) {
    return value.getBytes(StandardCharsets.US_ASCII);
  }

  private static void le32(ByteArrayOutputStream out, int value) {
    for (int i = 0; i < 4; i++) out.write(value >>> (i * 8) & 255);
  }

  private static byte[] png(int declaredFrames, int observedFrames, boolean end)
      throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10});
    ByteArrayOutputStream header = new ByteArrayOutputStream();
    DataOutputStream fields = new DataOutputStream(header);
    fields.writeInt(100);
    fields.writeInt(100);
    fields.write(new byte[] {8, 6, 0, 0, 0});
    chunk(out, "IHDR", header.toByteArray());
    if (declaredFrames > 0) {
      ByteArrayOutputStream animation = new ByteArrayOutputStream();
      DataOutputStream control = new DataOutputStream(animation);
      control.writeInt(declaredFrames);
      control.writeInt(0);
      chunk(out, "acTL", animation.toByteArray());
    }
    for (int i = 0; i < observedFrames; i++) {
      ByteArrayOutputStream frame = new ByteArrayOutputStream();
      DataOutputStream control = new DataOutputStream(frame);
      control.writeInt(i);
      control.writeInt(100);
      control.writeInt(100);
      control.writeInt(0);
      control.writeInt(0);
      control.writeShort(1);
      control.writeShort(100);
      control.writeByte(0);
      control.writeByte(0);
      chunk(out, "fcTL", frame.toByteArray());
    }
    if (end) chunk(out, "IEND", new byte[0]);
    return out.toByteArray();
  }

  private static void chunk(ByteArrayOutputStream out, String kind, byte[] bytes)
      throws Exception {
    DataOutputStream fields = new DataOutputStream(out);
    fields.writeInt(bytes.length);
    fields.write(ascii(kind));
    fields.write(bytes);
    // The guard inspects bounds, not CRC or compressed raster validity.
    fields.writeInt(0);
  }

  private static byte[] webp(int frameCount, int frameBytes) throws Exception {
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    body.write(ascii("WEBP"));
    if (frameCount == 0) {
      body.write(ascii("VP8 "));
      le32(body, 10);
      body.write(new byte[10]);
    }
    for (int i = 0; i < frameCount; i++) {
      body.write(ascii("ANMF"));
      le32(body, frameBytes);
      body.write(new byte[frameBytes]);
      if ((frameBytes & 1) != 0) body.write(0);
    }
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(ascii("RIFF"));
    le32(out, body.size());
    out.write(body.toByteArray());
    return out.toByteArray();
  }

  private static int count(String name, byte[] bytes, String mime) throws Exception {
    Path file = fixtures.resolve(name);
    Files.write(file, bytes);
    return ImagePreviewBudget.INSTANCE.frames(file.toFile(), mime, 100, 100);
  }

  private static void equal(String name, int actual, int expected) {
    if (actual != expected) throw new AssertionError(name + ": " + actual + " != " + expected);
    passed++;
    System.out.println("PASS " + name);
  }

  @FunctionalInterface private interface RejectedOperation { void run() throws Exception; }

  private static void rejects(String name, RejectedOperation operation) throws Exception {
    try {
      operation.run();
    } catch (IllegalArgumentException expected) {
      passed++;
      System.out.println("PASS " + name + " " + expected.getMessage());
      return;
    }
    throw new AssertionError(name + ": unsafe header accepted");
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("fixture directory and public logo required");
    fixtures = Path.of(args[0]);
    Files.createDirectories(fixtures);
    equal("public-original-logo-png", ImagePreviewBudget.INSTANCE.frames(
        Path.of(args[1]).toFile(), "image/png", 798, 420), 1);
    equal("static-png-header", count("static.png", png(0, 0, true), "image/png"), 1);
    equal("apng-conservative-default-plus-animation", count("animated.png", png(2, 2, true), "image/png"), 3);
    rejects("apng-declared-frame-flood", () -> count("declared-flood.png", png(257, 0, true), "image/png"));
    rejects("apng-observed-frame-flood", () -> count("observed-flood.png", png(1, 257, true), "image/png"));
    rejects("png-missing-end", () -> count("missing-end.png", png(0, 0, false), "image/png"));
    byte[] truncatedPng = png(0, 0, true);
    rejects("png-truncated-chunk", () -> count("truncated.png", Arrays.copyOf(truncatedPng, truncatedPng.length - 1), "image/png"));
    equal("static-webp-header", count("static.webp", webp(0, 16), "image/webp"), 1);
    equal("webp-animation-frames", count("animated.webp", webp(3, 16), "image/webp"), 3);
    rejects("webp-frame-flood", () -> count("flood.webp", webp(257, 16), "image/webp"));
    rejects("webp-short-frame-header", () -> count("short-frame.webp", webp(1, 15), "image/webp"));
    byte[] mismatch = webp(3, 16);
    mismatch[4] ^= 1;
    rejects("webp-riff-size-mismatch", () -> count("size-mismatch.webp", mismatch, "image/webp"));
    byte[] truncatedWebp = webp(3, 16);
    rejects("webp-truncated-file", () -> count("truncated.webp", Arrays.copyOf(truncatedWebp, truncatedWebp.length - 1), "image/webp"));
    System.out.println("RESULT " + passed + "/13 header-only checks passed");
  }
}

package com.ynx.social.matrix;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/** Synthetic generated streams only; no HTTP/SDK/platform admission claim. */
public final class VeilBoundedCipherReadCheck {
  static int checks;
  static void check(boolean value) { if (!value) throw new AssertionError("bounded reader"); checks++; }
  static final class Stream extends InputStream {
    long remaining, transferred;
    int reads, closes;
    boolean zero, ioFailure, closeFailure;
    byte[] lastBuffer;
    Stream(long remaining) { this.remaining = remaining; }
    public int read(byte[] out, int offset, int length) throws IOException {
      reads++; lastBuffer = out;
      if (ioFailure) throw new IOException("synthetic stream failure");
      if (zero) return 0;
      if (remaining == 0) return -1;
      int count = (int) Math.min(remaining, length);
      Arrays.fill(out, offset, offset + count, (byte) 7);
      remaining -= count; transferred += count; return count;
    }
    public int read() throws IOException {
      reads++;
      if (ioFailure) throw new IOException("synthetic stream failure");
      if (remaining == 0) return -1;
      remaining--; transferred++; return 7;
    }
    public void close() throws IOException { closes++; if (closeFailure) throw new IOException("synthetic close failure"); }
  }
  interface Operation { void run() throws IOException; }
  static void fails(String code, Operation action) throws IOException {
    try { action.run(); } catch (IllegalStateException expected) { check(expected.getMessage().equals(code)); return; }
    throw new AssertionError("expected " + code);
  }
  static void zeroed(Stream stream) {
    if (stream.lastBuffer != null) for (byte value : stream.lastBuffer) if (value != 0) throw new AssertionError("candidate not wiped");
    check(stream.closes == 1);
  }
  public static void main(String[] args) throws IOException {
    Stream exact = new Stream(17000);
    byte[] body = VeilBoundedCipherRead.readExact(exact, 17000, () -> {});
    check(body.length == 17000 && body[0] == 7 && body[16999] == 7);
    check(exact.transferred == 17000 && exact.closes == 1);
    Arrays.fill(body, (byte) 0);
    Stream endless = new Stream(Long.MAX_VALUE);
    fails("VEIL_CIPHER_SIZE_MISMATCH", () -> VeilBoundedCipherRead.readExact(endless, 17000, () -> {}));
    check(endless.transferred == 17001); zeroed(endless);
    Stream early = new Stream(12);
    fails("VEIL_CIPHER_SIZE_MISMATCH", () -> VeilBoundedCipherRead.readExact(early, 13, () -> {})); zeroed(early);
    Stream blocked = new Stream(100);
    fails("VEIL_APPLICATION_CONTEXT_UNAVAILABLE", () -> VeilBoundedCipherRead.readExact(blocked, 100, null));
    check(blocked.reads == 0); zeroed(blocked);
    Stream revoked = new Stream(17000);
    fails("VEIL_APPLICATION_CONTEXT_UNAVAILABLE", () -> VeilBoundedCipherRead.readExact(revoked, 17000, () -> {
      if (revoked.transferred > 0) throw new IllegalStateException("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    }));
    check(revoked.transferred == 8192); zeroed(revoked);
    Stream noProgress = new Stream(1); noProgress.zero = true;
    fails("VEIL_CIPHER_STREAM_NO_PROGRESS", () -> VeilBoundedCipherRead.readExact(noProgress, 1, () -> {}));
    check(noProgress.reads == 1); zeroed(noProgress);
    Stream io = new Stream(1); io.ioFailure = true;
    try { VeilBoundedCipherRead.readExact(io, 1, () -> {}); throw new AssertionError("IO success"); }
    catch (IOException expected) { check(expected.getMessage().equals("synthetic stream failure")); }
    zeroed(io);
    Stream close = new Stream(1); close.closeFailure = true;
    try { VeilBoundedCipherRead.readExact(close, 1, () -> {}); throw new AssertionError("close success"); }
    catch (IOException expected) { check(expected.getMessage().equals("synthetic close failure")); }
    zeroed(close);
    Stream maximum = new Stream(2 * 1024 * 1024);
    byte[] largest = VeilBoundedCipherRead.readExact(maximum, 2 * 1024 * 1024, () -> {});
    check(largest.length == 2 * 1024 * 1024 && maximum.closes == 1); Arrays.fill(largest, (byte) 0);
    for (int invalid : new int[] {0, -1, 2 * 1024 * 1024 + 1}) {
      Stream stream = new Stream(Long.MAX_VALUE);
      fails("VEIL_ENVELOPE_INVALID", () -> VeilBoundedCipherRead.readExact(stream, invalid, () -> {}));
      check(stream.reads == 0); zeroed(stream);
    }
    Stream finalRevoke = new Stream(1);
    fails("VEIL_APPLICATION_CONTEXT_UNAVAILABLE", () -> VeilBoundedCipherRead.readExact(finalRevoke, 1, () -> {
      if (finalRevoke.closes > 0) throw new IllegalStateException("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    })); zeroed(finalRevoke);
    System.out.println("PASS bounded native stream checks=" + checks + "; generated input only, no original SDK streaming producer or HTTP/OS proof");
  }
}

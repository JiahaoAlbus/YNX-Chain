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
    boolean zero, ioFailure, closeFailure, readError, closeError, overreported;
    byte[] lastBuffer;
    Stream(long remaining) { this.remaining = remaining; }
    public int read(byte[] out, int offset, int length) throws IOException {
      reads++; lastBuffer = out;
      if (readError) throw new AssertionError("synthetic read error");
      if (ioFailure) throw new IOException("synthetic stream failure");
      if (overreported) { Arrays.fill(out, offset, offset + length, (byte) 7); return length + 1; }
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
    public void close() throws IOException {
      closes++;
      if (closeError) throw new AssertionError("synthetic close error");
      if (closeFailure) throw new IOException("synthetic close failure");
    }
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
    Stream exaggerated = new Stream(1); exaggerated.overreported = true;
    fails("VEIL_CIPHER_STREAM_NO_PROGRESS", () -> VeilBoundedCipherRead.readExact(exaggerated, 1, () -> {}));
    check(exaggerated.reads == 1); zeroed(exaggerated);
    for (boolean duringClose : new boolean[] {false, true}) {
      Stream fatal = new Stream(1); fatal.readError = !duringClose; fatal.closeError = duringClose;
      AssertionError observed = null;
      try { VeilBoundedCipherRead.readExact(fatal, 1, () -> {}); }
      catch (AssertionError expected) { observed = expected; }
      check(observed != null && observed.getMessage().equals(duringClose ? "synthetic close error" : "synthetic read error"));
      zeroed(fatal);
    }
    Stream both = new Stream(1); both.readError = true; both.closeFailure = true;
    AssertionError primary = null;
    try { VeilBoundedCipherRead.readExact(both, 1, () -> {}); }
    catch (AssertionError expected) { primary = expected; }
    check(primary != null && primary.getMessage().equals("synthetic read error"));
    check(primary.getSuppressed().length == 1 && primary.getSuppressed()[0] instanceof IOException);
    zeroed(both);
    Stream checkError = new Stream(17000);
    AssertionError authorityError = new AssertionError("synthetic authority error");
    AssertionError observedAuthority = null;
    try {
      VeilBoundedCipherRead.readExact(checkError, 17000, () -> {
        if (checkError.transferred > 0) throw authorityError;
      });
    } catch (AssertionError expected) { observedAuthority = expected; }
    check(observedAuthority == authorityError && checkError.transferred == 8192);
    zeroed(checkError);
    System.out.println("PASS bounded native stream checks=" + checks + "; generated input only, no original SDK streaming producer or HTTP/OS proof");
  }
}

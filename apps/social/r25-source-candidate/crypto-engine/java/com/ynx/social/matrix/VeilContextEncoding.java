package com.ynx.social.matrix;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import org.signal.libsignal.protocol.SignalProtocolAddress;

/** Strict local context encoding. Never normalize names or replace invalid UTF-16. */
final class VeilContextEncoding {
  private VeilContextEncoding() {}
  static byte[] encode(String value) {
    try {
      ByteBuffer buffer = StandardCharsets.UTF_8.newEncoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .encode(CharBuffer.wrap(value));
      byte[] encoded = new byte[buffer.remaining()];
      buffer.get(encoded);
      return encoded;
    } catch (CharacterCodingException error) {
      throw new IllegalArgumentException("VEIL_CONTEXT_UTF8_INVALID", error);
    }
  }
  static void validate(String value) { encode(value); }
  static void validateAddress(SignalProtocolAddress address) {
    validate(address.getName());
    validate(address.toString());
  }
}

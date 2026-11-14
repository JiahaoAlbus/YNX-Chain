package com.ynx.social.veil;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** R52 application framing only; never identity, device or message authority.
 * Callers must check nativeMessageAbiVersion() == MESSAGE_ABI_VERSION before
 * submission and retain the original frame with its original operation across
 * Pending/UNKNOWN. Logical IDs are public correlation, not restore handles.
 */
public final class VeilMessageFrame {
    public static final int MESSAGE_ABI_VERSION = 1;
    public static final int SIGNAL_MESSAGE = 2;
    public static final int PREKEY_SIGNAL_MESSAGE = 3;
    public static final int HEADER_BYTES = 28;
    public static final int MAX_TEXT_BYTES = 65536;
    public static final int MAX_CIPHERTEXT_BYTES = 1048576;

    private VeilMessageFrame() {}

    /** Input is already UTF-8. Returned bytes are caller-owned private staging. */
    public static byte[] send(byte[] logicalId, byte[] utf8) {
        return encode(logicalId, utf8, 1, 1, MAX_TEXT_BYTES);
    }

    /** Kind must come from genuine retained generation/transport metadata,
     * never from guessing a public prefix. Native selected-upstream parsing and
     * authentication remain mandatory; this method validates framing only.
     */
    public static byte[] receive(byte[] logicalId, int kind, byte[] ciphertext) {
        if (kind != SIGNAL_MESSAGE && kind != PREKEY_SIGNAL_MESSAGE) {
            throw new IllegalArgumentException("VEIL_MESSAGE_KIND");
        }
        return encode(logicalId, ciphertext, 2, kind, MAX_CIPHERTEXT_BYTES);
    }

    private static byte[] encode(byte[] logicalId, byte[] body, int direction,
                                 int kind, int limit) {
        if (logicalId == null || logicalId.length != 16) {
            throw new IllegalArgumentException("VEIL_MESSAGE_LOGICAL_ID");
        }
        if (body == null || body.length == 0 || body.length > limit) {
            throw new IllegalArgumentException("VEIL_MESSAGE_BODY_LENGTH");
        }
        byte[] frame = new byte[HEADER_BYTES + body.length];
        boolean complete = false;
        try {
            frame[0] = 'Y'; frame[1] = 'N'; frame[2] = 'X'; frame[3] = 'M';
            frame[4] = 1; frame[5] = (byte) direction; frame[6] = (byte) kind;
            // Validate owned copies, not arrays a caller may subsequently edit.
            System.arraycopy(logicalId, 0, frame, 8, 16);
            System.arraycopy(body, 0, frame, HEADER_BYTES, body.length);
            int nonzero = 0;
            for (int i = 8; i < 24; i++) nonzero |= frame[i];
            if (nonzero == 0) throw new IllegalArgumentException("VEIL_MESSAGE_LOGICAL_ID");
            ByteBuffer.wrap(frame, 24, 4).putInt(body.length);
            if (direction == 1) {
                requireUtf8(frame);
            } else if (((frame[HEADER_BYTES] & 0xff) >>> 4) != 4) {
                throw new IllegalArgumentException("VEIL_MESSAGE_WIRE_VERSION");
            }
            complete = true;
            return frame;
        } finally {
            if (!complete) Arrays.fill(frame, (byte) 0);
        }
    }

    private static void requireUtf8(byte[] frame) {
        CharBuffer decoded = null;
        try {
            decoded = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(frame, HEADER_BYTES, frame.length - HEADER_BYTES));
        } catch (CharacterCodingException invalid) {
            throw new IllegalArgumentException("VEIL_MESSAGE_UTF8", invalid);
        } finally {
            // Best-effort clearing of this accessible scratch only, not a claim
            // about JVM/decoder copies, caller storage or whole-runtime wiping.
            if (decoded != null && decoded.hasArray()) Arrays.fill(decoded.array(), '\0');
        }
    }
}

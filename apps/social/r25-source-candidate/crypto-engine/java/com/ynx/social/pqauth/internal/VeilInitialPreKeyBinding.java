package com.ynx.social.pqauth.internal;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;

/* Private storage profile, NOT a device grant. Native recomputes the SAME
 * original association/IDs/bundle digest; Java only validates the fixed shape.
 * No secret serialization, key generator, public token or fallback here. */
final class VeilInitialPreKeyBinding {
    private static final byte[] DOMAIN="YNX/SOCIAL/INITIAL-PREKEY-STORAGE/V1".getBytes(StandardCharsets.US_ASCII);
    private static final long MAX_SAFE=9007199254740991L;
    private VeilInitialPreKeyBinding(){}
    private static GeneralSecurityException invalid(){return new GeneralSecurityException("INITIAL_PREKEY_BINDING");}
    private static void nonzero(ByteBuffer b,int count)throws GeneralSecurityException{
        if(count<1||b.remaining()<count)throw invalid();
        int nonzero=0;for(int i=0;i<count;i++)nonzero|=b.get();if(nonzero==0)throw invalid();
    }
    static int validate(String alias,byte[] raw)throws GeneralSecurityException{
        if(alias==null||!alias.matches("ynx\\.social\\.ownkey\\.v1\\.[0-9a-f]{32}")||raw==null||raw.length>8192)throw invalid();
        // Avoid underflow leaking unrelated exceptions through the JNI lane.
        try{
            ByteBuffer b=ByteBuffer.wrap(raw).order(ByteOrder.BIG_ENDIAN);
            for(byte v:DOMAIN)if(b.get()!=v)throw invalid();
            if(b.getInt()!=1)throw invalid();
            int kind=b.getInt();if(kind<1||kind>3||b.getLong()<1)throw invalid();
            byte[] name=alias.getBytes(StandardCharsets.US_ASCII);
            if(b.getInt()!=name.length)throw invalid();for(byte v:name)if(b.get()!=v)throw invalid();
            if(b.get()!=5)throw invalid();nonzero(b,32);nonzero(b,2592);
            int association=b.getInt();if(association<1||association>4096||b.remaining()<association+16+16+4+8+4+32)throw invalid();
            nonzero(b,association);nonzero(b,16);nonzero(b,16);
            if(Integer.toUnsignedLong(b.getInt())==0)throw invalid();
            long timestamp=b.getLong();if(timestamp<1||timestamp>MAX_SAFE)throw invalid();
            int length=b.getInt();if(length<1||length>16384)throw invalid();
            nonzero(b,32);if(b.hasRemaining())throw invalid();return length;
        }catch(java.nio.BufferUnderflowException|IndexOutOfBoundsException e){throw invalid();}
    }
}

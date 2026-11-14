package com.ynx.social.pqauth.internal;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;

/** Private at-rest wrapping format, not an identity or authorization proof.
 * No ratchet, protocol, KDF or message AEAD parameters are changed here.
 */
final class VeilCoreStorageBinding {
    private static final byte[] DOMAIN="YNX/SOCIAL/CORE-STORAGE-WRAP/V1".getBytes(StandardCharsets.US_ASCII);
    private static final int ROOT=32, REGISTRATION=32, CLASSIC=33, PQ=2592;
    private VeilCoreStorageBinding() {}
    static void validateAlias(String alias)throws GeneralSecurityException{
        if(alias==null||!alias.matches("ynx\\.social\\.corestore\\.v1\\.[0-9a-f]{32}"))
            throw new GeneralSecurityException("CORE_STORAGE_ALIAS_PROFILE");
    }
    private static void nonzero(byte[] bytes,int size)throws GeneralSecurityException{
        if(bytes==null||bytes.length!=size)throw new GeneralSecurityException("CORE_STORAGE_BINDING_SIZE");
        int bits=0;for(byte value:bytes)bits|=value;
        if(bits==0)throw new GeneralSecurityException("CORE_STORAGE_UNINITIALIZED_BINDING");
    }
    static byte[] encode(String alias,long generation,byte[] root,byte[] registration,byte[] classic,byte[] pq)
            throws GeneralSecurityException{
        validateAlias(alias);
        if(generation<1||generation>0xffffffffL)throw new GeneralSecurityException("CORE_STORAGE_GENERATION");
        nonzero(root,ROOT);nonzero(registration,REGISTRATION);nonzero(classic,CLASSIC);nonzero(pq,PQ);
        if(classic[0]!=5)throw new GeneralSecurityException("CORE_STORAGE_CLASSIC_PROFILE");
        byte[] name=alias.getBytes(StandardCharsets.US_ASCII);
        return ByteBuffer.allocate(DOMAIN.length+16+name.length+ROOT+REGISTRATION+CLASSIC+PQ)
            .put(DOMAIN).putInt(1).putLong(generation).putInt(name.length).put(name)
            .put(root).put(registration).put(classic).put(pq).array();
    }
    static byte[] validateAndCopy(String alias,byte[] input)throws GeneralSecurityException{
        validateAlias(alias);
        byte[] name=alias.getBytes(StandardCharsets.US_ASCII);
        int expected=DOMAIN.length+16+name.length+ROOT+REGISTRATION+CLASSIC+PQ;
        if(input==null||input.length!=expected)throw new GeneralSecurityException("CORE_STORAGE_AAD_SIZE");
        byte[] stable=input.clone();
        ByteBuffer b=ByteBuffer.wrap(stable);
        for(byte v:DOMAIN)if(b.get()!=v)throw new GeneralSecurityException("CORE_STORAGE_AAD_DOMAIN");
        if(b.getInt()!=1)throw new GeneralSecurityException("CORE_STORAGE_AAD_VERSION");
        long generation=b.getLong();
        if(generation<1||generation>0xffffffffL)throw new GeneralSecurityException("CORE_STORAGE_GENERATION");
        if(b.getInt()!=name.length)throw new GeneralSecurityException("CORE_STORAGE_AAD_ALIAS");
        for(byte v:name)if(b.get()!=v)throw new GeneralSecurityException("CORE_STORAGE_AAD_ALIAS");
        int offset=b.position();
        nonzero(Arrays.copyOfRange(stable,offset,offset+ROOT),ROOT);offset+=ROOT;
        nonzero(Arrays.copyOfRange(stable,offset,offset+REGISTRATION),REGISTRATION);offset+=REGISTRATION;
        if(stable[offset]!=5)throw new GeneralSecurityException("CORE_STORAGE_CLASSIC_PROFILE");
        nonzero(Arrays.copyOfRange(stable,offset+1,offset+CLASSIC),CLASSIC-1);offset+=CLASSIC;
        nonzero(Arrays.copyOfRange(stable,offset,offset+PQ),PQ);
        return stable;
    }
    static byte[] matchCopy(String alias,byte[] input,byte[] pinned)throws GeneralSecurityException{
        byte[] stable=validateAndCopy(alias,input);
        if(pinned==null||!MessageDigest.isEqual(stable,pinned)){
            Arrays.fill(stable,(byte)0);
            throw new GeneralSecurityException("CORE_STORAGE_BINDING_CHANGED");
        }
        return stable;
    }
}

package com.ynxweb4.music;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

// The inherited IV.ciphertext record and Keystore alias remain unchanged.
// Only a genuinely absent record may cause first-use storage-key creation.
final class SessionCustody {
    interface Record {
        String read() throws Exception;
        boolean write(String raw) throws Exception;
        boolean remove() throws Exception;
    }
    interface Keys {
        SecretKey existing() throws Exception;
        SecretKey create() throws Exception;
    }
    static final class Unavailable extends IllegalStateException {
        Unavailable(Exception cause) { super("Music credentials are unavailable. Unlock the device and retry; the saved record is preserved.", cause); }
    }
    private final Record record;
    private final Keys keys;
    SessionCustody(Record record, Keys keys) { this.record=record; this.keys=keys; }
    synchronized String read() {
        try {
            String raw=record.read();
            return raw==null || raw.isEmpty() ? "" : decrypt(raw, requireExisting());
        } catch (Exception error) { throw new Unavailable(error); }
    }
    synchronized void write(String value) {
        try {
            if(value==null || !value.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid Music session binding");
            String previous=record.read();
            SecretKey key=keys.existing();
            if(previous!=null && !previous.isEmpty()) {
                if(key==null) throw new IllegalStateException("Saved session storage key is missing");
                decrypt(previous,key); // Locked, damaged or foreign bytes are never replaced.
            }
            if(key==null) key=keys.create();
            if(key==null) throw new IllegalStateException("Storage key creation failed");
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE,key);
            byte[] encrypted=cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String raw=Base64.getEncoder().encodeToString(cipher.getIV())+"."+Base64.getEncoder().encodeToString(encrypted);
            if(!record.write(raw)) throw new IllegalStateException("Session write did not commit");
        } catch (Exception error) { throw new Unavailable(error); }
    }
    synchronized void clear() {
        try {
            String raw=record.read();if(raw!=null&&!raw.isEmpty())decrypt(raw,requireExisting());
            if(!record.remove()) throw new IllegalStateException("Session removal did not commit");
        } catch (Exception error) { throw new Unavailable(error); }
    }
    private SecretKey requireExisting() throws Exception {
        SecretKey key=keys.existing();
        if(key==null) throw new IllegalStateException("Saved session storage key is missing");
        return key;
    }
    private String decrypt(String raw, SecretKey key) throws Exception {
        if(raw.length()>4096) throw new IllegalArgumentException("Oversized saved session");
        String[] parts=raw.split("\\.",-1);
        if(parts.length!=2) throw new IllegalArgumentException("Invalid saved session");
        byte[] iv=Base64.getDecoder().decode(parts[0]), encrypted=Base64.getDecoder().decode(parts[1]);
        if(iv.length!=12 || encrypted.length!=80) throw new IllegalArgumentException("Invalid saved session bytes");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,iv));
        String value=new String(cipher.doFinal(encrypted),StandardCharsets.UTF_8);
        if(!value.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid saved binding");
        return value;
    }
}

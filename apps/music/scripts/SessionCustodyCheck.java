package com.ynxweb4.music;

import java.util.Base64;
import java.nio.charset.StandardCharsets;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.Cipher;

public final class SessionCustodyCheck {
    static final String A="a".repeat(64),B="b".repeat(64);
    static final class Fixture implements SessionCustody.Record,SessionCustody.Keys {
        String raw="";SecretKey key;boolean locked,failWrite,failRemove;int created,writes,removes;
        public String read(){return raw;}
        public boolean write(String next){writes++;if(failWrite)return false;raw=next;return true;}
        public boolean remove(){removes++;if(failRemove)return false;raw="";return true;}
        public SecretKey existing(){if(locked)throw new IllegalStateException("locked");return key;}
        public SecretKey create()throws Exception{created++;KeyGenerator g=KeyGenerator.getInstance("AES");g.init(256);key=g.generateKey();return key;}
        SessionCustody custody(){return new SessionCustody(this,this);}
    }
    static void equal(Object a,Object b){if(!java.util.Objects.equals(a,b))throw new AssertionError("Custody assertion failed");}
    static void unavailable(Runnable work){try{work.run();throw new AssertionError("Unavailable custody accepted");}catch(SessionCustody.Unavailable expected){}}
    static Fixture legacy()throws Exception{
        Fixture f=new Fixture();f.create();f.created=0;Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,f.key);
        f.raw=Base64.getEncoder().encodeToString(c.getIV())+"."+Base64.getEncoder().encodeToString(c.doFinal(A.getBytes(StandardCharsets.UTF_8)));return f;
    }
    static void preservedFailures(Fixture f){
        String old=f.raw;SessionCustody custody=f.custody();unavailable(custody::read);unavailable(()->custody.write(B));unavailable(custody::clear);
        equal(f.raw,old);equal(f.created,0);equal(f.writes,0);equal(f.removes,0);
    }
    public static void main(String[] args)throws Exception{
        Fixture first=new Fixture();equal(first.custody().read(),"");equal(first.created,0);first.custody().write(A);equal(first.created,1);equal(first.custody().read(),A);
        Fixture legacy=legacy();SecretKey original=legacy.key;equal(legacy.custody().read(),A);legacy.custody().write(B);equal(legacy.custody().read(),B);equal(legacy.key,original);equal(legacy.created,0);
        Fixture absent=legacy();absent.key=null;preservedFailures(absent);
        Fixture locked=legacy();locked.locked=true;preservedFailures(locked);locked.locked=false;equal(locked.custody().read(),A);
        Fixture corrupted=legacy();byte[] encrypted=Base64.getDecoder().decode(corrupted.raw.split("\\.")[1]);encrypted[0]^=1;corrupted.raw=corrupted.raw.split("\\.")[0]+"."+Base64.getEncoder().encodeToString(encrypted);preservedFailures(corrupted);
        for(String invalid:new String[]{"not-a-record","...","".repeat(0)+"A".repeat(4097)}){Fixture f=legacy();f.raw=invalid;preservedFailures(f);}
        Fixture wrong=legacy();SecretKey originalWrong=wrong.key;wrong.key=legacy().key;preservedFailures(wrong);wrong.key=originalWrong;equal(wrong.custody().read(),A);
        Fixture commit=legacy();String old=commit.raw;commit.failWrite=true;unavailable(()->commit.custody().write(B));equal(commit.raw,old);equal(commit.created,0);equal(commit.custody().read(),A);
        SecretKey savedKey=commit.key;commit.failRemove=true;unavailable(commit.custody()::clear);equal(commit.raw,old);commit.failRemove=false;commit.custody().clear();equal(commit.custody().read(),"");equal(commit.key,savedKey);
        Fixture invalid=legacy();String oldInvalid=invalid.raw;unavailable(()->invalid.custody().write("guest"));equal(invalid.raw,oldInvalid);equal(invalid.created,0);
        System.out.println("PASS original AES/GCM record, first-use-only creation, missing/locked/wrong key, corrupt/oversized record, failed commits, explicit removal and preserved signer/storage identity; host JCE only, no installed Keystore claim");
    }
}

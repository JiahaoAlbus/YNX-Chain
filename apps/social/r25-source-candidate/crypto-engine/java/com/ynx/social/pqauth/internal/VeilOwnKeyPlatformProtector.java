package com.ynx.social.pqauth.internal;

import android.content.Context;
import android.os.Build;
import android.os.Process;
import android.os.UserManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileDescriptor;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/* Private normal CryptoEngine candidate, no Expo/UI factory or secret getter.
 * No actual key/provider operations are run by its compile-only delivery.
 * Controlled internal direct-buffer/provider copies are NOT all-memory wipe.
 */
final class VeilOwnKeyPlatformProtector implements AutoCloseable {
    private static final byte[] DOMAIN="YNX/SOCIAL/OWN-PQ-STORAGE/V1".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] CLASSIC_DOMAIN="YNX/SOCIAL/OWN-CLASSIC-STORAGE/V1".getBytes(StandardCharsets.US_ASCII);
    private final Thread owner=Thread.currentThread();
    private final int uid=Process.myUid(), pid=Process.myPid(), gid=Os.getgid();
    private final Context context;
    private final String alias;
    private final byte[] coreStorageAad;
    private FileChannel channel;
    private FileOutputStream stream;
    private FileLock lock;
    private FileDescriptor aliasFd;
    private Throwable aliasCloseFailure;
    private SecretKey key;
    private VeilAndroidKeyStoreIdentity coreKeyIdentity;
    private Throwable coreCurrentPrimary;
    private Throwable closePrimary;
    private Throwable initPrimary;
    private boolean initializationAttempted;
    private boolean coreRecordAttempted;
    private Throwable coreRecordPrimary;
    private FileDescriptor coreRecordFd;
    private Throwable coreRecordCloseFailure;
    private FrameworkPin coreDirectoryPin;
    private FrameworkPin dataPin, dataInfoPin, installedDataPin, noBackupPin;
    private static final class FrameworkPin {
        final File directory;
        final long dev, ino;
        FileDescriptor fd;
        Throwable closeFailure;
        FrameworkPin(File d,StructStat s){directory=d;dev=s.st_dev;ino=s.st_ino;}
    }
    private VeilOwnKeyPlatformProtector(Context c,String a){this(c,a,null);}
    private VeilOwnKeyPlatformProtector(Context c,String a,byte[] binding){context=c;alias=a;coreStorageAad=binding;}
    // Separate key and directory from identity protection. Public binding facts
    // are not device authorization, a currentness proof, or a rollback floor.
    private static VeilOwnKeyPlatformProtector prepareCoreStorage(Context c,String alias,byte[] binding)throws Exception{
        byte[] pinned=VeilCoreStorageBinding.validateAndCopy(alias,binding);
        VeilOwnKeyPlatformProtector p=new VeilOwnKeyPlatformProtector(c,alias,pinned);
        p.guard();return p;
    }
    // Reuse the actual authenticated identity protector's policy window,
    // not a UI preference or a new permissive QA default.
    private int coreStorageAuthenticationSeconds()throws Exception{
        ready();
        if(coreStorageAad!=null)throw new GeneralSecurityException("OWN_KEY_PROFILE_REQUIRED");
        KeyInfo info=(KeyInfo)SecretKeyFactory.getInstance("AES","AndroidKeyStore").getKeySpec(key,KeyInfo.class);
        int seconds=info.getUserAuthenticationValidityDurationSeconds();
        if(!info.isUserAuthenticationRequired()||seconds<1||seconds>120)
            throw new GeneralSecurityException("OWN_KEY_AUTH_POLICY");
        ready();return seconds;
    }
    private void coreStorageCurrent()throws Exception{
        if(Thread.currentThread()!=owner)throw new GeneralSecurityException("OWN_WRONG_WORKER");
        if(coreStorageAad==null)throw new GeneralSecurityException("CORE_STORAGE_PROFILE_REQUIRED");
        if(coreCurrentPrimary!=null)VeilOwnKeyPlatformProtector.<RuntimeException>rethrow(coreCurrentPrimary);
        try {
            ready();
            if(coreRecordPrimary!=null)VeilOwnKeyPlatformProtector.<RuntimeException>rethrow(coreRecordPrimary);
            if(lock==null||!lock.isValid()||coreDirectoryPin==null)
                throw new GeneralSecurityException("CORE_STORAGE_LOCK_REQUIRED");
            checkDir(coreDirectoryPin.directory);verifyFrameworkPin(coreDirectoryPin);
            if(coreKeyIdentity==null)throw new GeneralSecurityException("CORE_STORAGE_KEY_IDENTITY_REQUIRED");
            coreKeyIdentity.current(alias);
            // Recheck the same actor and lock after the OS provider boundary.
            ready();verifyFrameworkPin(coreDirectoryPin);
            if(!lock.isValid())throw new GeneralSecurityException("CORE_STORAGE_LOCK_REQUIRED");
        } catch(Throwable primary) {
            coreCurrentPrimary=primary; // retained first cause, no retry of this loan
            VeilOwnKeyPlatformProtector.<RuntimeException>rethrow(primary);
        }
    }
    // Native-only path observation for the same pinned key scope. No file or
    // database is created here; no caller-controlled path or key leaves Java.
    private String normalJournalPath()throws Exception{
        coreStorageCurrent();
        String path=new File(coreDirectoryPin.directory,"normal-journal-v1.sqlite").getPath();
        coreStorageCurrent();return path;
    }
    // Source-owned caller supplies the reviewed authenticated platform policy.
    // No devicegrant precondition, no default unauthenticated QA policy.
    private static VeilOwnKeyPlatformProtector prepare(Context c,String alias) throws Exception {
        if(alias==null||!alias.matches("ynx\\.social\\.ownkey\\.v1\\.[0-9a-f]{32}"))throw new GeneralSecurityException("OWN_ALIAS_PROFILE");
        VeilOwnKeyPlatformProtector p=new VeilOwnKeyPlatformProtector(c,alias);p.guard();return p;
        // NO directory/lock/key operation until native global owner is retained.
    }
    private void initializeNew(KeyGenParameterSpec policy) throws Exception {
        guard();if(initializationAttempted)throw new GeneralSecurityException("OWN_INIT_NO_RETRY");initializationAttempted=true;
        try {
        if(policy==null||alias==null||!alias.equals(policy.getKeystoreAlias())||policy.getKeySize()!=256||
            policy.getPurposes()!=(KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)||
            !policy.isUserAuthenticationRequired()||policy.getUserAuthenticationValidityDurationSeconds()<1||
            policy.getUserAuthenticationValidityDurationSeconds()>120||!policy.isRandomizedEncryptionRequired()||
            !Arrays.equals(policy.getBlockModes(),new String[]{KeyProperties.BLOCK_MODE_GCM})||
            !Arrays.equals(policy.getEncryptionPaddings(),new String[]{KeyProperties.ENCRYPTION_PADDING_NONE}))
            throw new GeneralSecurityException("OWN_KEY_AUTH_POLICY");
        if(coreStorageAad!=null)VeilAndroidKeyStoreIdentity.requireSupported();
        reserve();VeilOwnKeyPlatformProtector p=this;
            p.guard();KeyStore s=KeyStore.getInstance("AndroidKeyStore");s.load(null);
            if(s.containsAlias(alias))throw new GeneralSecurityException("OWN_ALIAS_COLLISION_PRESERVED");
            KeyGenerator g=KeyGenerator.getInstance("AES","AndroidKeyStore");g.init(policy);
            p.guard();SecretKey generated=g.generateKey(); // failure may have created alias; NEVER delete/retry/regenerate.
            p.lookup(s);
            if(coreStorageAad!=null)VeilAndroidKeyStoreIdentity.sameKey(generated,key);
        }catch(Throwable primary){initPrimary=primary;cleanup(primary);throw primary;}
    }
    private void initializeExisting() throws Exception {
        guard();if(initializationAttempted)throw new GeneralSecurityException("OWN_INIT_NO_RETRY");initializationAttempted=true;
        try {if(coreStorageAad!=null)VeilAndroidKeyStoreIdentity.requireSupported();
            reserve();KeyStore s=KeyStore.getInstance("AndroidKeyStore");s.load(null);lookup(s);}
        catch(Throwable primary){initPrimary=primary;cleanup(primary);throw primary;}
    }
    private void reserve() throws Exception {
        VeilOwnKeyPlatformProtector p=this;Context c=context;
        try {
            p.guard();File data=c.getDataDir();p.guard();
            if(data==null||!data.isAbsolute())
                throw new GeneralSecurityException("OWN_CE_DATA_IDENTITY");
            p.pinFramework(data,true);
            p.pinDataViews(c);
            p.guard();File parent=c.getNoBackupFilesDir();p.guard();p.verifyFrameworkPins();
            if(parent==null||!parent.isAbsolute()||!"no_backup".equals(parent.getName()))
                throw new GeneralSecurityException("OWN_CE_NO_BACKUP_IDENTITY");
            StructStat expectedParent=Os.lstat(new File(data,"no_backup").getPath());
            StructStat actualParent=Os.lstat(parent.getPath());
            p.frameworkPolicy(expectedParent);p.frameworkPolicy(actualParent);
            if(expectedParent.st_dev!=actualParent.st_dev||expectedParent.st_ino!=actualParent.st_ino)
                throw new GeneralSecurityException("OWN_CE_NO_BACKUP_IDENTITY");
            p.pinFramework(parent,false);p.guard();p.verifyFrameworkPins();
            String directoryName=coreStorageAad==null?"veil-own-key-v1":"veil-core-storage-v1";
            File dir=new File(parent,directoryName);
            if(!dir.exists()){if(!dir.mkdir())throw new GeneralSecurityException("OWN_DIRECTORY_CREATE");
                if(!dir.setReadable(false,false)||!dir.setWritable(false,false)||!dir.setExecutable(false,false)||
                    !dir.setReadable(true,true)||!dir.setWritable(true,true)||!dir.setExecutable(true,true))
                    throw new GeneralSecurityException("OWN_DIRECTORY_MODE");}
            p.checkDir(dir);p.guard();p.verifyFrameworkPins();
            if(!dir.getCanonicalFile().equals(new File(parent.getCanonicalFile(),directoryName)))throw new GeneralSecurityException("OWN_DIRECTORY_PATH");
            if(coreStorageAad!=null){
                coreDirectoryPin=new FrameworkPin(dir,Os.lstat(dir.getPath()));
                coreDirectoryPin.fd=Os.open(dir.getPath(),OsConstants.O_RDONLY|OsConstants.O_NOFOLLOW|OsConstants.O_CLOEXEC,0);
                checkDir(dir);verifyFrameworkPin(coreDirectoryPin);
            }
            File f=new File(dir,alias+".lock");
            if(f.createNewFile()){
                if(!f.setReadable(false,false)||!f.setWritable(false,false)||!f.setExecutable(false,false)||
                    !f.setReadable(true,true)||!f.setWritable(true,true))throw new GeneralSecurityException("OWN_LOCK_MODE");
            }
            p.guard();p.verifyFrameworkPins();
            StructStat st=Os.lstat(f.getPath());if(!OsConstants.S_ISREG(st.st_mode)||st.st_uid!=uid||st.st_gid!=gid||(st.st_mode&07777)!=0600)
                throw new GeneralSecurityException("OWN_EXISTING_LOCK_MODE");
            p.aliasFd=Os.open(f.getPath(),OsConstants.O_RDWR|OsConstants.O_NOFOLLOW|OsConstants.O_CLOEXEC,0600);
                StructStat opened=Os.fstat(p.aliasFd);
                if(opened.st_dev!=st.st_dev||opened.st_ino!=st.st_ino||!OsConstants.S_ISREG(opened.st_mode)||
                    opened.st_uid!=uid||opened.st_gid!=gid||(opened.st_mode&07777)!=0600)
                    throw new GeneralSecurityException("OWN_LOCK_OPEN_IDENTITY");
                p.stream=new FileOutputStream(p.aliasFd);
                p.aliasFd=null; // Confirmed transfer only after wrapper publication.
                p.channel=p.stream.getChannel();
            p.lock=p.channel.tryLock();
            if(p.lock==null)throw new GeneralSecurityException("OWN_ALIAS_BUSY");
            p.guard();p.verifyFrameworkPins();
        }catch(Throwable primary){throw primary;} // outer initialize owns exactly one cleanup attempt
    }
    private void checkDir(File d)throws Exception{
        StructStat st=Os.lstat(d.getPath());if(!OsConstants.S_ISDIR(st.st_mode)||st.st_uid!=uid||st.st_gid!=gid||(st.st_mode&07777)!=0700)
            throw new GeneralSecurityException("OWN_EXISTING_DIRECTORY_MODE");
    }
    private void frameworkPolicy(StructStat st)throws Exception{
        int mode=st.st_mode&07777;
        if(!OsConstants.S_ISDIR(st.st_mode)||st.st_uid!=uid||st.st_gid!=gid||(mode!=0700&&mode!=0771))
            throw new GeneralSecurityException("OWN_FRAMEWORK_DIRECTORY_PROFILE");
    }
    private void pinFramework(File directory,boolean data)throws Exception{
        guard();StructStat st=Os.lstat(directory.getPath());frameworkPolicy(st);
        if((data?dataPin:noBackupPin)!=null)throw new GeneralSecurityException("OWN_FRAMEWORK_PIN_ONCE");
        FrameworkPin pin=new FrameworkPin(directory,st);
        if(data)dataPin=pin;else noBackupPin=pin;
        // Pin registration precedes open; assignment retains the returned FD
        // before fstat/any subsequent allocation can fail.
        pin.fd=Os.open(directory.getPath(),OsConstants.O_RDONLY|OsConstants.O_NOFOLLOW|OsConstants.O_CLOEXEC,0);
        verifyFrameworkPins();
    }
    private void pinDataViews(Context c)throws Exception{
        android.content.pm.ApplicationInfo info=c.getApplicationInfo();
        android.content.pm.ApplicationInfo installed=c.getPackageManager().getApplicationInfo(
            com.ynx.social.matrix.VeilAppIsolation.requireOwnedPackage(c),0);
        if(info==null||installed==null||info.dataDir==null||installed.dataDir==null||
            dataInfoPin!=null||installedDataPin!=null)
            throw new GeneralSecurityException("OWN_CE_DATA_IDENTITY");
        File local=new File(info.dataDir),registered=new File(installed.dataDir);
        if(!local.isAbsolute()||!registered.isAbsolute())
            throw new GeneralSecurityException("OWN_CE_DATA_IDENTITY");
        StructStat localStat=Os.lstat(local.getPath()),registeredStat=Os.lstat(registered.getPath());
        frameworkPolicy(localStat);frameworkPolicy(registeredStat);
        if(localStat.st_dev!=dataPin.dev||localStat.st_ino!=dataPin.ino||
            registeredStat.st_dev!=dataPin.dev||registeredStat.st_ino!=dataPin.ino)
            throw new GeneralSecurityException("OWN_CE_DATA_IDENTITY");
        dataInfoPin=new FrameworkPin(local,localStat);
        dataInfoPin.fd=Os.open(local.getPath(),OsConstants.O_RDONLY|
            OsConstants.O_NOFOLLOW|OsConstants.O_CLOEXEC,0);
        verifyFrameworkPins();
        installedDataPin=new FrameworkPin(registered,registeredStat);
        installedDataPin.fd=Os.open(registered.getPath(),OsConstants.O_RDONLY|
            OsConstants.O_NOFOLLOW|OsConstants.O_CLOEXEC,0);
        verifyFrameworkPins();
    }
    private void verifyFrameworkPin(FrameworkPin pin)throws Exception{
        if(pin==null)return;
        if(pin.fd==null||pin.closeFailure!=null)throw new GeneralSecurityException("OWN_FRAMEWORK_PIN_LIFETIME");
        StructStat current=Os.lstat(pin.directory.getPath()),held=Os.fstat(pin.fd);
        frameworkPolicy(current);frameworkPolicy(held);
        if(!pin.directory.isAbsolute()||
            current.st_dev!=pin.dev||current.st_ino!=pin.ino||held.st_dev!=pin.dev||held.st_ino!=pin.ino)
            throw new GeneralSecurityException("OWN_FRAMEWORK_PATH_REPLACED");
    }
    private void verifyFrameworkPins()throws Exception{
        verifyFrameworkPin(coreDirectoryPin);
        verifyFrameworkPin(dataPin);verifyFrameworkPin(dataInfoPin);
        verifyFrameworkPin(installedDataPin);verifyFrameworkPin(noBackupPin);
        if(noBackupPin!=null){
            if(dataPin==null)throw new GeneralSecurityException("OWN_CE_NO_BACKUP_IDENTITY");
            StructStat child=Os.lstat(new File(dataPin.directory,"no_backup").getPath());
            frameworkPolicy(child);
            if(child.st_dev!=noBackupPin.dev||child.st_ino!=noBackupPin.ino)
                throw new GeneralSecurityException("OWN_CE_NO_BACKUP_IDENTITY");
        }
    }
    private void guard()throws Exception{
        if(Thread.currentThread()!=owner)throw new GeneralSecurityException("OWN_WRONG_WORKER");
        if(Build.VERSION.SDK_INT<24||context==null||context.getApplicationContext()!=context||context.isDeviceProtectedStorage()||
            Process.myUid()!=uid||Process.myPid()!=pid||
            Os.getuid()!=uid||Os.geteuid()!=uid||Os.getgid()!=gid||Os.getegid()!=gid)
            throw new GeneralSecurityException("OWN_CALLING_PROCESS");
        String packageName=com.ynx.social.matrix.VeilAppIsolation.requireOwnedPackage(context);
        android.content.pm.ApplicationInfo info=context.getApplicationInfo();
        android.content.pm.ApplicationInfo installed=context.getPackageManager().getApplicationInfo(packageName,0);
        if(info==null||installed==null||info.uid!=uid||installed.uid!=uid||
            !packageName.equals(info.packageName)||!packageName.equals(installed.packageName))
            throw new GeneralSecurityException("OWN_INSTALLED_PACKAGE_UID");
        if(dataPin!=null){File actual=context.getDataDir();
            if(actual==null||!actual.isAbsolute())throw new GeneralSecurityException("OWN_CE_DATA_CHANGED");
            StructStat actualStat=Os.lstat(actual.getPath());frameworkPolicy(actualStat);
            if(actualStat.st_dev!=dataPin.dev||actualStat.st_ino!=dataPin.ino)
                throw new GeneralSecurityException("OWN_CE_DATA_CHANGED");
            if(dataInfoPin!=null){
                if(info.dataDir==null||installed.dataDir==null)throw new GeneralSecurityException("OWN_CE_DATA_CHANGED");
                File local=new File(info.dataDir),registered=new File(installed.dataDir);
                if(!local.isAbsolute()||!registered.isAbsolute())throw new GeneralSecurityException("OWN_CE_DATA_CHANGED");
                StructStat localStat=Os.lstat(local.getPath()),registeredStat=Os.lstat(registered.getPath());
                frameworkPolicy(localStat);frameworkPolicy(registeredStat);
                if(localStat.st_dev!=dataPin.dev||localStat.st_ino!=dataPin.ino||
                    registeredStat.st_dev!=dataPin.dev||registeredStat.st_ino!=dataPin.ino)
                    throw new GeneralSecurityException("OWN_CE_DATA_CHANGED");
            }
            verifyFrameworkPins();
        }
        UserManager u=context.getSystemService(UserManager.class);if(u==null||!u.isUserUnlocked())throw new GeneralSecurityException("OWN_USER_LOCKED");
    }
    private void lookup(KeyStore s)throws Exception{
        guard();Key k=s.getKey(alias,null);if(!(k instanceof SecretKey)||!"AES".equals(k.getAlgorithm()))throw new GeneralSecurityException("OWN_KEY_MISSING_NO_REGENERATION");
        SecretKey candidate=(SecretKey)k;KeyInfo i=(KeyInfo)SecretKeyFactory.getInstance("AES","AndroidKeyStore").getKeySpec(candidate,KeyInfo.class);
        VeilAndroidKeyStoreIdentity.profile(i);
        if(coreStorageAad!=null)coreKeyIdentity=VeilAndroidKeyStoreIdentity.pin(candidate,i);
        key=candidate; // Opaque platform key. NEVER getEncoded().
    }
    private int aad(byte[] a,boolean classic)throws Exception{
        if(coreStorageAad!=null)throw new GeneralSecurityException("OWN_KEY_PROFILE_REQUIRED");
        byte[] domain=classic?CLASSIC_DOMAIN:DOMAIN;
        if(a==null||a.length>7168)throw new GeneralSecurityException("OWN_AAD_BOUNDS");
        ByteBuffer b=ByteBuffer.wrap(a);if(b.remaining()<domain.length+20)throw new GeneralSecurityException("OWN_AAD_SHAPE");
        for(byte v:domain)if(b.get()!=v)throw new GeneralSecurityException("OWN_AAD_DOMAIN");
        if(b.getInt()!=1||b.getInt()!=(classic?1:87)||b.getLong()<1)throw new GeneralSecurityException("OWN_AAD_PROFILE");
        byte[] name=alias.getBytes(StandardCharsets.US_ASCII);int n=b.getInt();
        if(n!=name.length||b.remaining()<n+33+2592+4)throw new GeneralSecurityException("OWN_AAD_ALIAS");
        for(byte v:name)if(b.get()!=v)throw new GeneralSecurityException("OWN_AAD_ALIAS");
        if(b.get()!=5)throw new GeneralSecurityException("OWN_CLASSIC_PROFILE");b.position(b.position()+32+2592);
        int ownerBytes=b.getInt();if(ownerBytes<1||ownerBytes>4096||b.remaining()!=ownerBytes+(classic?4:0))throw new GeneralSecurityException("OWN_ASSOCIATION_BOUNDS");
        if(!classic)return 4896;b.position(b.position()+ownerBytes);int length=b.getInt();
        if(length<1||length>256)throw new GeneralSecurityException("OWN_CLASSIC_SERIALIZED_BOUNDS");return length;
    }
    private static void buffer(ByteBuffer b,int n,boolean writable)throws Exception{
        if(b==null||!b.isDirect()||b.capacity()!=n||b.position()!=0||b.limit()!=n||(writable&&b.isReadOnly()))throw new GeneralSecurityException("OWN_DIRECT_SPAN");
    }
    private static void wipe(ByteBuffer b){if(b!=null&&!b.isReadOnly())for(int i=0;i<b.capacity();i++)b.put(i,(byte)0);}
    private void ready()throws Exception{guard();if(initPrimary!=null)VeilOwnKeyPlatformProtector.<RuntimeException>rethrow(initPrimary);if(key==null)throw new GeneralSecurityException("OWN_PROTECTOR_CLOSED");}
    private static void provider(Cipher c)throws Exception{if(!c.getProvider().getName().startsWith("AndroidKeyStore"))throw new GeneralSecurityException("OWN_PROVIDER_PROFILE");}
    // JNI supplies direct native spans. No raw private byte[] method exists.
    private int seal(ByteBuffer clear,byte[] a,ByteBuffer nonce,ByteBuffer ciphertext)throws Exception{
        ready();int n=aad(a,false);return encrypt(clear,a,nonce,ciphertext,n);
    }
    private int sealClassic(ByteBuffer clear,byte[] a,ByteBuffer nonce,ByteBuffer ciphertext)throws Exception{
        ready();int n=aad(a,true);return encrypt(clear,a,nonce,ciphertext,n);
    }
    // OS protection of the independently registered V4 DEVICE key slot only.
    // Public binding validation is not trusted provenance or authorization.
    private int aadProductDeviceV4(byte[] a)throws Exception{
        if(coreStorageAad!=null)throw new GeneralSecurityException("OWN_KEY_PROFILE_REQUIRED");
        byte[] domain="YNX/SOCIAL/DEVICE-V4/PROTECTION/V1\0".getBytes(StandardCharsets.US_ASCII);
        byte[] name=alias.getBytes(StandardCharsets.US_ASCII);
        if(a==null||a.length>256||a.length!=domain.length+4+8+4+name.length+32+4)
            throw new GeneralSecurityException("DEVICE_V4_AAD_SHAPE");
        ByteBuffer b=ByteBuffer.wrap(a);
        for(byte v:domain)if(b.get()!=v)throw new GeneralSecurityException("DEVICE_V4_AAD_DOMAIN");
        // Generation is u64: preserve high-bit values, reject only all-zero.
        if(b.getInt()!=1||b.getLong()==0)throw new GeneralSecurityException("DEVICE_V4_AAD_PROFILE");
        if(b.getInt()!=name.length)throw new GeneralSecurityException("DEVICE_V4_AAD_ALIAS");
        for(byte v:name)if(b.get()!=v)throw new GeneralSecurityException("DEVICE_V4_AAD_ALIAS");
        int nonzero=0;for(int i=0;i<32;i++)nonzero|=b.get()&255;
        if(nonzero==0||b.getInt()!=204||b.hasRemaining())
            throw new GeneralSecurityException("DEVICE_V4_AAD_PROFILE");
        return 204;
    }
    // Native owns all secret spans. Controlled Java Cipher accesses clear direct
    // buffers; no assertion that Java cannot access this private material.
    private int sealProductDeviceV4Slot(ByteBuffer clear,byte[] a,ByteBuffer nonce,ByteBuffer ciphertext)throws Exception{
        boolean success=false;byte[] stable=null;
        try{
            stable=a==null?null:a.clone();ready();int size=aadProductDeviceV4(stable);
            int count=encrypt(clear,stable,nonce,ciphertext,size);
            ready();success=true;return count;
        }finally{
            if(stable!=null)Arrays.fill(stable,(byte)0);
            if(!success){
                ByteBuffer failedNonce=nonce==null?null:nonce.duplicate();if(failedNonce!=null)failedNonce.clear();wipe(failedNonce);
                ByteBuffer failedCipher=ciphertext==null?null:ciphertext.duplicate();if(failedCipher!=null)failedCipher.clear();wipe(failedCipher);
            }
        }
    }
    private int unsealProductDeviceV4Slot(ByteBuffer ciphertext,byte[] a,byte[] nonce,ByteBuffer clear)throws Exception{
        boolean success=false;byte[] stable=null;
        try{
            stable=a==null?null:a.clone();ready();int size=aadProductDeviceV4(stable);
            int count=decrypt(ciphertext,stable,nonce,clear,size);
            if(count!=size)return count;
            ready();success=true;return count;
        }finally{
            if(stable!=null)Arrays.fill(stable,(byte)0);
            if(!success){ByteBuffer failed=clear==null?null:clear.duplicate();if(failed!=null)failed.clear();wipe(failed);}
        }
    }
    // Independent fixed storage profile; do NOT widen classic IdentityKeyPair
    // bounds or expose private prekey records as byte[] to Java callers.
    private int sealInitialPreKey(ByteBuffer clear,byte[] a,ByteBuffer nonce,ByteBuffer ciphertext)throws Exception{
        boolean success=false;byte[] stable=a==null?null:a.clone();
        try{
            ready();if(coreStorageAad!=null)throw new GeneralSecurityException("OWN_KEY_PROFILE_REQUIRED");
            int n=VeilInitialPreKeyBinding.validate(alias,stable);
            int count=encrypt(clear,stable,nonce,ciphertext,n);
            ready();success=true;return count;
        }finally{if(stable!=null)Arrays.fill(stable,(byte)0);if(!success){wipe(nonce);wipe(ciphertext);}}
    }
    private int unsealInitialPreKey(ByteBuffer ciphertext,byte[] a,byte[] nonce,ByteBuffer clear)throws Exception{
        boolean success=false;byte[] stable=a==null?null:a.clone();
        try{
            ready();if(coreStorageAad!=null)throw new GeneralSecurityException("OWN_KEY_PROFILE_REQUIRED");
            int n=VeilInitialPreKeyBinding.validate(alias,stable);
            int count=decrypt(ciphertext,stable,nonce,clear,n);
            if(count!=n)return count;
            ready();success=true;return count;
        }finally{if(stable!=null)Arrays.fill(stable,(byte)0);if(!success)wipe(clear);}
    }
    private int sealCoreStorageKey(ByteBuffer clear,byte[] a,ByteBuffer nonce,ByteBuffer ciphertext)throws Exception{
        coreStorageCurrent();
        byte[] stable=VeilCoreStorageBinding.matchCopy(alias,a,coreStorageAad);
        boolean success=false;
        try{
            int count=encrypt(clear,stable,nonce,ciphertext,32);
            coreStorageCurrent();
            success=true;return count;
        }finally{
            Arrays.fill(stable,(byte)0);
            if(!success){wipe(nonce);wipe(ciphertext);}
        }
    }
    private int unsealCoreStorageKey(ByteBuffer ciphertext,byte[] a,byte[] nonce,ByteBuffer clear)throws Exception{
        coreStorageCurrent();
        byte[] stable=VeilCoreStorageBinding.matchCopy(alias,a,coreStorageAad);
        boolean success=false;
        try{
            int count=decrypt(ciphertext,stable,nonce,clear,32);
            if(count!=32)return count;
            coreStorageCurrent();
            success=true;return count;
        }finally{
            Arrays.fill(stable,(byte)0);
            if(!success)wipe(clear);
        }
    }

    // Ciphertext-only, write-once physical record. This is NOT a grant or an
    // independent rollback floor. Native admission must establish those facts.
    private Throwable closeCoreRecord(Throwable first){
        if(coreRecordFd==null)return first;
        Throwable failure=coreRecordCloseFailure;
        if(failure==null)try{Os.close(coreRecordFd);coreRecordFd=null;return first;}
        catch(Throwable t){coreRecordCloseFailure=t;failure=t;}
        if(first==null)return failure;
        if(first!=failure)try{first.addSuppressed(failure);}catch(Throwable ignored){}
        return first;
    }
    private StructStat coreRecordStat()throws Exception{
        StructStat s=Os.fstat(coreRecordFd);
        if(!OsConstants.S_ISREG(s.st_mode)||s.st_uid!=uid||s.st_gid!=gid||
            (s.st_mode&07777)!=0600||s.st_nlink!=1)
            throw new GeneralSecurityException("CORE_RECORD_PROFILE");
        return s;
    }
    private void coreRecordPath(File file,StructStat held)throws Exception{
        coreStorageCurrent();
        StructStat path=Os.lstat(file.getPath());
        if(path.st_dev!=held.st_dev||path.st_ino!=held.st_ino||
            !OsConstants.S_ISREG(path.st_mode)||path.st_nlink!=1)
            throw new GeneralSecurityException("CORE_RECORD_PATH_CHANGED");
    }
    private int persistCoreStorageKey(ByteBuffer wrapped)throws Exception{
        coreStorageCurrent();buffer(wrapped,60,false);
        if(coreRecordAttempted)throw new GeneralSecurityException("CORE_RECORD_NO_RETRY");
        coreRecordAttempted=true;
        byte[] bytes=new byte[60];wrapped.asReadOnlyBuffer().get(bytes);
        File file=new File(coreDirectoryPin.directory,alias+".wrapped");
        Throwable primary=null;
        try{
            coreStorageCurrent();
            coreRecordFd=Os.open(file.getPath(),OsConstants.O_WRONLY|OsConstants.O_CREAT|
                OsConstants.O_EXCL|OsConstants.O_NOFOLLOW|OsConstants.O_CLOEXEC,0600);
            StructStat held=coreRecordStat();coreRecordPath(file,held);
            int offset=0;
            while(offset<bytes.length){
                int n=Os.write(coreRecordFd,bytes,offset,bytes.length-offset);
                if(n<=0)throw new GeneralSecurityException("CORE_RECORD_SHORT_WRITE");
                offset+=n;
            }
            Os.fsync(coreRecordFd);
            StructStat written=coreRecordStat();
            if(written.st_size!=60)throw new GeneralSecurityException("CORE_RECORD_LENGTH");
            coreRecordPath(file,written);
            Os.fsync(coreDirectoryPin.fd);
            coreRecordPath(file,written);
        }catch(Throwable t){primary=t;}
        finally{Arrays.fill(bytes,(byte)0);primary=closeCoreRecord(primary);}
        if(primary!=null){coreRecordPrimary=primary;VeilOwnKeyPlatformProtector.<RuntimeException>rethrow(primary);}
        coreStorageCurrent();return 60;
    }
    private int readCoreStorageKey(ByteBuffer wrapped)throws Exception{
        coreStorageCurrent();buffer(wrapped,60,true);wipe(wrapped);
        if(coreRecordAttempted)throw new GeneralSecurityException("CORE_RECORD_NO_RETRY");
        coreRecordAttempted=true;
        byte[] bytes=new byte[60];
        File file=new File(coreDirectoryPin.directory,alias+".wrapped");
        Throwable primary=null;
        try{
            coreStorageCurrent();
            coreRecordFd=Os.open(file.getPath(),OsConstants.O_RDONLY|OsConstants.O_NOFOLLOW|OsConstants.O_CLOEXEC,0);
            StructStat held=coreRecordStat();
            if(held.st_size!=60)throw new GeneralSecurityException("CORE_RECORD_LENGTH");
            coreRecordPath(file,held);
            int offset=0;
            while(offset<bytes.length){
                int n=Os.read(coreRecordFd,bytes,offset,bytes.length-offset);
                if(n<=0)throw new GeneralSecurityException("CORE_RECORD_SHORT_READ");
                offset+=n;
            }
            StructStat after=coreRecordStat();
            if(after.st_size!=60)throw new GeneralSecurityException("CORE_RECORD_LENGTH");
            coreRecordPath(file,after);
        }catch(Throwable t){primary=t;}
        finally{primary=closeCoreRecord(primary);}
        try{
            if(primary!=null){coreRecordPrimary=primary;VeilOwnKeyPlatformProtector.<RuntimeException>rethrow(primary);}
            coreStorageCurrent();wrapped.duplicate().put(bytes);return 60;
        }finally{Arrays.fill(bytes,(byte)0);}
    }

    private int encrypt(ByteBuffer clear,byte[] a,ByteBuffer nonce,ByteBuffer ciphertext,int size)throws Exception{
        buffer(clear,size,false);buffer(nonce,12,true);buffer(ciphertext,size+16,true);
        byte[] copy=a.clone();boolean success=false;
        try {Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key);provider(c);
            byte[] iv=c.getIV();if(iv==null||iv.length!=12)throw new GeneralSecurityException("OWN_PROVIDER_NONCE");
            c.updateAAD(copy);int n=c.doFinal(clear.asReadOnlyBuffer(),ciphertext.duplicate());
            if(n!=size+16)throw new GeneralSecurityException("OWN_PROVIDER_TAG");nonce.duplicate().put(iv);success=true;return n;
        }finally{Arrays.fill(copy,(byte)0);if(!success){wipe(nonce);wipe(ciphertext);}}
    }
    private int unseal(ByteBuffer ciphertext,byte[] a,byte[] nonce,ByteBuffer clear)throws Exception{
        ready();int n=aad(a,false);return decrypt(ciphertext,a,nonce,clear,n);
    }
    private int unsealClassic(ByteBuffer ciphertext,byte[] a,byte[] nonce,ByteBuffer clear)throws Exception{
        ready();int n=aad(a,true);return decrypt(ciphertext,a,nonce,clear,n);
    }
    private int decrypt(ByteBuffer ciphertext,byte[] a,byte[] nonce,ByteBuffer clear,int size)throws Exception{
        buffer(ciphertext,size+16,false);buffer(clear,size,true);if(nonce==null||nonce.length!=12)throw new GeneralSecurityException("OWN_NONCE_BOUNDS");
        byte[] copy=a.clone();boolean success=false;
        try {Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,nonce));provider(c);c.updateAAD(copy);
            int n=c.doFinal(ciphertext.asReadOnlyBuffer(),clear.duplicate());if(n!=size)throw new GeneralSecurityException("OWN_AUTHENTICATED_LENGTH");success=true;return n;
        }catch(AEADBadTagException invalid){return -2; /* Known authentication refusal; no partial plaintext returned. */}
        finally {Arrays.fill(copy,(byte)0);if(!success)wipe(clear);}
    }
    private void cleanup(Throwable primary){key=null;coreKeyIdentity=null;boolean failed=false;
        try{if(lock!=null)lock.release();lock=null;}catch(Throwable x){failed=true;if(x!=primary)try{primary.addSuppressed(x);}catch(Throwable ignored){}}
        try{if(channel!=null)channel.close();channel=null;}catch(Throwable x){failed=true;if(x!=primary)try{primary.addSuppressed(x);}catch(Throwable ignored){}}
        try{if(stream!=null)stream.close();stream=null;}catch(Throwable x){failed=true;if(x!=primary)try{primary.addSuppressed(x);}catch(Throwable ignored){}}
        Throwable extra=closeFrameworkPins(closeAliasFd(null));
        if(extra!=null){failed=true;if(extra!=primary)try{primary.addSuppressed(extra);}catch(Throwable ignored){}}
        if(failed)closePrimary=primary; // retain fields + exact fatal primary, no automatic cleanup retry
    }
    private Throwable closeFrameworkPin(FrameworkPin pin,Throwable first){
        if(pin==null||pin.fd==null)return first;
        Throwable failure=pin.closeFailure;
        if(failure==null)try{Os.close(pin.fd);pin.fd=null;return first;}catch(Throwable t){pin.closeFailure=t;failure=t;}
        if(first==null)return failure;
        if(first!=failure)try{first.addSuppressed(failure);}catch(Throwable ignored){}
        return first; // Uncertain close never retries that descriptor.
    }
    private Throwable closeAliasFd(Throwable first){
        if(aliasFd==null)return first;
        Throwable failure=aliasCloseFailure;
        if(failure==null)try{Os.close(aliasFd);aliasFd=null;return first;}
        catch(Throwable t){aliasCloseFailure=t;failure=t;}
        if(first==null)return failure;
        if(first!=failure)try{first.addSuppressed(failure);}catch(Throwable ignored){}
        return first; // Retain uncertain FD and exact cause; never blindly retry.
    }
    private Throwable closeFrameworkPins(Throwable first){
        first=closeCoreRecord(first);
        first=closeFrameworkPin(coreDirectoryPin,first);
        first=closeFrameworkPin(noBackupPin,first);
        first=closeFrameworkPin(installedDataPin,first);
        first=closeFrameworkPin(dataInfoPin,first);return closeFrameworkPin(dataPin,first);
    }
    @SuppressWarnings("unchecked") private static <T extends Throwable> void rethrow(Throwable t)throws T {throw (T)t;}
    @Override public void close()throws Exception{
        if(Thread.currentThread()!=owner)throw new GeneralSecurityException("OWN_WRONG_WORKER");
        if(closePrimary!=null)VeilOwnKeyPlatformProtector.<RuntimeException>rethrow(closePrimary);
        key=null;coreKeyIdentity=null;Throwable first=null;try{if(lock!=null)lock.release();lock=null;}catch(Throwable t){first=t;}
        try{if(channel!=null)channel.close();channel=null;}catch(Throwable t){if(first==null)first=t;else if(first!=t)try{first.addSuppressed(t);}catch(Throwable ignored){}}
        try{if(stream!=null)stream.close();stream=null;}catch(Throwable t){if(first==null)first=t;else if(first!=t)try{first.addSuppressed(t);}catch(Throwable ignored){}}
        first=closeFrameworkPins(closeAliasFd(first));
        if(first!=null){closePrimary=first;VeilOwnKeyPlatformProtector.<RuntimeException>rethrow(first);}
    }
}

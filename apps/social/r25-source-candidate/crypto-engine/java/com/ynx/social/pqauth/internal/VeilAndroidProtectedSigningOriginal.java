package com.ynx.social.pqauth.internal;

import android.content.Context;
import android.os.Build;
import android.os.Process;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import com.ynx.social.matrix.VeilAppIsolation;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.util.Arrays;

/** Read-only original-key primitive for a future fixed protected producer.
 * An expected public key is a comparison input, NEVER enrollment or authority.
 * No signing API: the genuine counter-command/authorizer contract is not supplied.
 * No generator/importer/setter, private export, hidden API, Root or Source output.
 * This class is NOT selected as a held backend and cannot clear its missing bits.
 */
final class VeilAndroidProtectedSigningOriginal implements AutoCloseable {
    private final Thread worker=Thread.currentThread();
    private final Context context;
    private final int uid=Process.myUid(),pid=Process.myPid();
    private final String alias;
    private final byte[] publicKey;
    private final long deadline;
    private PrivateKey original;
    private Policy policy;
    private Throwable first;
    private boolean closed;

    private static final class Policy {
        final int level,authType,authSeconds,usage;
        final boolean auth,hardwareAuth,onBody,presence,confirmation,biometricInvalidation;
        final String[] digests,paddings;
        final Long start,originationEnd,consumptionEnd;
        Policy(KeyInfo i)throws GeneralSecurityException{
            level=i.getSecurityLevel();
            if((level!=KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT&&level!=KeyProperties.SECURITY_LEVEL_STRONGBOX)||
                !i.isInsideSecureHardware()||i.getOrigin()!=KeyProperties.ORIGIN_GENERATED||
                i.getKeySize()!=256||i.getPurposes()!=KeyProperties.PURPOSE_SIGN)
                throw new GeneralSecurityException("PROTECTED_SIGNING_ORIGINAL_PROFILE_UNAVAILABLE");
            auth=i.isUserAuthenticationRequired();hardwareAuth=i.isUserAuthenticationRequirementEnforcedBySecureHardware();
            authType=i.getUserAuthenticationType();authSeconds=i.getUserAuthenticationValidityDurationSeconds();
            usage=i.getRemainingUsageCount();onBody=i.isUserAuthenticationValidWhileOnBody();
            presence=i.isTrustedUserPresenceRequired();confirmation=i.isUserConfirmationRequired();
            biometricInvalidation=i.isInvalidatedByBiometricEnrollment();
            String[] d=i.getDigests(),p=i.getSignaturePaddings();
            if(d==null||p==null)throw new GeneralSecurityException("PROTECTED_SIGNING_ORIGINAL_POLICY_UNAVAILABLE");
            digests=d.clone();paddings=p.clone();Arrays.sort(digests);Arrays.sort(paddings);
            start=time(i.getKeyValidityStart());originationEnd=time(i.getKeyValidityForOriginationEnd());
            consumptionEnd=time(i.getKeyValidityForConsumptionEnd());
        }
        private static Long time(java.util.Date d){return d==null?null:d.getTime();}
        boolean same(Policy p){
            return level==p.level&&auth==p.auth&&hardwareAuth==p.hardwareAuth&&authType==p.authType&&
                authSeconds==p.authSeconds&&usage==p.usage&&onBody==p.onBody&&presence==p.presence&&
                confirmation==p.confirmation&&biometricInvalidation==p.biometricInvalidation&&
                Arrays.equals(digests,p.digests)&&Arrays.equals(paddings,p.paddings)&&
                java.util.Objects.equals(start,p.start)&&java.util.Objects.equals(originationEnd,p.originationEnd)&&
                java.util.Objects.equals(consumptionEnd,p.consumptionEnd);
        }
    }
    private VeilAndroidProtectedSigningOriginal(Context c,String a,byte[] expected,long until){
        context=c;alias=a;publicKey=expected.clone();deadline=until;
    }
    // Native fixed producer must independently bind these originals to its
    // enrolled association and Core deadline. Caller bytes cannot do that here.
    static VeilAndroidProtectedSigningOriginal acquire(Context c,String alias,byte[] expectedSpki,long deadline)throws Exception{
        if(Build.VERSION.SDK_INT<31||alias==null||alias.isEmpty()||alias.length()>512||alias.indexOf('\0')>=0||
            expectedSpki==null||expectedSpki.length<1||expectedSpki.length>4096||deadline<=0)
            throw new GeneralSecurityException("PROTECTED_SIGNING_ORIGINAL_REQUIRED");
        VeilAndroidProtectedSigningOriginal p=new VeilAndroidProtectedSigningOriginal(c,alias,expectedSpki,deadline);
        p.guard();KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        PrivateKey selected=p.read(store);p.policy=p.policy(selected);p.original=selected;
        p.current();return p;
    }
    private void guard()throws Exception{
        if(Thread.currentThread()!=worker)throw new GeneralSecurityException("PROTECTED_SIGNING_WRONG_WORKER");
        if(closed)throw new GeneralSecurityException("PROTECTED_SIGNING_ORIGINAL_CLOSED");
        if(Process.myUid()!=uid||Process.myPid()!=pid)throw new GeneralSecurityException("PROTECTED_SIGNING_PROCESS_CHANGED");
        VeilAppIsolation.requireOwnedPackage(context);
        // Android System.nanoTime uses CLOCK_MONOTONIC, matching Core;
        // elapsedRealtimeNanos includes suspend and is a different clock.
        long now=System.nanoTime();
        if(now<0||now>=deadline)throw new GeneralSecurityException("PROTECTED_SIGNING_ORIGINAL_EXPIRED");
    }
    private PrivateKey read(KeyStore store)throws Exception{
        Key key=store.getKey(alias,null);
        if(!(key instanceof PrivateKey)||!"EC".equals(key.getAlgorithm())||
            !"android.security.keystore2.AndroidKeyStoreECPrivateKey".equals(key.getClass().getName())||
            key.getClass().getClassLoader()!=KeyInfo.class.getClassLoader())
            throw new GeneralSecurityException("PROTECTED_SIGNING_KEY_CONTINUITY_UNAVAILABLE");
        Certificate cert=store.getCertificate(alias);
        // Only PUBLIC SubjectPublicKeyInfo is encoded; no private getEncoded.
        if(cert==null||cert.getPublicKey()==null||!"EC".equals(cert.getPublicKey().getAlgorithm())||
            !Arrays.equals(publicKey,cert.getPublicKey().getEncoded()))
            throw new GeneralSecurityException("PROTECTED_SIGNING_PUBLIC_ORIGINAL_MISMATCH");
        return (PrivateKey)key;
    }
    private Policy policy(PrivateKey key)throws Exception{
        return new Policy(KeyFactory.getInstance("EC","AndroidKeyStore").getKeySpec(key,KeyInfo.class));
    }
    void current()throws Exception{
        if(Thread.currentThread()!=worker)throw new GeneralSecurityException("PROTECTED_SIGNING_WRONG_WORKER");
        if(first!=null)VeilAndroidProtectedSigningOriginal.<RuntimeException>rethrow(first);
        try{
            guard();KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
            PrivateKey selected=read(store);
            if(original==null||selected.getClass()!=original.getClass()||!original.equals(selected)||!selected.equals(original))
                throw new GeneralSecurityException("PROTECTED_SIGNING_KEY_REPLACED");
            if(policy==null||!policy.same(policy(selected)))
                throw new GeneralSecurityException("PROTECTED_SIGNING_POLICY_CHANGED");
            guard();
        }catch(Throwable primary){first=primary;VeilAndroidProtectedSigningOriginal.<RuntimeException>rethrow(primary);}
    }
    @Override public void close()throws GeneralSecurityException{
        if(Thread.currentThread()!=worker)throw new GeneralSecurityException("PROTECTED_SIGNING_WRONG_WORKER");
        closed=true;original=null;policy=null; // reference release only; no key delete, signing or business retry
    }
    @SuppressWarnings("unchecked")private static <T extends Throwable>void rethrow(Throwable t)throws T{throw(T)t;}
}

package com.ynxweb4.wallet;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Binder;
import android.os.Build;
import android.os.Process;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** The app identity check for the protected DEVICE service. Call on the Binder thread. */
final class DeviceApprovalPeer {
    private final PackageManager packages;
    private final String packageName;
    private final byte[] certificateDigest;

    DeviceApprovalPeer(PackageManager packages, String packageName, byte[] certificateDigest) {
        if (packageName == null || packageName.isEmpty()
                || certificateDigest == null || certificateDigest.length != 32) {
            throw new IllegalArgumentException("A fixed DEVICE peer is required");
        }
        this.packages = packages;
        this.packageName = packageName;
        this.certificateDigest = certificateDigest.clone();
    }

    int requireCaller() {
        int uid = Binder.getCallingUid();
        if (uid == Process.myUid() || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            throw denied();
        }
        String[] names = packages.getPackagesForUid(uid);
        if (names == null || names.length != 1 || !packageName.equals(names[0])) {
            throw denied();
        }
        try {
            @SuppressWarnings("deprecation")
            PackageInfo info = packages.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
            if (!packageName.equals(info.packageName) || info.applicationInfo == null
                    || info.applicationInfo.uid != uid || info.sharedUserId != null) {
                throw denied();
            }
            SigningInfo signing = info.signingInfo;
            Signature[] current = signing == null ? null : signing.getApkContentsSigners();
            if (current == null || current.length != 1
                    || !MessageDigest.isEqual(certificateDigest,
                        MessageDigest.getInstance("SHA-256").digest(current[0].toByteArray()))) {
                throw denied();
            }
            return uid;
        } catch (PackageManager.NameNotFoundException | NoSuchAlgorithmException failure) {
            throw denied();
        }
    }

    private static SecurityException denied() {
        return new SecurityException("DEVICE approval peer not verified");
    }
}

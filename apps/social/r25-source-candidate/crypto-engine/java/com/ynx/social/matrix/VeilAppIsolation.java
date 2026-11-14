package com.ynx.social.matrix;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Process;
import android.system.Os;
import java.security.GeneralSecurityException;

/** Local app-container qualification only, never account/device/source trust.
 * The QA identity has its own UID, CE storage and AndroidKeyStore namespace.
 * No caller-selected package, shared UID, external path or migration is allowed.
 */
public final class VeilAppIsolation {
    private VeilAppIsolation() {}

    static boolean matchesIdentity(String name, int uid, int actualUid,
            int installedUid, String declaredName, String installedName,
            int flags, int installedFlags, String[] packages) {
        if (!("com.ynx.social".equals(name) || "com.ynx.social.veilqa".equals(name) || "com.ynx.social.m1qa".equals(name))) return false;
        if (uid < 10000 || uid != actualUid || uid != installedUid ||
                !name.equals(declaredName) || !name.equals(installedName) ||
                packages == null || packages.length != 1 || !name.equals(packages[0])) return false;
        return "com.ynx.social".equals(name) ||
                ((flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0 &&
                 (installedFlags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
    }

    public static String requireOwnedPackage(Context context) throws Exception {
        if (context == null || context.getApplicationContext() != context || context.isDeviceProtectedStorage())
            throw new GeneralSecurityException("SOCIAL_APP_PRIVATE_CONTEXT_REQUIRED");
        String name = context.getPackageName();
        if (!("com.ynx.social".equals(name) || "com.ynx.social.veilqa".equals(name) || "com.ynx.social.m1qa".equals(name)))
            throw new GeneralSecurityException("SOCIAL_APP_PACKAGE_REFUSED");
        int uid = Process.myUid();
        ApplicationInfo own = context.getApplicationInfo();
        ApplicationInfo installed = context.getPackageManager().getApplicationInfo(name, 0);
        if (own == null || installed == null || Os.getuid() != uid || Os.geteuid() != uid ||
                !matchesIdentity(name, uid, own.uid, installed.uid, own.packageName,
                    installed.packageName, own.flags, installed.flags,
                    context.getPackageManager().getPackagesForUid(uid)))
            throw new GeneralSecurityException("SOCIAL_APP_EXCLUSIVE_UID_REQUIRED");
        return name;
    }
}

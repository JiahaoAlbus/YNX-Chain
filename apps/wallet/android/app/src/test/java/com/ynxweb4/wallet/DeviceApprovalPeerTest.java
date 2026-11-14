package com.ynxweb4.wallet;

import java.security.MessageDigest;
import junit.framework.TestCase;

public final class DeviceApprovalPeerTest extends TestCase {
    public void testIdentityComparisonIncludesUidPackageAndSigner() {
        byte[] digest = new byte[32];
        byte[] differentDigest = new byte[32]; differentDigest[0] = 1;
        assertTrue(DeviceApprovalPeer.sameIdentity(101,"original.app",digest,101,"original.app",digest.clone()));
        assertFalse(DeviceApprovalPeer.sameIdentity(101,"original.app",digest,102,"original.app",digest));
        assertFalse(DeviceApprovalPeer.sameIdentity(101,"original.app",digest,101,"other.app",digest));
        assertFalse(DeviceApprovalPeer.sameIdentity(101,"original.app",digest,101,"original.app",differentDigest));
    }
    public void testOriginalUidPackageAndSignerMustAllStillMatch() throws Exception {
        byte[] signer = new byte[]{1,2,3};
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(signer);
        assertTrue(DeviceApprovalPeer.sameOriginalPackage("original.app",digest,101,
            new String[]{"original.app"},"original.app",101,null,signer));
        assertFalse(DeviceApprovalPeer.sameOriginalPackage("original.app",digest,101,
            new String[]{"original.app"},"original.app",102,null,signer));
        assertFalse(DeviceApprovalPeer.sameOriginalPackage("original.app",digest,101,
            new String[]{"original.app","other.app"},"original.app",101,null,signer));
        assertFalse(DeviceApprovalPeer.sameOriginalPackage("original.app",digest,101,
            new String[]{"other.app"},"original.app",101,null,signer));
        assertFalse(DeviceApprovalPeer.sameOriginalPackage("original.app",digest,101,
            new String[]{"original.app"},"original.app",101,"shared",signer));
        assertFalse(DeviceApprovalPeer.sameOriginalPackage("original.app",digest,101,
            new String[]{"original.app"},"original.app",101,null,new byte[]{3,2,1}));
    }
}

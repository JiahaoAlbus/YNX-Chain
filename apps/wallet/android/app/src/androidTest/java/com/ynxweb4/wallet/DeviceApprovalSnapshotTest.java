package com.ynxweb4.wallet;

import android.content.Context;
import android.content.ContextWrapper;
import android.test.AndroidTestCase;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.UUID;

/** Uses a fresh no-backup directory; never opens the user's journal. */
public final class DeviceApprovalSnapshotTest extends AndroidTestCase {
    public void testOriginalSnapshotAndBinding() throws Exception {
        File directory = new File(getContext().getCacheDir(), "device-snapshot-" + UUID.randomUUID());
        assertTrue(directory.mkdir());
        Context isolated = new ContextWrapper(getContext()) {
            @Override public File getNoBackupFilesDir() { return directory; }
        };
        DeviceApprovalJournal journal = new DeviceApprovalJournal(isolated);
        byte[] binding = {1, 2, 3};
        try {
            assertNull(journal.readSnapshot("original", binding));
            assertTrue(journal.enter("original", binding));
            byte[][] entered = journal.readSnapshot("original", binding);
            assertEquals(7, entered.length);
            assertNull(entered[0]);
            assertNull(entered[3]);
            assertEquals(0, entered[6][0]);
            try {
                journal.readSnapshot("original", new byte[]{9});
                fail("Different binding must never read the original row");
            } catch (IllegalStateException expected) { }
            assertTrue(journal.claimKeyAttempt("original", binding));
            byte[] receipt = new byte[88];
            ByteBuffer values = ByteBuffer.wrap(receipt).order(ByteOrder.LITTLE_ENDIAN);
            values.putInt(0, 1); values.putInt(4, 88); values.putInt(8, 1);
            values.putInt(12, 1); values.putInt(20, 2); values.putInt(24, 1);
            values.putInt(28, 1); values.putInt(60, 1);
            journal.recordReceipt("original", binding, receipt);
            journal.retain("original", binding, new byte[]{4}, new byte[24]);
            byte[][] retained = journal.readSnapshot("original", binding);
            assertTrue(Arrays.equals(receipt, retained[0]));
            assertTrue(Arrays.equals(new byte[]{4}, retained[1]));
            assertNull(retained[3]);
            assertEquals(1, retained[6][0]);
            java.util.concurrent.atomic.AtomicReference<Throwable> commitError =
                new java.util.concurrent.atomic.AtomicReference<>();
            java.util.concurrent.CountDownLatch start = new java.util.concurrent.CountDownLatch(1);
            Thread writer = new Thread(() -> {
                try {
                    start.await();
                    journal.commitVerified("original", binding, new byte[]{4},
                        new byte[]{5}, new byte[]{6}, new byte[]{7});
                } catch (Throwable error) { commitError.set(error); }
            });
            writer.start();
            start.countDown();
            for (int i = 0; i < 100; i++) {
                byte[][] concurrent = journal.readSnapshot("original", binding);
                assertNotNull(concurrent);
                // A single read must see either all three originals or none.
                assertEquals(concurrent[3] == null, concurrent[4] == null);
                assertEquals(concurrent[3] == null, concurrent[5] == null);
            }
            writer.join();
            if (commitError.get() != null) throw new AssertionError(commitError.get());
            byte[][] committed = journal.readSnapshot("original", binding);
            assertTrue(Arrays.equals(new byte[]{5}, committed[3]));
            assertTrue(Arrays.equals(new byte[]{6}, committed[4]));
            assertTrue(Arrays.equals(new byte[]{7}, committed[5]));
            // Previously returned snapshots are not rewritten by a later commit.
            assertNull(retained[3]);
            assertNull(entered[0]);
            assertFalse(journal.claimKeyAttempt("original", binding));
            assertTrue(journal.enter("partial", binding));
            journal.getWritableDatabase().execSQL(
                "UPDATE approval_attempt SET approval_original = ? WHERE operation = ?",
                new Object[]{new byte[]{5}, "partial"});
            try {
                journal.readSnapshot("partial", binding);
                fail("A partial commit must not appear as a complete approval");
            } catch (IllegalArgumentException expected) { }
        } finally {
            journal.close();
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) file.delete();
            directory.delete();
        }
    }
}

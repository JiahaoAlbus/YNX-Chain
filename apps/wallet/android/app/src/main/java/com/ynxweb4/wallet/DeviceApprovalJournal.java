package com.ynxweb4.wallet;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;

/** Private storage for one original DEVICE sign attempt. Called by the Wallet actor. */
final class DeviceApprovalJournal extends SQLiteOpenHelper {
    private static final int RECEIPT_SIZE = 88;
    private static final int FAILURE_SIZE = 24;
    private static final int MAX_MEMBER_SIZE = 98304;
    private static final int MAX_APPROVAL_SIZE = 196608;
    private static final int MAX_POLICY_SIZE = 524288;
    private static final int MAX_REQUEST_SIZE = 262144;
    private static final String TABLE = "approval_attempt";
    private static final String KEY = "operation = ?";
    private static final String CLAIM_COLUMN =
        "key_claimed INTEGER NOT NULL DEFAULT 0 CHECK (key_claimed IN (0, 1))";
    private static final String[] ORIGINAL_COLUMNS = {
        "approval_original", "policy_original", "request_original"
    };
    private static final String[] COMMIT_COLUMNS = {
        "binding", "receipt", "member", "first_failure", "key_claimed",
        ORIGINAL_COLUMNS[0], ORIGINAL_COLUMNS[1], ORIGINAL_COLUMNS[2]
    };

    DeviceApprovalJournal(Context context) {
        // Do not restore an ENTERED row or a key-attempt receipt onto another device.
        super(context, new java.io.File(context.getNoBackupFilesDir(),
            "device-approval-v4.db").getAbsolutePath(), null, 3);
    }

    @Override public void onConfigure(SQLiteDatabase db) {
        db.execSQL("PRAGMA synchronous=FULL");
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE + " (operation TEXT PRIMARY KEY NOT NULL,"
            + " binding BLOB NOT NULL, receipt BLOB, member BLOB, first_failure BLOB, " + CLAIM_COLUMN
            + ", " + ORIGINAL_COLUMNS[0] + " BLOB, " + ORIGINAL_COLUMNS[1] + " BLOB, "
            + ORIGINAL_COLUMNS[2] + " BLOB)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if ((oldVersion != 1 && oldVersion != 2) || newVersion != 3) {
            throw new IllegalStateException("Unsupported DEVICE journal version");
        }
        if (oldVersion == 1) {
            db.execSQL("ALTER TABLE " + TABLE + " ADD COLUMN " + CLAIM_COLUMN);
            // Old ENTERED rows may already have reached the signer.
            db.execSQL("UPDATE " + TABLE + " SET key_claimed = 1");
        }
        for (String column : ORIGINAL_COLUMNS) {
            db.execSQL("ALTER TABLE " + TABLE + " ADD COLUMN " + column + " BLOB");
        }
    }

    /**
     * Persist ENTERED before calling the signer. Binding is the protected
     * holder's canonical original (peer, account/revision, DEVICE, PAIR and request).
     * False means an earlier entry exists. It never permits another attempt.
     */
    boolean enter(String operation, byte[] binding) {
        byte[] expected = binding.clone();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        boolean inserted;
        try {
            ContentValues values = new ContentValues();
            values.put("operation", operation);
            values.put("binding", expected);
            inserted = db.insertWithOnConflict(TABLE, null, values,
                SQLiteDatabase.CONFLICT_IGNORE) != -1;
            requireEqual(expected, readColumn(db, operation, "binding"));
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        requireEqual(expected, readColumn(db, operation, "binding"));
        return inserted;
    }

    /** Persist the only key-loan selection before opening OS custody. */
    boolean claimKeyAttempt(String operation, byte[] binding) {
        byte[] expected = binding.clone();
        SQLiteDatabase db = getWritableDatabase();
        boolean selected;
        db.beginTransaction();
        try {
            requireEqual(expected, readColumn(db, operation, "binding"));
            ContentValues values = new ContentValues();
            values.put("key_claimed", 1);
            selected = db.update(TABLE, values,
                KEY + " AND key_claimed = 0 AND receipt IS NULL AND member IS NULL"
                    + " AND first_failure IS NULL",
                new String[]{operation}) == 1;
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        if (selected) {
            try (Cursor row = db.query(TABLE, new String[]{"binding", "key_claimed"},
                    KEY, new String[]{operation}, null, null, null)) {
                if (!row.moveToFirst() || row.getInt(1) != 1) {
                    throw new IllegalStateException("Original DEVICE key claim unavailable");
                }
                requireEqual(expected, row.getBlob(0));
            }
        }
        return selected;
    }

    /** Storage-only, valid after retirement. Identical readback is idempotent. */
    void recordReceipt(String operation, byte[] binding, byte[] receipt) {
        byte[] exact = receipt.clone();
        ByteBuffer data = receiptData(exact);
        if (data.getInt(0) != 1 || data.getInt(4) != RECEIPT_SIZE) {
            throw new IllegalArgumentException("Invalid native DEVICE receipt header");
        }
        save(operation, binding, new String[]{"receipt"}, new byte[][]{exact});
    }

    /** Persist bounded original Member and the first F24 together, even after a receipt failure. */
    void retain(String operation, byte[] binding, byte[] member, byte[] firstFailure) {
        if (member.length > MAX_MEMBER_SIZE || firstFailure.length != FAILURE_SIZE) {
            throw new IllegalArgumentException("Invalid original DEVICE attempt result");
        }
        save(operation, binding, new String[]{"member", "first_failure"},
            new byte[][]{member.clone(), firstFailure.clone()});
    }

    /**
     * Readback only. The caller still verifies the exact original Member and
     * rechecks the current account and policy before any approval commit.
     */
    boolean hasCleanAttempt(String operation, byte[] binding) {
        byte[][] attempt = readAttempt(operation, binding);
        return attempt != null && cleanAttempt(attempt[0], attempt[1], attempt[2]);
    }

    /** Storage port for the original protected review after verify-and-attach. */
    void commitVerified(String operation, byte[] binding, byte[] member, byte[] approvalOriginal,
            byte[] policyOriginal, byte[] requestOriginal) {
        byte[] expectedBinding = binding.clone();
        byte[] expectedMember = member.clone();
        byte[][] originals = {
            exactOriginal(approvalOriginal, MAX_APPROVAL_SIZE),
            exactOriginal(policyOriginal, MAX_POLICY_SIZE),
            exactOriginal(requestOriginal, MAX_REQUEST_SIZE)
        };
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try (Cursor row = readCommitRow(db, operation)) {
            if (!row.moveToFirst()) throw new IllegalStateException("Original DEVICE operation unavailable");
            requireEqual(expectedBinding, row.getBlob(0));
            requireEqual(expectedMember, row.getBlob(2));
            requireCleanCommit(row);
            byte[][] saved = readOriginals(row);
            if (saved.length == 0) {
                ContentValues update = new ContentValues();
                for (int i = 0; i < ORIGINAL_COLUMNS.length; i++) {
                    update.put(ORIGINAL_COLUMNS[i], originals[i]);
                }
                if (db.update(TABLE, update, KEY, new String[]{operation}) != 1) {
                    throw new IllegalStateException("Original DEVICE approval commit unavailable");
                }
            } else {
                requireEqualOriginals(originals, saved);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        requireEqualOriginals(originals, readCommitted(operation, expectedBinding));
    }

    /** Null is absent, zero originals is ENTERED, three originals is COMMITTED. */
    byte[][] readCommitted(String operation, byte[] binding) {
        try (Cursor row = readCommitRow(getReadableDatabase(), operation)) {
            if (!row.moveToFirst()) return null;
            requireEqual(binding, row.getBlob(0));
            byte[][] originals = readOriginals(row);
            if (originals.length != 0) requireCleanCommit(row);
            return originals;
        }
    }

    /** One row and one SQLite snapshot; null means absent, never an inferred retry. */
    byte[][] readSnapshot(String operation, byte[] binding) {
        try (Cursor row = readCommitRow(getReadableDatabase(), operation)) {
            if (!row.moveToFirst()) return null;
            requireEqual(binding, row.getBlob(0));
            int claimed = row.getInt(4);
            if (claimed != 0 && claimed != 1) {
                throw new IllegalStateException("Invalid DEVICE key claim");
            }
            byte[][] originals = readOriginals(row);
            if (originals.length != 0) requireCleanCommit(row);
            return new byte[][]{row.getBlob(1), row.getBlob(2), row.getBlob(3),
                originals.length == 0 ? null : originals[0],
                originals.length == 0 ? null : originals[1],
                originals.length == 0 ? null : originals[2], new byte[]{(byte) claimed}};
        }
    }

    private static Cursor readCommitRow(SQLiteDatabase db, String operation) {
        return db.query(TABLE, COMMIT_COLUMNS, KEY, new String[]{operation}, null, null, null);
    }

    private static void requireCleanCommit(Cursor row) {
        if (row.getInt(4) != 1 || !cleanAttempt(row.getBlob(1), row.getBlob(2), row.getBlob(3))) {
            throw new IllegalStateException("Original DEVICE attempt cannot commit");
        }
    }

    private static byte[][] readOriginals(Cursor row) {
        byte[] approval = row.getBlob(5), policy = row.getBlob(6), request = row.getBlob(7);
        if (approval == null && policy == null && request == null) return new byte[0][];
        requireOriginal(approval, MAX_APPROVAL_SIZE);
        requireOriginal(policy, MAX_POLICY_SIZE);
        requireOriginal(request, MAX_REQUEST_SIZE);
        return new byte[][]{approval, policy, request};
    }

    private static byte[] exactOriginal(byte[] bytes, int limit) {
        requireOriginal(bytes, limit);
        return bytes.clone();
    }

    private static void requireOriginal(byte[] bytes, int limit) {
        if (bytes == null || bytes.length == 0 || bytes.length > limit) {
            throw new IllegalArgumentException("Invalid verified DEVICE original");
        }
    }

    private static void requireEqualOriginals(byte[][] expected, byte[][] actual) {
        if (!Arrays.deepEquals(expected, actual)) {
            throw new IllegalStateException("Original DEVICE approval differs");
        }
    }

    private static boolean cleanAttempt(byte[] receipt, byte[] member, byte[] first) {
        return receipt != null && member != null && member.length > 0 && member.length <= MAX_MEMBER_SIZE
            && first != null && noFailure(receiptData(first, FAILURE_SIZE), 0) && cleanReceipt(receipt);
    }

    /** Null is absent. A row with absent evidence is still ENTERED. */
    byte[][] readAttempt(String operation, byte[] binding) {
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor row = db.query(TABLE, new String[]{"binding", "receipt", "member", "first_failure"},
                KEY, new String[]{operation}, null, null, null)) {
            if (!row.moveToFirst()) return null;
            requireEqual(binding, row.getBlob(0));
            return new byte[][]{row.getBlob(1), row.getBlob(2), row.getBlob(3)};
        }
    }

    private void save(String operation, byte[] binding, String[] columns, byte[][] values) {
        byte[] expected = binding.clone();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            requireEqual(expected, readColumn(db, operation, "binding"));
            ContentValues update = new ContentValues();
            for (int i = 0; i < columns.length; i++) {
                byte[] saved = readColumn(db, operation, columns[i]);
                if (saved == null) update.put(columns[i], values[i]);
                else requireEqual(values[i], saved);
            }
            if (update.size() > 0 && db.update(TABLE, update, KEY, new String[]{operation}) != 1) {
                throw new IllegalStateException("Original DEVICE operation unavailable");
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        for (int i = 0; i < columns.length; i++) {
            requireEqual(values[i], readColumn(db, operation, columns[i]));
        }
    }

    private static byte[] readColumn(SQLiteDatabase db, String operation, String column) {
        try (Cursor row = db.query(TABLE, new String[]{column}, KEY,
                new String[]{operation}, null, null, null)) {
            return row.moveToFirst() ? row.getBlob(0) : null;
        }
    }

    private static void requireEqual(byte[] expected, byte[] actual) {
        if (!Arrays.equals(expected, actual)) {
            throw new IllegalStateException("Original DEVICE evidence differs");
        }
    }

    static boolean cleanReceipt(byte[] receipt) {
        ByteBuffer data = receiptData(receipt);
        // Native receipt88: Core return and OS physical drain are independent.
        return data.getInt(0) == 1 && data.getInt(4) == RECEIPT_SIZE
            && data.getInt(8) == 1 && data.getInt(12) == 1
            && data.getInt(16) == 0 && data.getInt(20) == 2
            && data.getInt(24) == 1 && data.getInt(28) == 1
            && data.getInt(56) == 0 && data.getInt(60) == 1
            && noFailure(data, 32) && noFailure(data, 64);
    }

    private static ByteBuffer receiptData(byte[] receipt) {
        return receiptData(receipt, RECEIPT_SIZE);
    }

    private static ByteBuffer receiptData(byte[] receipt, int size) {
        if (receipt.length != size) {
            throw new IllegalArgumentException("Invalid native DEVICE receipt size");
        }
        return ByteBuffer.wrap(receipt).order(ByteOrder.LITTLE_ENDIAN);
    }

    private static boolean noFailure(ByteBuffer data, int offset) {
        // F24 has four bytes of ABI padding. Compare its actual fields.
        return data.getInt(offset) == 0 && data.getInt(offset + 4) == 0
            && data.getInt(offset + 8) == 0 && data.getLong(offset + 16) == 0;
    }
}

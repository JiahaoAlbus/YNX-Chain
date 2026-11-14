package com.ynx.social.matrix

import android.database.Cursor
import android.database.CursorWindow
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.os.Build

private fun nativeRecordFactory(): SQLiteDatabase.CursorFactory = SQLiteDatabase.CursorFactory { _, driver, editTable, query ->
    check(Build.VERSION.SDK_INT >= 28) { "VEIL_NATIVE_RECORD_WINDOW_API_UNAVAILABLE" }
    val cursor = SQLiteCursor(driver, editTable, query)
    try {
        cursor.setWindow(CursorWindow("veil-bounded-record",
            VeilRecordBudget.MAX_SEALED_BYTES.toLong() + 64L * 1024))
        cursor
    } catch (failure: Throwable) {
        try { cursor.close() }
        catch (cleanup: Throwable) { if (cleanup !== failure) failure.addSuppressed(cleanup) }
        throw failure
    }
}

/** Private payload cursors only; no cursor is supplied to callback capabilities. */
internal fun veilNativeRecordCursor(
    database: SQLiteDatabase,
    statement: String,
    arguments: Array<String>?,
): Cursor = database.rawQueryWithFactory(nativeRecordFactory(), statement, arguments, "")

internal fun veilNativeRecordQuery(
    database: SQLiteDatabase,
    table: String,
    columns: Array<String>?,
    selection: String?,
    selectionArguments: Array<String>?,
    groupBy: String?,
    having: String?,
    orderBy: String?,
    limit: String? = null,
): Cursor = database.queryWithFactory(nativeRecordFactory(), false, table, columns,
    selection, selectionArguments, groupBy, having, orderBy, limit)

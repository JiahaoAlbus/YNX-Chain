package com.ynx.social.matrix

import android.content.ContentValues
import android.database.Cursor
import android.database.CursorWindow
import android.os.Build
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteQuery
import android.database.sqlite.SQLiteProgram

/** Private executor. No cursor, database or deferred iterator leaves this adapter. */
internal class VeilNativeSqlSnapshot(
    private val database: SQLiteDatabase,
    private val guard: () -> Unit,
    private val readOnly: Boolean = false,
) : VeilCheckpointSqlite.SqlPort {
    private val tables = setOf("records", "checkpoint", "veil_checkpoint_intents_v1",
        "veil_checkpoint_chunks_v1", "veil_checkpoint_committed_ops_v1")
    private val auxiliary = tables - setOf("records", "checkpoint")
    private val maximumSealed = 8 * 1024 * 1024 + 28
    private val maximumStored = 64L * 1024 * 1024

    private fun inputs(values: List<VeilCheckpointSqlite.Value>) {
        var blobs = 0L
        var text = 0L
        require(values.size <= 128) { "VEIL_SQL_ARGUMENT_BUDGET" }
        values.forEach { value ->
            when (value) {
                is VeilCheckpointSqlite.Value.Blob -> {
                    require(value.size <= maximumSealed) { "VEIL_SQL_WRITE_BLOB_BUDGET" }
                    blobs += value.size.toLong()
                    require(blobs <= maximumSealed.toLong()) { "VEIL_SQL_WRITE_BLOB_TOTAL_BUDGET" }
                }
                is VeilCheckpointSqlite.Value.Text -> {
                    require(value.text.length <= 1024) { "VEIL_SQL_WRITE_TEXT_BUDGET" }
                    text += value.text.length.toLong()
                    require(text <= 128L * 1024) { "VEIL_SQL_WRITE_TEXT_TOTAL_BUDGET" }
                }
                else -> Unit
            }
        }
    }

    private fun mutation(table: String, values: List<VeilCheckpointSqlite.NamedValue>) {
        require(table in tables) { "VEIL_SQL_TABLE_FORBIDDEN" }
        require(values.size in 1..32 && values.map { it.column }.toSet().size == values.size) { "VEIL_SQL_VALUES_INVALID" }
        inputs(values.map { it.value })
        val textColumns = when (table) {
            "records" -> mapOf("kind" to 32, "id" to 1024)
            "checkpoint" -> emptyMap()
            "veil_checkpoint_intents_v1" -> mapOf("op" to 36, "owner" to 512, "device" to 512,
                "identity_fp" to 512, "key_alias" to 512, "base_hash" to 64, "next_hash" to 64,
                "cipher_hash" to 64, "phase" to 32)
            "veil_checkpoint_chunks_v1" -> mapOf("op" to 36)
            else -> mapOf("op" to 36, "commitment_hash" to 64)
        }
        val integerColumns = when (table) {
            "checkpoint" -> setOf("slot", "revision")
            "veil_checkpoint_intents_v1" -> setOf("base_rev", "next_rev", "auth_gen", "candidate_bytes", "chunk_count")
            "veil_checkpoint_chunks_v1" -> setOf("part")
            else -> emptySet()
        }
        val blobColumns = when (table) {
            "records" -> mapOf("sealed" to maximumSealed)
            "veil_checkpoint_intents_v1" -> mapOf("receipt" to 32768)
            "veil_checkpoint_chunks_v1" -> mapOf("bytes" to 65536)
            else -> emptyMap()
        }
        values.forEach { named ->
            identifier(named.column)
            val value = named.value
            when {
                named.column in textColumns -> {
                    require(value is VeilCheckpointSqlite.Value.Text && value.text.length in 1..textColumns.getValue(named.column) &&
                        value.text.all { it.code in 33..126 }) { "VEIL_SQL_WRITE_TEXT_BUDGET" }
                }
                named.column in integerColumns -> require(value is VeilCheckpointSqlite.Value.Integer && value.number >= 0) {
                    "VEIL_SQL_WRITE_INTEGER_INVALID"
                }
                named.column in blobColumns -> {
                    val nullableReceipt = table == "veil_checkpoint_intents_v1" && named.column == "receipt" &&
                        value === VeilCheckpointSqlite.Value.Null
                    require(nullableReceipt || value is VeilCheckpointSqlite.Value.Blob && value.size <= blobColumns.getValue(named.column)) {
                        "VEIL_SQL_WRITE_BLOB_BUDGET"
                    }
                }
                else -> error("VEIL_SQL_WRITE_COLUMN_FORBIDDEN")
            }
        }
    }

    private fun recordReplacement(size: Int, where: String? = null, arguments: List<VeilCheckpointSqlite.Value> = emptyList()) {
        val budget = VeilCheckpointSqlite.Budget(1, 2, 0, 0, 0, 0)
        val current = query("SELECT COUNT(*) AS n, COALESCE(SUM(length(sealed)),0) AS bytes FROM records", emptyList(), budget).row(0)
        val count = current.integer(0)
        val bytes = current.integer(1)
        require(count in 0..4096 && bytes in 0..maximumStored) { "VEIL_SQL_RECORD_STATE_BUDGET" }
        if (where == null) {
            require(count < 4096 && bytes + size.toLong() <= maximumStored) { "VEIL_SQL_RECORD_REPLACEMENT_BUDGET" }
        } else {
            val previous = query("SELECT COUNT(*) AS n, COALESCE(SUM(length(sealed)),0) AS bytes FROM records WHERE $where",
                arguments, budget).row(0)
            val affected = previous.integer(0)
            val oldBytes = previous.integer(1)
            require(affected in 0..count && oldBytes in 0..bytes && bytes - oldBytes + affected * size.toLong() <= maximumStored) {
                "VEIL_SQL_RECORD_REPLACEMENT_BUDGET"
            }
        }
    }

    private fun identifier(value: String) {
        require(value.matches(Regex("[a-z][a-z0-9_]{0,63}"))) { "VEIL_SQL_IDENTIFIER_INVALID" }
    }

    private fun statement(value: String): String {
        require(value.length in 1..16384) { "VEIL_SQL_STATEMENT_BUDGET" }
        val sql = value.trim().removeSuffix(";").trim()
        require(!sql.contains(';') && !sql.contains("--") && !sql.contains("/*") && !sql.contains("*/")) {
            "VEIL_SQL_STATEMENT_INVALID"
        }
        require(!Regex("\\b(ATTACH|DETACH|PRAGMA|TRIGGER|VIRTUAL|TEMP|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|LOAD_EXTENSION)\\b",
            RegexOption.IGNORE_CASE).containsMatchIn(sql)) { "VEIL_SQL_STATEMENT_FORBIDDEN" }
        return sql
    }

    private fun cursor(sql: String, arguments: List<VeilCheckpointSqlite.Value>, windowBytes: Long? = null): Cursor {
        inputs(arguments)
        return database.rawQueryWithFactory({ _, driver, editTable, query ->
            bind(query, arguments)
            if (windowBytes != null && Build.VERSION.SDK_INT < 28) {
                check(windowBytes <= 1024L * 1024) { "VEIL_SQL_LARGE_WINDOW_API_UNAVAILABLE" }
            }
            val cursor = SQLiteCursor(driver, editTable, query)
            try {
                if (windowBytes != null && Build.VERSION.SDK_INT >= 28) {
                    cursor.setWindow(CursorWindow("veil-bounded-snapshot", windowBytes))
                }
                cursor
            } catch (failure: Throwable) {
                try { cursor.close() }
                catch (cleanup: Throwable) { if (cleanup !== failure) failure.addSuppressed(cleanup) }
                throw failure
            }
        }, sql, null, "")
    }

    private fun bind(query: SQLiteProgram, values: List<VeilCheckpointSqlite.Value>) {
        values.forEachIndexed { index, value ->
            when (value) {
                is VeilCheckpointSqlite.Value.Integer -> query.bindLong(index + 1, value.number)
                is VeilCheckpointSqlite.Value.Text -> query.bindString(index + 1, value.text)
                is VeilCheckpointSqlite.Value.Blob -> query.bindBlob(index + 1, value.copy())
                VeilCheckpointSqlite.Value.Null -> query.bindNull(index + 1)
            }
        }
    }

    override fun query(statement: String, arguments: List<VeilCheckpointSqlite.Value>,
        budget: VeilCheckpointSqlite.Budget): VeilCheckpointSqlite.Snapshot {
        guard()
        require(budget.maxRows <= 4096 && budget.maxColumns <= 32 && budget.maxBlobCell <= maximumSealed &&
            budget.maxBlobTotal <= maximumStored && budget.maxTextCell <= 4096 && budget.maxTextTotal <= 4096 * 1056) {
            "VEIL_SQL_GLOBAL_QUERY_BUDGET"
        }
        VeilCheckpointSqlite.Snapshot.bounded(emptyList(), budget)
        val sql = statement(statement)
        require(Regex("^SELECT\\b", RegexOption.IGNORE_CASE).containsMatchIn(sql)) {
            "VEIL_SQL_QUERY_NOT_SELECT"
        }
        require(!Regex("\\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|RANDOMBLOB|ZEROBLOB)\\b",
            RegexOption.IGNORE_CASE).containsMatchIn(sql)) { "VEIL_SQL_QUERY_FORBIDDEN" }
        // Metadata retrieval prepares the statement without reading BLOB cells.
        val names = cursor(sql, arguments).use { metadata ->
            require(metadata.columnCount <= budget.maxColumns) { "VEIL_SQL_COLUMN_BUDGET" }
            metadata.columnNames.toList()
        }
        require(names.isNotEmpty() && names.toSet().size == names.size) { "VEIL_SQL_COLUMNS_INVALID" }
        fun quoted(name: String): String = "q.\"" + name.replace("\"", "\"\"") + "\""
        val probes = names.flatMap { name -> listOf("typeof(${quoted(name)})", "length(CAST(${quoted(name)} AS BLOB))") }
        val lengths = ArrayList<List<Pair<String, Long>>>()
        var blobTotal = 0L
        var textTotal = 0L
        val limit = budget.maxRows.toLong() + 1L
        // Probe type/length first: no oversized BLOB is obtained via getBlob().
        cursor("SELECT ${probes.joinToString(",")} FROM ($sql) AS q LIMIT $limit", arguments).use { probe ->
            while (probe.moveToNext()) {
                guard()
                require(lengths.size < budget.maxRows) { "VEIL_SQL_ROW_BUDGET" }
                val row = ArrayList<Pair<String, Long>>(names.size)
                names.indices.forEach { column ->
                    val type = probe.getString(column * 2)
                    val length = if (probe.isNull(column * 2 + 1)) 0L else probe.getLong(column * 2 + 1)
                    require(length >= 0) { "VEIL_SQL_CELL_LENGTH_INVALID" }
                    when (type) {
                        "blob" -> {
                            require(length <= budget.maxBlobCell.toLong()) { "VEIL_SQL_BLOB_CELL_BUDGET" }
                            blobTotal += length
                            require(blobTotal <= budget.maxBlobTotal.toLong()) { "VEIL_SQL_BLOB_TOTAL_BUDGET" }
                        }
                        "text" -> {
                            // UTF-8 uses at most three bytes per UTF-16 unit. This
                            // ceiling bounds allocation even with NUL/Unicode;
                            // exact UTF-16 budgets remain checked after decoding.
                            require(length <= 3L * budget.maxTextCell) { "VEIL_SQL_TEXT_ENCODED_CELL_BUDGET" }
                            textTotal += length
                            require(textTotal <= 3L * budget.maxTextTotal) { "VEIL_SQL_TEXT_ENCODED_TOTAL_BUDGET" }
                        }
                        "integer", "null" -> Unit
                        else -> error("VEIL_SQL_CELL_TYPE_INVALID")
                    }
                    row.add(type to length)
                }
                lengths.add(row)
            }
        }
        guard()
        val rows = ArrayList<List<VeilCheckpointSqlite.Value>>(lengths.size)
        var actualTextTotal = 0L
        val maximumRowBytes = lengths.maxOfOrNull { row ->
            row.sumOf { (type, length) -> if (type == "integer") 8L else length }
        } ?: 0L
        val windowBytes = maxOf(64L * 1024, maximumRowBytes + names.size * 64L + 64L * 1024)
        check(windowBytes <= maximumStored + 3L * 4096 * 32 + 32L * 64 + 64L * 1024) {
            "VEIL_SQL_NATIVE_WINDOW_BUDGET"
        }
        cursor("SELECT q.* FROM ($sql) AS q LIMIT $limit", arguments, windowBytes).use { data ->
            while (data.moveToNext()) {
                guard()
                require(rows.size < lengths.size && data.columnCount == names.size) { "VEIL_SQL_QUERY_CHANGED" }
                val expected = lengths[rows.size]
                val row = names.indices.map { column ->
                    when (expected[column].first) {
                        "null" -> {
                            require(data.getType(column) == Cursor.FIELD_TYPE_NULL) { "VEIL_SQL_QUERY_CHANGED" }
                            VeilCheckpointSqlite.Value.Null
                        }
                        "integer" -> {
                            require(data.getType(column) == Cursor.FIELD_TYPE_INTEGER) { "VEIL_SQL_QUERY_CHANGED" }
                            VeilCheckpointSqlite.Value.Integer(data.getLong(column))
                        }
                        "text" -> {
                            require(data.getType(column) == Cursor.FIELD_TYPE_STRING) { "VEIL_SQL_QUERY_CHANGED" }
                            val text = data.getString(column)
                            require(text.length <= budget.maxTextCell) { "VEIL_SQL_TEXT_CELL_BUDGET" }
                            actualTextTotal += text.length.toLong()
                            require(actualTextTotal <= budget.maxTextTotal.toLong()) { "VEIL_SQL_TEXT_TOTAL_BUDGET" }
                            VeilCheckpointSqlite.Value.Text(text)
                        }
                        "blob" -> {
                            require(data.getType(column) == Cursor.FIELD_TYPE_BLOB) { "VEIL_SQL_QUERY_CHANGED" }
                            val bytes = data.getBlob(column)
                            require(bytes.size.toLong() == expected[column].second) { "VEIL_SQL_QUERY_CHANGED" }
                            VeilCheckpointSqlite.Value.Blob(bytes)
                        }
                        else -> error("VEIL_SQL_CELL_TYPE_INVALID")
                    }
                }
                rows.add(row)
            }
        }
        require(rows.size == lengths.size) { "VEIL_SQL_QUERY_CHANGED" }
        guard()
        return VeilCheckpointSqlite.Snapshot.bounded(rows, budget)
    }

    private fun writable() {
        guard()
        check(!readOnly) { "VEIL_SQL_PRIVATE_VERIFIER_READ_ONLY" }
    }

    override fun executeSchema(statement: String) {
        writable()
        val sql = statement(statement)
        require(auxiliary.any { table -> Regex("^CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+$table\\s*\\(",
            RegexOption.IGNORE_CASE).containsMatchIn(sql) }) { "VEIL_SQL_SCHEMA_FORBIDDEN" }
        database.execSQL(sql)
        guard()
    }

    private fun content(values: List<VeilCheckpointSqlite.NamedValue>): ContentValues {
        require(values.size in 1..32 && values.map { it.column }.toSet().size == values.size) { "VEIL_SQL_VALUES_INVALID" }
        return ContentValues(values.size).apply {
            values.forEach { named ->
                identifier(named.column)
                when (val value = named.value) {
                    is VeilCheckpointSqlite.Value.Integer -> put(named.column, value.number)
                    is VeilCheckpointSqlite.Value.Text -> put(named.column, value.text)
                    is VeilCheckpointSqlite.Value.Blob -> put(named.column, value.copy())
                    VeilCheckpointSqlite.Value.Null -> putNull(named.column)
                }
            }
        }
    }

    override fun insert(table: String, values: List<VeilCheckpointSqlite.NamedValue>): Long {
        writable()
        mutation(table, values)
        if (table == "records") {
            val sealed = values.singleOrNull { it.column == "sealed" }?.value
            require(sealed is VeilCheckpointSqlite.Value.Blob) { "VEIL_SQL_RECORD_SEALED_REQUIRED" }
            recordReplacement(sealed.size)
        }
        val result = database.insertOrThrow(table, null, content(values))
        guard()
        return result
    }

    override fun update(table: String, values: List<VeilCheckpointSqlite.NamedValue>, where: String,
        arguments: List<VeilCheckpointSqlite.Value>): Int {
        writable()
        mutation(table, values)
        inputs(arguments)
        val atom = "[a-z][a-z0-9_]{0,63}\\s*=\\s*\\?"
        require(where.length <= 1024 && where.matches(Regex("$atom(?:\\s+AND\\s+$atom){0,7}")) &&
            arguments.size == where.count { it == '?' }) {
            "VEIL_SQL_WHERE_FORBIDDEN"
        }
        require(values.size in 1..32 && values.map { it.column }.toSet().size == values.size) {
            "VEIL_SQL_VALUES_INVALID"
        }
        values.forEach { identifier(it.column) }
        if (table == "records") {
            val sealed = values.singleOrNull { it.column == "sealed" }?.value
            if (sealed is VeilCheckpointSqlite.Value.Blob) recordReplacement(sealed.size, where, arguments)
        }
        val assignments = values.joinToString(",") { "${it.column}=?" }
        val result = database.compileStatement("UPDATE $table SET $assignments WHERE $where").use { update ->
            bind(update, values.map { it.value } + arguments)
            update.executeUpdateDelete()
        }
        guard()
        return result
    }
}

package com.ynx.social.matrix

/** Native-only, thread/lease bounded serialized-record port. No JS implementation. */
internal interface VeilRecordTransaction {
  fun checkLive()
  fun read(kind: VeilRecordKind, id: String): ByteArray?
  fun write(kind: VeilRecordKind, id: String, bytes: ByteArray)
  fun remove(kind: VeilRecordKind, id: String)
  fun ids(kind: VeilRecordKind): List<String>
}

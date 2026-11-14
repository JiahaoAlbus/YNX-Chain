package com.ynx.social.matrix

import com.ynx.social.veil.VeilNativeProductControllerBridge as Bridge
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.IdentityHashMap
import org.json.JSONObject

/** One original worker's public routing inventory. Never an authority supplier. */
internal class VeilNativeProductPorts {
    private val thread = Thread.currentThread()
    private var subscription = 0L
    private var epoch = 0L
    private val operations = IdentityHashMap<Operation, Boolean>()
    private var acceptedDeviceMayBeOwned = false
    private var deviceOriginal: ByteArray? = null
    private var deviceRestore = false
    private var deviceColdOriginal: VeilOwnKeyColdRecoveryLease? = null
    private var deviceResult: Int? = null
    private var deviceFailure: Int? = null
    private var deviceReleaseFailed = false
    private var sessionMayBeOwned = false
    private var sessionOriginal: ByteArray? = null
    private var sessionResult: Int? = null
    private var sessionCloseFailed = false
    internal class Failure(val status: Long, val original: Operation? = null) : IllegalStateException("VEIL_PRODUCT_NATIVE_REFUSAL_$status")
    internal class Operation internal constructor(internal var selector: Long) {
        internal var localAcknowledged = false
        internal var auditReference: String? = null
        internal var auditEpoch = 0L
        internal var input: ByteArray? = null
        internal var initialSessionBundle: ByteArray? = null
        internal var initialSessionReceive = false // correlation only, never permission
        internal var logical: ByteArray? = null
        internal var direction = 0
        internal var output: VeilNativeMessageOutput? = null
        internal var outputStatus: Long? = null
    }
    private fun checked() {
        check(Thread.currentThread() === thread) { "VEIL_PRODUCT_WRONG_WORKER" }
        check(Bridge.nativeProductPortsAbiVersion() == 1) { "VEIL_PRODUCT_ABI_REQUIRED" }
    }
    private fun result(value: Long): Long {
        if (value < 0) {
            val status = if (value == Long.MIN_VALUE) 32L else -value
            if (status == 16L || status == 25L) deviceFailure = status.toInt()
            throw Failure(status)
        }
        return value
    }
    fun read(watch: Boolean): Map<String, Any> {
        checked()
        preserveDeviceUncertainty()
        if (watch && subscription == 0L) {
            val selected = result(Bridge.nativeSubscribeProductInvalidation())
            check(selected > 0) { "VEIL_PRODUCT_SUBSCRIPTION_INVALID" }
            subscription = selected
        }
        if (subscription != 0L) result(Bridge.nativePollProductInvalidation(subscription, epoch))
        val bytes = ByteArray(16384)
        try {
            val length = result(Bridge.nativeReadProductSnapshot(bytes))
            require(length in 9..16384)
            val current = ByteBuffer.wrap(bytes, 0, 8).long
            require(current > 0 && current >= epoch)
            val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes, 8, length.toInt()-8)).toString()
            val raw = JSONObject(text)
            require(raw.getInt("version") == 1)
            val projection = raw.get("authorized_projection")
            val session = if (projection is JSONObject) {
                sessionMayBeOwned = true
                check(!raw.getBoolean("closed") && raw.getInt("owner_status") == 0)
                preserveDeviceUncertainty()
                val code = deviceCall { Bridge.nativeMessageSessionCurrent() }
                if (code != 0) throw Failure(code.toLong())
                decodeMessageSession(projection)
            } else {
                require(projection == "not-supplied")
                null
            }
            val standaloneDevice = if (raw.has("accepted_device")) {
                acceptedDeviceMayBeOwned = true
                check(!raw.getBoolean("closed") && raw.getInt("owner_status") !in listOf(16, 25))
                preserveDeviceUncertainty()
                val code = deviceCall { currentDeviceNative() }
                if (code != 0) throw Failure(code.toLong())
                decodeAcceptedDevice(raw.getJSONObject("accepted_device"))
            } else null
            val sessionDevice = session?.get("device")
            if (standaloneDevice != null && sessionDevice != null) require(standaloneDevice == sessionDevice)
            val device = standaloneDevice ?: sessionDevice
            val inventory = raw.getJSONObject("inventory")
            require(inventory.getInt("capacity") == 32 && inventory.getJSONArray("entries").length() <= 32)
            val changed = epoch != 0L && epoch != current
            epoch = current
            // Normal product sampling consumes only outputs of this worker's
            // retained operations. It never retires or starts an operation.
            sampleOriginalOutputs()
            // Copying may invalidate the preceding snapshot. Never publish it
            // after this same read has discovered retained uncertainty.
            preserveDeviceUncertainty()
            val observation = mutableMapOf<String, Any>(
                "status" to if (session != null) "SESSION_OBSERVED" else if (device == null) "INVENTORY_ONLY" else "DEVICE_OBSERVED",
                "epoch" to current.toString(), "ownerStatus" to raw.getInt("owner_status"),
                "closed" to raw.getBoolean("closed"),
                "entryCount" to inventory.getJSONArray("entries").length(),
                "enginePresent" to inventory.getBoolean("engine_present"), "changed" to changed,
                "deviceAuthorization" to "REQUIRED")
            if (device != null) observation["acceptedDevice"] = device
            if (session != null) observation["protectedSession"] = session
            return observation
        } finally { bytes.fill(0) }
    }
    /** Internal producer handoff, not exported to JS. Retain the exact first
     * attempt before JNI; retry observes it and never reissues acquisition. */
    fun acceptDeviceRecords(originalRecords: ByteArray, restore: Boolean, coldOriginal: VeilOwnKeyColdRecoveryLease? = null) {
        checked()
        require(originalRecords.isNotEmpty() && originalRecords.size <= 393216)
        check(operations.isEmpty()) { "VEIL_DEVICE_MESSAGE_CUSTODY_RETAINED" }
        preserveDeviceUncertainty()
        val retained = deviceOriginal
        if (retained != null) {
            check(deviceRestore == restore && deviceColdOriginal === coldOriginal && retained.contentEquals(originalRecords)) {
                "VEIL_DEVICE_ORIGINAL_ATTEMPT_RETAINED"
            }
            val status = deviceResult ?: throw Failure(16)
            if (status != 0) throw Failure(status.toLong())
            val current = deviceCall { currentDeviceNative() }
            if (current != 0) throw Failure(current.toLong())
            return
        }
        check(!acceptedDeviceMayBeOwned && !sessionMayBeOwned) { "VEIL_DEVICE_OWNER_ALREADY_PRESENT" }
        val owned = originalRecords.copyOf()
        deviceOriginal = owned
        deviceRestore = restore
        deviceColdOriginal = coldOriginal
        acceptedDeviceMayBeOwned = true
        val status = deviceCall {
            if (coldOriginal != null) VeilNativeColdProductBridge.acceptDeviceRecords(coldOriginal, owned)
            else if (restore) Bridge.nativeRestoreAcceptedDevice(owned)
            else Bridge.nativeAcquireAcceptedDevice(owned)
        }
        deviceResult = status
        if (status != 0) throw Failure(status.toLong())
        val current = deviceCall { currentDeviceNative() }
        if (current != 0) throw Failure(current.toLong())
    }
    fun openMessageSession(originalRecords: ByteArray) {
        checked()
        require(originalRecords.isNotEmpty() && originalRecords.size <= 393216)
        check(operations.isEmpty()) { "VEIL_MESSAGE_ORIGINAL_RETAINED" }
        preserveDeviceUncertainty()
        check(!sessionCloseFailed) { "VEIL_MESSAGE_SESSION_CLOSE_UNRESOLVED" }
        sessionOriginal?.let { original ->
            check(original.contentEquals(originalRecords)) { "VEIL_MESSAGE_SESSION_ORIGINAL_RETAINED" }
            val status = sessionResult ?: throw Failure(16)
            if (status != 0) throw Failure(status.toLong())
            val current = deviceCall { Bridge.nativeMessageSessionCurrent() }
            if (current != 0) throw Failure(current.toLong())
            return
        }
        check(!sessionMayBeOwned) { "VEIL_MESSAGE_SESSION_ALREADY_PRESENT" }
        val bytes = originalRecords.copyOf()
        sessionOriginal = bytes
        sessionMayBeOwned = true
        // Native takes actual accepted-device custody, authenticated enrollment
        // and independent current/floor inputs. Public records alone cannot open.
        val status = deviceCall {
            val cold = deviceColdOriginal
            if (cold != null) VeilNativeColdProductBridge.openMessageSession(cold, bytes)
            else Bridge.nativeOpenMessageSession(bytes)
        }
        sessionResult = status
        if (status != 0) throw Failure(status.toLong())
        val current = deviceCall { Bridge.nativeMessageSessionCurrent() }
        if (current != 0) throw Failure(current.toLong())
    }
    /** Authority check against the ORIGINAL acquired device, never inventory. */
    fun requireAcceptedDeviceCurrent() {
        checked()
        preserveDeviceUncertainty()
        check(deviceOriginal != null && deviceResult == 0 && acceptedDeviceMayBeOwned) {
            "VEIL_PRODUCT_ORIGINAL_ACCEPTED_DEVICE_REQUIRED"
        }
        val status = deviceCall { currentDeviceNative() }
        if (status != 0) throw Failure(status.toLong())
    }
    fun currentMessageEpoch(): Long {
        requireAcceptedDeviceCurrent()
        read(false)
        check(sessionOriginal != null && sessionResult == 0 && !sessionCloseFailed) {
            "VEIL_PRODUCT_ORIGINAL_MESSAGE_SESSION_REQUIRED"
        }
        val status = deviceCall { Bridge.nativeMessageSessionCurrent() }
        if (status != 0) throw Failure(status.toLong())
        return epoch
    }
    fun closeMessageSessionForClose() {
        checked()
        if (!sessionMayBeOwned) return
        check(operations.isEmpty()) { "VEIL_MESSAGE_ORIGINAL_RETAINED" }
        preserveDeviceUncertainty()
        check(!sessionCloseFailed) { "VEIL_MESSAGE_SESSION_CLOSE_UNRESOLVED" }
        sessionCloseFailed = true
        val code = deviceCall { Bridge.nativeCloseMessageSession() }
        if (code != 0) throw Failure(code.toLong())
        sessionMayBeOwned = false
        sessionOriginal?.fill(0)
        sessionOriginal = null
        sessionResult = null
        sessionCloseFailed = false
    }
    private fun currentDeviceNative(): Int {
        val cold = deviceColdOriginal
        return if (cold != null) VeilNativeColdProductBridge.deviceCurrent(cold)
            else Bridge.nativeAcceptedDeviceCurrent()
    }
    private fun preserveDeviceUncertainty() {
        deviceFailure?.let { throw Failure(it.toLong()) }
        check(!deviceReleaseFailed) { "VEIL_DEVICE_RELEASE_UNRESOLVED" }
    }
    private fun deviceCall(call: () -> Int): Int {
        val status = try { call() } catch (failure: Throwable) {
            deviceFailure = 16
            throw failure
        }
        if (status == 16 || status == 25) deviceFailure = status
        return status
    }
    fun releaseAcceptedDeviceForClose() {
        checked()
        if (!acceptedDeviceMayBeOwned) return
        check(operations.isEmpty()) { "VEIL_DEVICE_MESSAGE_CUSTODY_RETAINED" }
        preserveDeviceUncertainty()
        // Install the close fence before invoking native release. Any exception
        // or refusal retains the original owner and never retries release.
        deviceReleaseFailed = true
        val status = deviceCall { Bridge.nativeReleaseAcceptedDevice() }
        if (status != 0) throw Failure(status.toLong())
        acceptedDeviceMayBeOwned = false
        deviceOriginal?.fill(0)
        deviceOriginal = null
        deviceColdOriginal = null
        deviceResult = null
        deviceReleaseFailed = false
    }
    fun stopWatching() {
        checked()
        if (subscription != 0L) {
            val code = Bridge.nativeUnsubscribeProductInvalidation(subscription)
            if (code != 0) throw Failure(code.toLong())
            subscription = 0L // Only after actual unsubscribe success.
        }
    }
    /** Pure Native DATA builder. The returned public control is not a
     * Source/session permit; the original source must capture and authorize it. */
    fun initialSessionFrame(logical: ByteArray, canonicalBundle: ByteArray): ByteArray {
        checked()
        require(logical.size == 16 && canonicalBundle.size in 1..8192)
        val id = logical.copyOf(); val bundle = canonicalBundle.copyOf()
        var result: ByteArray? = null
        try {
            result = Bridge.nativeInitialSessionFrame(id, bundle)
                ?: error("VEIL_INITIAL_SESSION_NATIVE_FRAME_REQUIRED")
            validateInitialSessionFrame(result)
            require(result.copyOfRange(8, 24).contentEquals(logical) &&
                id.contentEquals(logical) && bundle.contentEquals(canonicalBundle)) {
                "VEIL_INITIAL_SESSION_ORIGINAL_MUTATED"
            }
            return result
        } catch (failure: Throwable) { result?.fill(0); throw failure }
        finally { id.fill(0); bundle.fill(0) }
    }

    /** Normal begin already submits this SAME original exactly once. */
    fun acquire(expectedEpoch: Long, frame: ByteArray): Operation =
        acquirePrepared(expectedEpoch, frame, null) { original ->
            Bridge.nativeExecuteProduct(expectedEpoch, 1, 0, checkNotNull(original.input))
        }

    /** Separate source-purpose path. Never action1/text or a bare acquire.
     * Positive selector means retained/submitted, NOT committed or protected. */
    fun acquireInitialSession(expectedEpoch: Long, frame: ByteArray,
                              canonicalBundle: ByteArray): Operation =
        acquirePrepared(expectedEpoch, frame, canonicalBundle) { original ->
            Bridge.nativeBeginInitialSessionProduct(expectedEpoch,
                checkNotNull(original.input), checkNotNull(original.initialSessionBundle))
        }

    /** Public DATA builder only; actual Native reconstructs the same protected
     * own records and validates the distinct source purpose later. */
    fun initialSessionReceiveFrame(logical: ByteArray, preKeyWire: ByteArray,
                                   canonicalPublishedOwnBundle: ByteArray): ByteArray {
        checked()
        require(logical.size == 16 && preKeyWire.size in 1..1048576 &&
            canonicalPublishedOwnBundle.size in 1..8192)
        val id = logical.copyOf(); val wire = preKeyWire.copyOf()
        val bundle = canonicalPublishedOwnBundle.copyOf()
        var result: ByteArray? = null
        try {
            result = Bridge.nativeInitialSessionReceiveFrame(id, wire, bundle)
                ?: error("VEIL_INITIAL_RECEIVE_NATIVE_FRAME_REQUIRED")
            validateInitialSessionReceiveFrame(result)
            require(result.copyOfRange(8, 24).contentEquals(logical) &&
                id.contentEquals(logical) && wire.contentEquals(preKeyWire) &&
                bundle.contentEquals(canonicalPublishedOwnBundle)) { "VEIL_INITIAL_RECEIVE_ORIGINAL_MUTATED" }
            return result
        } catch (failure: Throwable) { result?.fill(0); throw failure }
        finally { id.fill(0); wire.fill(0); bundle.fill(0) }
    }
    fun acquireInitialSessionReceive(expectedEpoch: Long, frame: ByteArray): Operation =
        acquirePrepared(expectedEpoch, frame, null, true) { original ->
            Bridge.nativeBeginInitialSessionReceiveProduct(expectedEpoch, checkNotNull(original.input))
        }

    private fun acquirePrepared(expectedEpoch: Long, frame: ByteArray, canonicalBundle: ByteArray?,
                                initialReceive: Boolean = false, begin: (Operation) -> Long): Operation {
        checked(); require(expectedEpoch > 0 && expectedEpoch == epoch)
        require(frame.size >= 28)
        val direction = frame[5].toInt()
        if (initialReceive) {
            require(canonicalBundle == null)
            validateInitialSessionReceiveFrame(frame)
        } else if (canonicalBundle == null) validateFrame(frame, direction)
        else {
            validateInitialSessionFrame(frame)
            require(canonicalBundle.size in 1..8192)
        }
        check(Bridge.nativeMessageOutputAbiVersion() == 1) { "VEIL_MESSAGE_OUTPUT_ABI_REQUIRED" }
        check(operations.isEmpty()) { "VEIL_MESSAGE_ORIGINAL_RETAINED" }
        preserveDeviceUncertainty()
        check(sessionMayBeOwned && !sessionCloseFailed) { "VEIL_MESSAGE_SESSION_REQUIRED" }
        val current = deviceCall { Bridge.nativeMessageSessionCurrent() }
        if (current != 0) throw Failure(current.toLong())
        val original = Operation(0)
        original.auditEpoch = expectedEpoch
        associateInput(original, frame, direction)
        original.initialSessionBundle = canonicalBundle?.copyOf()
        original.initialSessionReceive = initialReceive
        operations[original] = true
        try {
            // Both normal and initial factories retain complete originals and
            // begin+submit once. Never follow this with prepareSend/Receive.
            original.selector = result(begin(original))
            if (original.selector <= 0) throw Failure(16)
            return original
        } catch (failure: Throwable) {
            val code = (failure as? Failure)?.status ?: 16L
            original.outputStatus = code
            if (code == 16L || code == 25L) deviceFailure = code.toInt()
            // Only the real no-custody RequiredSource result proves no effect.
            if (code == 4L) {
                operations.remove(original)
                original.input?.fill(0); original.input = null
                original.initialSessionBundle?.fill(0); original.initialSessionBundle = null
                original.logical?.fill(0); original.logical = null
            }
            throw Failure(code, if (code == 4L) null else original).also { it.addSuppressed(failure) }
        }
    }

    /** Progress only. Native begin already submitted the selected input;
     * resubmitting it is redundant even though Native correctly deduplicates.
     * No changed input, new operation, prepare, or re-encryption occurs here. */
    fun advancePreparedInput(original: Operation, expectedEpoch: Long, frame: ByteArray): Long {
        checked(); check(operations.containsKey(original))
        require(expectedEpoch > 0 && expectedEpoch == epoch && original.auditEpoch == expectedEpoch)
        preserveUncertainty(original)
        check(original.selector > 0) { "VEIL_MESSAGE_BEGIN_UNRESOLVED" }
        val advance = {
            advanceOriginal(original) {
                Bridge.nativeExecuteProduct(expectedEpoch, 3, original.selector, byteArrayOf())
            }
        }
        val retained = checkNotNull(original.input) { "VEIL_ORIGINAL_MESSAGE_INPUT_REQUIRED" }
        return if (original.initialSessionReceive) advancePreparedInitialReceiveFrame(retained, frame, advance)
            else if (original.initialSessionBundle == null) advancePreparedFrame(retained, frame, advance)
            else advancePreparedInitialFrame(retained, frame, advance)
    }

    fun execute(original: Operation, expectedEpoch: Long, action: Int, frame: ByteArray): Long {
        checked(); check(operations.containsKey(original)); require(expectedEpoch > 0 && expectedEpoch == epoch)
        require(action in 2..4)
        if (action == 3) require(frame.isEmpty()) else validateFrame(frame, if (action == 2) 1 else 2)
        if (action != 3) associateInput(original, frame, if (action == 2) 1 else 2)
        preserveUncertainty(original)
        check(original.selector > 0) { "VEIL_MESSAGE_BEGIN_UNRESOLVED" }
        return advanceOriginal(original) {
            Bridge.nativeExecuteProduct(expectedEpoch, action, original.selector, frame)
        }
    }
    fun receive(original: Operation, expectedEpoch: Long, frame: ByteArray): Long {
        checked(); check(operations.containsKey(original)); require(expectedEpoch > 0 && expectedEpoch == epoch)
        validateFrame(frame, 2)
        associateInput(original, frame, 2)
        preserveUncertainty(original)
        check(original.selector > 0) { "VEIL_MESSAGE_BEGIN_UNRESOLVED" }
        return advanceOriginal(original) {
            Bridge.nativeReceiveOpaqueEvent(expectedEpoch, original.selector, frame)
        }
    }
    private fun advanceOriginal(original: Operation, call: () -> Long): Long {
        try {
            val value = result(call())
            require(value == 0L || value == 30L)
            return value
        } catch (failure: Throwable) {
            val code = (failure as? Failure)?.status ?: 16L
            original.outputStatus = code
            if (code == 16L || code == 25L) deviceFailure = code.toInt()
            throw Failure(code, original).also { it.addSuppressed(failure) }
        }
    }
    private fun associateInput(original: Operation, frame: ByteArray, direction: Int) {
        original.input?.let {
            check(original.direction == direction && it.contentEquals(frame)) {
                "VEIL_ORIGINAL_MESSAGE_INPUT_ALREADY_RETAINED"
            }
            return
        }
        val logical = frame.copyOfRange(8, 24)
        require(logical.any { it != 0.toByte() })
        original.input = frame.copyOf()
        original.logical = logical; original.direction = direction
        val id = java.nio.ByteBuffer.wrap(logical)
        original.auditReference = java.util.UUID(id.long, id.long).toString()
        // Association is recorded before JNI so partial/unknown failure keeps
        // this original input. It is correlation, never route authorization.
    }
    private fun preserveUncertainty(original: Operation) {
        original.outputStatus?.let { if (it == 16L || it == 25L) throw Failure(it) }
    }
    private fun readOriginalOutput(original: Operation, expectedEpoch: Long): VeilNativeMessageOutput {
        checked(); check(operations.containsKey(original)); require(expectedEpoch > 0 && expectedEpoch == epoch)
        preserveUncertainty(original)
        check(Bridge.nativeMessageOutputAbiVersion() == 1) { "VEIL_MESSAGE_OUTPUT_ABI_REQUIRED" }
        check(original.selector > 0) { "VEIL_MESSAGE_BEGIN_UNRESOLVED" }
        val logical = checkNotNull(original.logical) { "VEIL_ORIGINAL_MESSAGE_INPUT_REQUIRED" }
        val bytes = ByteArray(VeilNativeMessageOutput.MAX_OUTPUT)
        try {
            val written = Bridge.nativeCopyMessageOutput(expectedEpoch, original.selector, bytes)
            if (written < 0) {
                val status = if (written == Long.MIN_VALUE) 32L else -written
                original.outputStatus = status
                if (status == 16L || status == 25L) deviceFailure = status.toInt()
                throw Failure(status, original)
            }
            val captured = if (original.initialSessionReceive) {
                require(original.direction == 2 && checkNotNull(original.input)[6] == 5.toByte())
                VeilNativeMessageOutput.decodeInitialControl(bytes, written, logical)
            } else VeilNativeMessageOutput.decode(bytes, written, logical, original.direction)
            val retained = original.output
            if (retained != null && !retained.sameOriginal(captured)) {
                captured.close(); original.outputStatus = 16L
                deviceFailure = 16
                throw Failure(16, original)
            }
            original.outputStatus = null
            if (retained == null) original.output = captured else captured.close()
            return checkNotNull(original.output).duplicate()
        } finally { bytes.fill(0) }
    }
    private fun sampleOriginalOutputs() {
        for (original in operations.keys.toList()) {
            if (original.logical == null || original.selector <= 0) continue
            try { readOriginalOutput(original, epoch).close() }
            catch (failure: Failure) {
                // An output which is not ready stays on the same operation.
                // UNKNOWN and retained panic are not ordinary absence.
                if (failure.status == 16L || failure.status == 25L) throw failure
            }
        }
    }
    fun withOriginalOutput(original: Operation, expectedEpoch: Long, consume: (VeilNativeMessageOutput) -> Unit) {
        val output = readOriginalOutput(original, expectedEpoch)
        try { consume(output) } finally { output.close() }
        // Consumer failure/success is not a native commit or retirement proof.
    }
    fun retireOriginalOutput(original: Operation, expectedEpoch: Long) {
        checked(); check(operations.containsKey(original)); require(expectedEpoch > 0 && expectedEpoch == epoch)
        preserveUncertainty(original)
        check(original.output != null) { "VEIL_MESSAGE_OUTPUT_NOT_OBSERVED" }
        check(Bridge.nativeMessageOutputAbiVersion() == 1) { "VEIL_MESSAGE_OUTPUT_ABI_REQUIRED" }
        val status = Bridge.nativeRetireMessageOutput(expectedEpoch, original.selector)
        if (status != 0) {
            original.outputStatus = if (status > 0) status.toLong() else 32L
            throw Failure(checkNotNull(original.outputStatus))
        }
        operations.remove(original)
        original.localAcknowledged = true
        original.output?.close(); original.output = null
        original.input?.fill(0); original.input = null
        original.initialSessionBundle?.fill(0); original.initialSessionBundle = null
        original.logical?.fill(0); original.logical = null
    }
    /** Java custody only. The source's private live scope has already queried
     * SAME actual Native FINALIZED + retired/closed. No JNI mutation/retry. */
    internal fun acknowledgeFinalizedLocal(source: VeilNativeMatrixSource, selected: Operation?,
        expectedEpoch: Long, account: String, reference: String, direction: Int) {
        checked()
        source.requireFinalizedLocalAck(this, null, account, reference, 1, direction)
        require(expectedEpoch == 0L || (expectedEpoch > 0 && expectedEpoch == epoch))
        val original = selected ?: operations.keys.singleOrNull()
        if (original == null) { check(operations.isEmpty()); return }
        require(expectedEpoch > 0 && original.auditEpoch == expectedEpoch &&
            original.auditReference == reference && original.direction == direction)
        if (original.localAcknowledged) { check(!operations.containsKey(original)); return }
        check(operations.containsKey(original)) { "VEIL_MESSAGE_FOREIGN_ORIGINAL" }
        operations.remove(original)
        original.localAcknowledged = true
        original.output?.close(); original.output = null
        original.input?.fill(0); original.input = null
        original.initialSessionBundle?.fill(0); original.initialSessionBundle = null
        original.logical?.fill(0); original.logical = null
        // outputStatus/deviceFailure and audit correlation are not cleared.
    }
    // Close inspects already-owned custody, never a fresh Native ABI. An empty
    // local map still leaves the original guarded Native cleanup responsible.
    fun hasRetainedMessages(): Boolean {
        check(Thread.currentThread() === thread) { "VEIL_PRODUCT_WRONG_WORKER" }
        return operations.isNotEmpty()
    }
    companion object {
        /** Actual protected-session projection; still not an operation grant. */
        internal fun decodeMessageSession(raw: JSONObject): Map<String, Any> {
            val fields = setOf("version", "kind", "device", "local", "remote",
                "purposeDigest", "selectedSessionDigest", "relationDigest", "checkpointDigest",
                "relationRevision", "purposeExpiresMS")
            require(raw.keys().asSequence().toSet() == fields && raw.get("version") == 1 &&
                raw.get("kind") == "protected-message-session-observation")
            fun address(value: JSONObject): Map<String, Any> {
                require(value.keys().asSequence().toSet() == setOf("name", "deviceId"))
                val name = value.get("name")
                require(name is String && name.isNotEmpty() && !name.contains('\u0000'))
                val utf8 = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(name))
                require(utf8.remaining() in 1..128)
                val id = value.get("deviceId")
                require(id is Int && id in 1..127)
                return mapOf("name" to name, "deviceId" to id)
            }
            val local = address(raw.getJSONObject("local"))
            val remote = address(raw.getJSONObject("remote"))
            require(local != remote)
            val out = linkedMapOf<String, Any>("version" to 1,
                "kind" to "protected-message-session-observation",
                "device" to decodeAcceptedDevice(raw.getJSONObject("device")), "local" to local, "remote" to remote)
            for (key in listOf("purposeDigest", "selectedSessionDigest", "relationDigest", "checkpointDigest")) {
                val value = raw.get(key)
                require(value is String && Regex("[0-9a-f]{64}").matches(value) && value.any { it != '0' })
                out[key] = value
            }
            val revision = raw.get("relationRevision")
            require(revision is String && Regex("[1-9][0-9]{0,19}").matches(revision) &&
                (revision.length < 20 || revision <= "18446744073709551615"))
            val expires = raw.get("purposeExpiresMS")
            require((expires is Int || expires is Long) && (expires as Number).toLong() in 1..9007199254740991L)
            out["relationRevision"] = revision
            out["purposeExpiresMS"] = (expires as Number).toLong()
            return out
        }
        /** Public observation shape, not signature verification or authority. */
        internal fun decodeAcceptedDevice(raw: JSONObject): Map<String, Any> {
            val fields = setOf("version", "kind", "account", "device", "rootDigest",
                "registrationDigest", "finalDigest", "currentDigest", "currentSequence",
                "revocationCheckpointDigest", "observedIssuedMS", "observedExpiresMS")
            require(raw.keys().asSequence().toSet() == fields)
            require(raw.get("version") == 1 && raw.get("kind") == "accepted-device-observation")
            val out = linkedMapOf<String, Any>("version" to 1, "kind" to "accepted-device-observation")
            for (field in listOf("account", "device")) {
                val value = raw.get(field)
                require(value is String && value.length in 1..512 && value.all { it.code in 33..126 })
                out[field] = value
            }
            for (field in listOf("rootDigest", "registrationDigest", "finalDigest",
                "currentDigest", "revocationCheckpointDigest")) {
                val value = raw.get(field)
                require(value is String && Regex("[0-9a-f]{64}").matches(value) && value.any { it != '0' })
                out[field] = value
            }
            val sequence = raw.get("currentSequence")
            require(sequence is String && Regex("[1-9][0-9]{0,19}").matches(sequence) &&
                (sequence.length < 20 || sequence <= "18446744073709551615"))
            out["currentSequence"] = sequence
            fun milliseconds(field: String): Long {
                val value = raw.get(field)
                require(value is Long || value is Int)
                val number = (value as Number).toLong()
                require(number in 0..9007199254740991L)
                return number
            }
            val issued = milliseconds("observedIssuedMS")
            val expires = milliseconds("observedExpiresMS")
            require(expires > issued)
            out["observedIssuedMS"] = issued
            out["observedExpiresMS"] = expires
            return out
        }
        /** Outer frame/correlation only. Inner public control and full bundle
         * are decoded and permission-checked by the fixed Native supplier. */
        internal fun validateInitialSessionReceiveFrame(bytes: ByteArray) {
            require(bytes.size >= 61 && bytes[0] == 89.toByte() && bytes[1] == 78.toByte() &&
                bytes[2] == 88.toByte() && bytes[3] == 77.toByte() && bytes[4] == 1.toByte() &&
                bytes[5] == 2.toByte() && bytes[6] == 5.toByte() && bytes[7] == 0.toByte())
            val n = ByteBuffer.wrap(bytes, 24, 4).int
            require(n in 33..1048608 && bytes.size == 28 + n)
        }
        internal fun advancePreparedInitialReceiveFrame(original: ByteArray, supplied: ByteArray,
                                                        advance: () -> Long): Long {
            validateInitialSessionReceiveFrame(original); validateInitialSessionReceiveFrame(supplied)
            return advanceExactPreparedFrame(original, supplied, advance)
        }

        internal fun validateInitialSessionFrame(bytes: ByteArray) {
            require(bytes.size >= 29 && bytes[0] == 89.toByte() && bytes[1] == 78.toByte() &&
                bytes[2] == 88.toByte() && bytes[3] == 77.toByte() && bytes[4] == 1.toByte() &&
                bytes[5] == 1.toByte() && bytes[6] == 4.toByte() && bytes[7] == 0.toByte())
            val n = ByteBuffer.wrap(bytes, 24, 4).int
            require(n in 1..65536 && bytes.size == 28 + n)
        }
        private fun advanceExactPreparedFrame(original: ByteArray, supplied: ByteArray,
                                              advance: () -> Long): Long {
            require(original.contentEquals(supplied)) { "VEIL_ORIGINAL_MESSAGE_INPUT_ALREADY_RETAINED" }
            val status = advance()
            require(status == 0L || status == 30L)
            return status
        }
        /** DATA dispatch controls, not a Native/Source capability constructor. */
        internal fun advancePreparedFrame(original: ByteArray, supplied: ByteArray,
                                          advance: () -> Long): Long {
            require(original.size >= 28)
            val direction = original[5].toInt()
            validateFrame(original, direction); validateFrame(supplied, direction)
            return advanceExactPreparedFrame(original, supplied, advance)
        }
        internal fun advancePreparedInitialFrame(original: ByteArray, supplied: ByteArray,
                                                 advance: () -> Long): Long {
            validateInitialSessionFrame(original); validateInitialSessionFrame(supplied)
            return advanceExactPreparedFrame(original, supplied, advance)
        }

        internal fun validateFrame(bytes: ByteArray, direction: Int) {
            require(bytes.size >= 28 && bytes[0] == 89.toByte() && bytes[1] == 78.toByte() &&
                bytes[2] == 88.toByte() && bytes[3] == 77.toByte() && bytes[4] == 1.toByte() &&
                bytes[5].toInt() == direction && bytes[7] == 0.toByte())
            require(if (direction == 1) bytes[6] == 1.toByte() else direction == 2 && bytes[6].toInt() in 2..3)
            val n = ByteBuffer.wrap(bytes,24,4).int
            require(n > 0 && n <= (if(direction == 1) 65536 else 1048576) && bytes.size == 28+n)
        }
    }
}

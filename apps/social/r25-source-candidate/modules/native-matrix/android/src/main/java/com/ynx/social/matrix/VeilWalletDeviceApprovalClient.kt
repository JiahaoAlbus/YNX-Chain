package com.ynx.social.matrix

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import com.ynxweb4.wallet.deviceapproval.DeviceApprovalResultV1
import com.ynxweb4.wallet.deviceapproval.IDeviceApprovalV1
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** The private Android transport for Main's original DEVICE review. */
internal class VeilWalletDeviceApprovalClient(context: Context) {
    private val app = context.applicationContext
    private val component = ComponentName(WALLET_PACKAGE, "com.ynxweb4.wallet.DeviceApprovalService")

    internal class Original(device: ByteArray, pair: ByteArray, digest: ByteArray) {
        private val device = device.copyOf()
        private val pair = pair.copyOf()
        private val digest = digest.copyOf()
        private val worker = Thread.currentThread()
        private var dispatchSelected = false

        init {
            require(this.device.size == 32 && this.pair.size == 32 && this.digest.size == 32)
        }

        fun requireOriginalWorker() {
            check(Thread.currentThread() === worker) { "DEVICE approval original worker changed" }
        }

        fun dispatchOnce(
            service: IDeviceApprovalV1,
            prepared: Prepared,
        ): DeviceApprovalResultV1? {
            requireOriginalWorker()
            check(prepared.original === this)
            if (dispatchSelected) return null
            dispatchSelected = true
            return service.dispatch(
                device.copyOf(), pair.copyOf(), digest.copyOf(),
                prepared.allocation, prepared.registration, prepared.request,
            )
        }

        fun query(service: IDeviceApprovalV1): DeviceApprovalResultV1? {
            requireOriginalWorker()
            return service.query(device.copyOf(), pair.copyOf(), digest.copyOf())
        }

        fun matches(result: DeviceApprovalResultV1): Boolean =
            device.contentEquals(result.deviceOperation) &&
                pair.contentEquals(result.pairOperation) && digest.contentEquals(result.requestDigest)

        fun decode(value: DeviceApprovalResultV1?): Result {
            if (value == null || !matches(value)) return Result.Unknown
            val approval = value.approvalOriginal
            val policy = value.policyOriginal
            val request = value.requestOriginal
            if (value.status == DeviceApprovalResultV1.APPROVED) {
                if (!validOriginal(approval, 196608) || !validOriginal(policy, 524288) ||
                    !validOriginal(request, MAX_ORIGINAL)
                ) return Result.Unknown
                return Result.Approved.fromWallet(
                    checkNotNull(approval).copyOf(),
                    checkNotNull(policy).copyOf(),
                    checkNotNull(request).copyOf(),
                )
            }
            if (approval != null || policy != null || request != null) return Result.Unknown
            return when (value.status) {
                DeviceApprovalResultV1.PENDING -> Result.Pending
                DeviceApprovalResultV1.DENIED -> Result.Denied
                else -> Result.Unknown
            }
        }
    }

    internal class Prepared private constructor(
        val original: Original,
        val allocation: ByteArray,
        val registration: ByteArray,
        val request: ByteArray,
    ) : AutoCloseable {
        override fun close() {
            allocation.fill(0)
            registration.fill(0)
            request.fill(0)
        }

        companion object {
            fun fromNative(bytes: ByteArray): Prepared {
                require(bytes.size in 111..(108 + 3 * MAX_ORIGINAL))
                val input = ByteBuffer.wrap(bytes)
                fun id() = ByteArray(32).also { input.get(it) }
                val original = Original(id(), id(), id())
                // Validate the whole envelope before taking copies of the originals.
                val offsets = IntArray(3)
                val lengths = IntArray(3)
                for (i in offsets.indices) {
                    require(input.remaining() >= 4)
                    val length = input.int
                    require(length in 1..MAX_ORIGINAL && length <= input.remaining())
                    offsets[i] = input.position()
                    lengths[i] = length
                    input.position(input.position() + length)
                }
                require(!input.hasRemaining())
                fun copy(i: Int) = bytes.copyOfRange(offsets[i], offsets[i] + lengths[i])
                return Prepared(original, copy(0), copy(1), copy(2))
            }
        }
    }

    internal sealed interface Result {
        data object Pending : Result
        data object Denied : Result
        data object Unknown : Result

        /** Hand off on the original worker to Main's independent verification. */
        class Approved private constructor(
            val approval: ByteArray,
            val policy: ByteArray,
            val request: ByteArray,
        ) : Result, AutoCloseable {
            companion object {
                internal fun fromWallet(approval: ByteArray, policy: ByteArray, request: ByteArray) =
                    Approved(approval, policy, request)
            }

            override fun close() {
                approval.fill(0)
                policy.fill(0)
                request.fill(0)
            }
        }
    }

    /** Select dispatch only after this binding and current Wallet signer are verified. */
    fun review(prepared: Prepared, select: () -> Int): Result = transact(prepared.original) { service ->
        when (select()) {
            1 -> prepared.original.dispatchOnce(service, prepared)
            2 -> prepared.original.query(service)
            else -> null
        }
    }

    fun observe(original: Original): Result = transact(original, original::query)

    private fun transact(
        original: Original,
        operation: (IDeviceApprovalV1) -> DeviceApprovalResultV1?,
    ): Result {
        check(Looper.myLooper() !== Looper.getMainLooper()) { "DEVICE approval requires the original worker" }
        original.requireOriginalWorker()
        val connection = Connection(component)
        var bound = false
        var response: DeviceApprovalResultV1? = null
        try {
            if (!walletSignerCurrent()) return Result.Unknown
            bound = app.bindService(Intent().setComponent(component), connection, Context.BIND_AUTO_CREATE)
            if (!bound) return Result.Unknown
            val binder = connection.ready.get(5, TimeUnit.SECONDS) ?: return Result.Unknown
            if (connection.invalidated.get() || !binder.isBinderAlive ||
                binder.interfaceDescriptor != IDeviceApprovalV1.DESCRIPTOR || !walletSignerCurrent()
            ) return Result.Unknown
            response = operation(IDeviceApprovalV1.Stub.asInterface(binder))
            if (connection.invalidated.get() || !binder.isBinderAlive || !walletSignerCurrent()) return Result.Unknown
            return original.decode(response)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            return Result.Unknown
        } catch (_: Exception) {
            return Result.Unknown
        } finally {
            response?.approvalOriginal?.fill(0)
            response?.policyOriginal?.fill(0)
            response?.requestOriginal?.fill(0)
            if (bound) {
                // Binding can die while the worker is reading the response.
                try { app.unbindService(connection) } catch (_: IllegalArgumentException) { }
            }
        }
    }

    private fun walletSignerCurrent(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
        val resource = app.resources.getIdentifier(
            "ynx_wallet_device_approval_signer_sha256", "string", app.packageName,
        )
        if (resource == 0) return false
        val expected = app.resources.getString(resource)
        if (!expected.matches(Regex("[0-9a-f]{64}"))) return false
        @Suppress("DEPRECATION")
        val info = app.packageManager.getPackageInfo(WALLET_PACKAGE, PackageManager.GET_SIGNING_CERTIFICATES)
        val signer = info.signingInfo?.apkContentsSigners?.singleOrNull() ?: return false
        if (info.packageName != WALLET_PACKAGE || info.sharedUserId != null) return false
        val digest = MessageDigest.getInstance("SHA-256").digest(signer.toByteArray())
        val pin = ByteArray(32) { i -> expected.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
        return MessageDigest.isEqual(pin, digest)
    }

    private class Connection(private val component: ComponentName) : ServiceConnection {
        val ready = CompletableFuture<IBinder?>()
        val invalidated = AtomicBoolean()

        override fun onServiceConnected(name: ComponentName, service: IBinder) {
            if (name == component && !invalidated.get()) ready.complete(service) else invalidate()
        }

        override fun onServiceDisconnected(name: ComponentName) = invalidate()
        override fun onBindingDied(name: ComponentName) = invalidate()
        override fun onNullBinding(name: ComponentName) = invalidate()

        private fun invalidate() {
            invalidated.set(true)
            ready.complete(null)
        }
    }

    private companion object {
        const val WALLET_PACKAGE = "com.ynxweb4.wallet"
        const val MAX_ORIGINAL = 256 * 1024

        fun validOriginal(bytes: ByteArray?, maximum: Int): Boolean =
            bytes != null && bytes.size in 1..maximum
    }
}

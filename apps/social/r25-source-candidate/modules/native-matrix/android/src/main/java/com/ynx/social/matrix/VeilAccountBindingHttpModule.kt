package com.ynx.social.matrix

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Unregistered public transport; never constructs a crypto/device owner. */
class VeilAccountBindingHttpModule : Module() {
    private val transport = VeilAccountBindingHttpTransport()
    override fun definition() = ModuleDefinition {
        Name("YNXSocialAccountBindingHttp")
        AsyncFunction("readBindingHttpEpoch") { transport.currentEpoch() }
        AsyncFunction("reserveBindingHttp") { epoch: String -> transport.reserve(epoch) }
        AsyncFunction("sendBindingHttp") { handle: String, epoch: String, token: String, promise: Promise ->
            try {
                transport.start(handle, epoch, token) { result ->
                    promise.resolve(mapOf("epoch" to result.epoch, "handle" to result.handle,
                        "status" to result.status, "body" to result.body, "error" to result.error))
                }
            } catch (_: Exception) { promise.reject("HTTP_HANDLE_REFUSED", "HTTP_HANDLE_REFUSED", null) }
        }
        AsyncFunction("cancelBindingHttp") { handle: String -> transport.cancel(handle) }
        AsyncFunction("advanceBindingHttpContext") { transport.advanceContext() }
        OnDestroy { transport.close() }
    }
}

package com.ynx.social.matrix

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Base64
import java.util.Collections
import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.Authenticator
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONObject
import org.json.JSONTokener

/** Normal same-worker product actor. Only the concrete, already accepted Source
 * can construct it. HTTP carries PUBLIC prekey originals/proofs, never messages,
 * private identity keys, ratchets, wallet credentials or decryption material.
 * The Source response is bound DATA, not client-created authority: the final
 * server still independently admits its Source policy/current and own/peer keys.
 */
internal class VeilInitialPrekeyHttp private constructor(
    private val source: VeilNativeMatrixSource,
    private val profile: Profile,
    private val http: OkHttpClient,
    private val ownerFence: () -> Unit
) {
    internal enum class Profile(val authority: String, val mount: String,
        val loginProfile: VeilSocialLoginProfile) {
        QA("127.0.0.1:18443", "/m1qa/v4/prekeys/", VeilSocialLoginProfile.M1_QA),
        PRODUCTION("social.ynxweb4.com", "/v4/prekeys/", VeilSocialLoginProfile.PRODUCTION)
    }
    private val worker = Thread.currentThread()
    private var active = false
    private var retained = false
    private var firstFailure: Throwable? = null
    private class Attempt(val key: String, val operation: String, val logical: String,
        val body: ByteArray, val transport: ByteArray, val deadline: Long) {
        var phase = "SELECTED"
        var native: Array<ByteArray>? = null
        var authorization: Receipt? = null
        var effect: Receipt? = null
        var first: Throwable? = null
        var publication: Publication? = null
        var claim: Claim? = null
        var retainedOriginal: JSONObject? = null
    }
    private data class Receipt(val status: Int, val bytes: ByteArray, val complete: Boolean)
    internal data class Publication(val operation: String, val bundleSha256: String,
        val account: String, val device: String)
    internal data class Claim(val peer: String, val peerDevice: String, val route: String,
        val logical: String, val canonicalBundle: ByteArray, val bundleSha256: String)

    /** Original public response DATA only. This is not a grant or effect result. */
    internal class AuthorizationObservationData(val state: String, val originalRequestSha256: String,
        val originalResponseSha256: String?, originalResponse: ByteArray?) {
        private val response = originalResponse?.copyOf()
        fun responseData(): ByteArray? = response?.copyOf()
    }
    private val attempts = linkedMapOf<String, Attempt>()

    private class AuthorizationReadAttempt(val key:String,val original:String,val body:ByteArray,val deadline:Long){
        var receipt:Receipt?=null;var nonce:ByteArray?=null;var frame:ByteArray?=null;var retainedNative:ByteArray?=null;var first:Throwable?=null
    }
    private val authorizationReads=linkedMapOf<String,AuthorizationReadAttempt>()
    private fun currentRead(attempt:AuthorizationReadAttempt,fence:()->Unit):Long{
        current();check(active&&authorizationReads[attempt.original]===attempt&&attempt.first==null)
        fence();current();val remaining=attempt.deadline-System.nanoTime();check(remaining>0){"VEIL_PREKEY_READ_ORIGINAL_EXPIRED"};return remaining
    }
    private fun storeAuthorizationRead(attempt:AuthorizationReadAttempt,phase:String,fact:AuthorizationObservationData?=null){
        current()
        source.recordStore.transaction(VeilMatrixProductBinding.RecordAccess.WRITE){records->
            val original=checkNotNull(records.history(attempt.key));validateRow(original,attempt.key)
            require(sha(publicBytes(original.get("nativeAuthorize"),655360))==attempt.original)
            // Clone and augment only. Original phase/nonce/results/first failure stay intact.
            val row=JSONObject(original.toString());val read=JSONObject().put("version",1).put("originalRequestSHA256",attempt.original).put("phase",phase)
            attempt.nonce?.let{read.put("nonce",b64(it))};attempt.frame?.let{read.put("frame",b64(it))}
            attempt.receipt?.let{read.put("receipt",JSONObject().put("status",it.status).put("complete",it.complete).put("bytes",b64(it.bytes)))}
            attempt.retainedNative?.let{read.put("nativeRetainedData",b64(it))}
            fact?.let{read.put("state",it.state);it.originalResponseSha256?.let{sha->read.put("originalResponseSHA256",sha)}}
            read.put("failureRetained",attempt.first!=null);row.put("authorizationRead",read);records.history(attempt.key,row)
        }
        current()
    }
    private fun executeAuthorizationRead(attempt:AuthorizationReadAttempt,proof:ByteArray,fence:()->Unit):Receipt{
        require(proof.size in 1..655360);currentRead(attempt,fence)
        val url=target("authorize/query");val payload=attempt.body.copyOf();var selected=false
        val requestBody=object:RequestBody(){
            override fun contentType()="application/json".toMediaType()
            override fun contentLength()=payload.size.toLong()
            override fun isOneShot()=true
            override fun writeTo(sink:BufferedSink){check(!selected){"VEIL_PREKEY_READ_BODY_ALREADY_SELECTED"};selected=true;currentRead(attempt,fence);sink.write(payload);currentRead(attempt,fence)}
        }
        val original=requestBuilder(profile, "authorize/query", requestBody)
            .header("X-YNX-Source-Prekey-Read",b64(proof)).build()
        val call=http.newCall(original);call.timeout().timeout(currentRead(attempt,fence),TimeUnit.NANOSECONDS)
        val buffer=ByteArrayOutputStream();var status=0;var complete=false
        fun capture()=Receipt(status,buffer.toByteArray(),complete).also{attempt.receipt=it}
        try{
            call.execute().use{response->
                status=response.code;capture()
                check(response.request.url==url&&response.priorResponse==null){"VEIL_PREKEY_READ_REDIRECT_REFUSED"}
                require(response.headers.values("Content-Encoding").all{it.equals("identity",ignoreCase=true)})
                val body=checkNotNull(response.body);val declared=body.contentLength();require(declared in -1..AUTHORIZATION_QUERY_BYTES.toLong())
                val scratch=ByteArray(8192)
                try{val input=body.byteStream();var reads=0
                    while(true){currentRead(attempt,fence);check(++reads<=AUTHORIZATION_QUERY_BYTES+1)
                        val count=input.read(scratch,0,minOf(scratch.size,AUTHORIZATION_QUERY_BYTES+1-buffer.size()))
                        if(count<0)break;check(count>0&&buffer.size()+count<=AUTHORIZATION_QUERY_BYTES){"VEIL_PREKEY_READ_RESPONSE_LIMIT"};buffer.write(scratch,0,count);capture()
                    }
                    complete=true;val owned=capture();if(declared>=0)require(declared==owned.bytes.size.toLong())
                    require(response.header("Content-Type")?.substringBefore(';')?.trim()=="application/json");currentRead(attempt,fence)
                }finally{scratch.fill(0)}
            }
            val result=capture();currentRead(attempt,fence) // after response.close
            check(result.status==200&&result.complete){"VEIL_PREKEY_READ_HTTP_STATUS_"+result.status};return result
        }catch(error:Throwable){capture();throw error}finally{payload.fill(0)}
    }
    /** Called by the existing normal publish/session retry path, never a demo.
     * Observing authorization does not publish a bundle or establish a session. */
    private fun authorizationOriginalData(original:Array<ByteArray>,body:ByteArray,transport:ByteArray,logical:String,operation:String):Pair<Frame,Map<String,Any>>{
        require(original.size==3&&original[0].size in 1..655360&&original[1].size in 1..16384&&original[2].size==32)
        val frame=decodeFrameData(original[1])
        require(frame.actor==account&&frame.logical==logical&&frame.operation==operation&&frame.hashes[4].contentEquals(digest(body))&&frame.hashes[5].contentEquals(digest(transport))&&frame.hashes[6].contentEquals(original[2]))
        val authorize=flatData(original[0],AUTHORIZE_FIELDS,655360,canonicalOrder=true)
        require(authorize["version"]==1&&publicBytes(authorize["requestBody"],16384).contentEquals(body)&&publicBytes(authorize["transportOriginal"],8192).contentEquals(transport))
        for((key,limit,index)in listOf(Triple("accountRoot",16384,0),Triple("accountRegistration",16384,1),Triple("deviceOriginals",393216,2)))require(digest(publicBytes(authorize[key],limit)).contentEquals(frame.hashes[index]))
        matchProofData(publicBytes(authorize["deviceProof"],32768),original[1]);return frame to authorize
    }
    private fun restoreRetainedNativeAuthorization(row:JSONObject):JSONObject?{
        val id=row.getString("key");validateRow(row,id)
        val body=publicBytes(row.get("effectBody"),16384);val transport=publicBytes(row.get("effectTransport"),8192)
        val raw=source.retainedInitialPrekeyRequest(body,transport) // QUERY ONLY, never prepare/produce
        current()
        source.recordStore.transaction(VeilMatrixProductBinding.RecordAccess.WRITE){records->
            val old=checkNotNull(records.history(id));validateRow(old,id)
            require(authorizationReadEligibleData(old.getString("phase"))&&publicBytes(old.get("effectBody"),16384).contentEquals(body)&&publicBytes(old.get("effectTransport"),8192).contentEquals(transport))
            val saved=JSONObject(old.toString()).put("nativeRequestRetainedData",b64(raw));records.history(id,saved)
        }
        current();val original=VeilNativePrekeyRequestJni.retainedAuthorizeData(raw)?:return null
        authorizationOriginalData(original,body,transport,row.getString("logical"),row.getString("operation"))
        current()
        val restored=source.recordStore.transaction(VeilMatrixProductBinding.RecordAccess.WRITE){records->
            val old=checkNotNull(records.history(id));validateRow(old,id)
            require(authorizationReadEligibleData(old.getString("phase"))&&publicBytes(old.get("effectBody"),16384).contentEquals(body)&&publicBytes(old.get("effectTransport"),8192).contentEquals(transport))
            if(old.has("nativeAuthorize")){
                require(publicBytes(old.get("nativeAuthorize"),655360).contentEquals(original[0])&&publicBytes(old.get("nativeFrame"),16384).contentEquals(original[1])&&publicBytes(old.get("nativeNonce"),32).contentEquals(original[2]));old
            }else{
                val saved=JSONObject(old.toString()).put("nativeAuthorize",b64(original[0])).put("nativeFrame",b64(original[1])).put("nativeNonce",b64(original[2]))
                records.history(id,saved);saved
            }
        }
        current();return restored // same phase/first failure; this grants no write effect
    }
    private fun reconcileOriginalAuthorization(row:JSONObject,budgetMs:Long):AuthorizationObservationData?{
        checked();validateRow(row,row.getString("key"));require(budgetMs in 1L..30000L)
        if(!authorizationReadEligibleData(row.getString("phase"))||row.has("authorizationRead"))return null
        val originalRow=if(row.has("nativeAuthorize"))row else restoreRetainedNativeAuthorization(row)?:return null
        check(!active&&authorizationReads.size<32){"VEIL_PREKEY_READ_BUSY_OR_CAPACITY"}
        val original=sha(publicBytes(originalRow.get("nativeAuthorize"),655360));check(!authorizationReads.containsKey(original)){"VEIL_PREKEY_READ_ORIGINAL_READBACK_ONLY"}
        val body=authorizationQueryBodyData(original);val route=transport("authorize/query")
        val attempt=AuthorizationReadAttempt(row.getString("key"),original,body,System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(budgetMs))
        authorizationReads[original]=attempt;active=true;var fact:AuthorizationObservationData?=null
        try{
            storeAuthorizationRead(attempt,"ATTEMPTED")
            source.withInitialPrekeyAuthorizationRead(body,route,budgetMs){proof,frame,nonce,fence->
                attempt.frame=frame;attempt.nonce=nonce;storeAuthorizationRead(attempt,"PROOF_OBSERVED");currentRead(attempt,fence)
                val response=executeAuthorizationRead(attempt,proof,fence)
                val parsed=authorizationObservationData(response.bytes,original);fact=parsed
                currentRead(attempt,fence);storeAuthorizationRead(attempt,"FACTS_OBSERVED",parsed);currentRead(attempt,fence)
            }
            current();return fact
        }catch(error:Throwable){
            if(attempt.first==null)attempt.first=error
            if(firstFailure==null)firstFailure=error
            try{attempt.retainedNative=source.retainedInitialPrekeyAuthorizationRead(body,route)}catch(secondary:Throwable){if(secondary!==error)try{error.addSuppressed(secondary)}catch(_:Throwable){}}
            try{storeAuthorizationRead(attempt,"UNKNOWN",fact)}catch(secondary:Throwable){if(secondary!==error)try{error.addSuppressed(secondary)}catch(_:Throwable){}}
            throw error
        }finally{active=false}
    }
    private val account = source.identity().accountViewRef
    init {
        current()
        source.recordStore.transaction(VeilMatrixProductBinding.RecordAccess.READ) { records ->
            val index = records.history(INDEX) ?: return@transaction
            validateIndex(index)
            val ids = index.getJSONArray("ids")
            for (i in 0 until ids.length()) {
                val id = ids.getString(i)
                val row = checkNotNull(records.history(id)) { "VEIL_PREKEY_HTTP_JOURNAL_REQUIRED" }
                validateRow(row, id)
                if (row.getString("phase") !in setOf("PUBLISHED", "SESSION_ESTABLISHED")) retained = true
            }
        }
        current()
    }
    fun uses(original: VeilNativeMatrixSource): Boolean { checked(); return source === original }
    /** Inventory only. No current, network, fresh proof, callback or deletion. */
    fun hasRetainedWork(): Boolean { checked(); return retained || active }
    fun retainedFailure(): Throwable? { checked(); return firstFailure }
    private fun checked() = check(Thread.currentThread() === worker) { "VEIL_PRODUCT_WRONG_WORKER" }
    private fun current() { checked(); ownerFence(); source.checkCurrent(); ownerFence() }
    private fun current(attempt: Attempt, nativeFence: () -> Unit): Long {
        current(); check(active && attempts[attempt.key] === attempt && attempt.first == null)
        nativeFence(); current()
        val remaining = attempt.deadline - System.nanoTime()
        check(remaining > 0) { "VEIL_PREKEY_HTTP_ORIGINAL_EXPIRED" }
        return remaining
    }
    private fun key(operation: String, logical: String) = "prekey-http-" + sha((operation + "\u0000" + logical).toByteArray(Charsets.UTF_8))
    private fun validateIndex(index: JSONObject) {
        require(index.keys().asSequence().toSet() == setOf("version", "account", "ids") &&
            index.get("version") == 1 && index.getString("account") == account)
        val ids = index.getJSONArray("ids")
        require(ids.length() <= 32)
        val seen = hashSetOf<String>()
        for (i in 0 until ids.length()) require(Regex("prekey-http-[0-9a-f]{64}").matches(ids.getString(i)) && seen.add(ids.getString(i)))
    }
    private fun validateRow(row: JSONObject, id: String) {
        require(row.get("version") == 1 && row.getString("key") == id && row.getString("account") == account)
        require(row.getString("operation") in setOf("publish", "claim") &&
            row.getString("key") == key(row.getString("operation"), row.getString("logical")))
        require(row.getString("phase") in PHASES)
    }
    private fun read(key: String): JSONObject? {
        current()
        return source.recordStore.transaction(VeilMatrixProductBinding.RecordAccess.READ) { records ->
            records.history(key)?.also { validateRow(it, key) }
        }.also { current() }
    }
    private fun select(operation: String, logical: String, body: ByteArray, transport: ByteArray, budgetMs: Long): Attempt {
        checked(); check(!active) { "VEIL_PREKEY_HTTP_REENTRANT" }
        require(budgetMs in 1L..30000L)
        val id = key(operation, logical)
        // Refuse before modifying an earlier original, nonce, result or failure.
        check(!attempts.containsKey(id)) { "VEIL_PREKEY_HTTP_ORIGINAL_ALREADY_SELECTED" }
        check(read(id) == null) { "VEIL_PREKEY_HTTP_ORIGINAL_READBACK_ONLY" }
        check(attempts.size < 32) { "VEIL_PREKEY_HTTP_CAPACITY" }
        val attempt = Attempt(id, operation, logical, body.copyOf(), transport.copyOf(),
            System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMs))
        attempts[id] = attempt; retained = true; active = true
        try { persist(attempt, "SELECTED", first = true) }
        catch (error: Throwable) {
            attempt.first = error; attempt.phase = "UNKNOWN"; active = false
            if (firstFailure == null) firstFailure = error
            throw error // no second transaction to disguise an unknown commit
        }
        return attempt
    }
    private fun persist(attempt: Attempt, phase: String, first: Boolean = false) {
        require(phase in PHASES)
        attempt.phase = phase // fence BEFORE any external storage/current call
        source.recordStore.transaction(VeilMatrixProductBinding.RecordAccess.WRITE) { records ->
            val index = records.history(INDEX) ?: JSONObject().put("version", 1).put("account", account).put("ids", org.json.JSONArray())
            validateIndex(index)
            val ids = index.getJSONArray("ids")
            val old = records.history(attempt.key)
            if (first) {
                check(old == null && ids.length() < 32 && (0 until ids.length()).none { ids.getString(it) == attempt.key })
                ids.put(attempt.key); records.history(INDEX, index)
            } else { checkNotNull(old); validateRow(old, attempt.key) }
            val row = (attempt.retainedOriginal?.let { JSONObject(it.toString()) } ?: JSONObject())
                .put("version", 1).put("key", attempt.key).put("account", account)
                .put("operation", attempt.operation).put("logical", attempt.logical).put("phase", phase)
                .put("effectBody", b64(attempt.body)).put("effectTransport", b64(attempt.transport))
            attempt.native?.let { row.put("nativeAuthorize", b64(it[0])).put("nativeFrame", b64(it[1])).put("nativeNonce", b64(it[2])) }
            fun receipt(name: String, value: Receipt?) { value?.let { row.put(name, JSONObject()
                .put("status", it.status).put("bytes", b64(it.bytes)).put("complete", it.complete)) } }
            receipt("authorization", attempt.authorization); receipt("effect", attempt.effect)
            attempt.publication?.let { row.put("published", JSONObject().put("operation", it.operation)
                .put("bundleSHA256", it.bundleSha256).put("account", it.account).put("device", it.device)) }
            attempt.claim?.let { row.put("claim", JSONObject().put("peer", it.peer).put("peerDevice", it.peerDevice)
                .put("route", it.route).put("logical", it.logical).put("bundle", b64(it.canonicalBundle)).put("bundleSHA256", it.bundleSha256)) }
            row.put("failureRetained", attempt.first != null)
            records.history(attempt.key, row)
        }
    }
    private fun fail(attempt: Attempt, error: Throwable): Nothing {
        if (attempt.first == null) attempt.first = error
        else if (attempt.first !== error) try { attempt.first!!.addSuppressed(error) } catch (_: Throwable) { }
        if (firstFailure == null) firstFailure = attempt.first
        retained = true; attempt.phase = "UNKNOWN"
        try { persist(attempt, "UNKNOWN") } catch (secondary: Throwable) {
            if (secondary !== attempt.first) try { attempt.first!!.addSuppressed(secondary) } catch (_: Throwable) { }
        }
        throw checkNotNull(attempt.first)
    }
    private fun target(operation: String): HttpUrl = targetData(profile, operation)
    private fun transport(operation: String): ByteArray = transportData(profile, operation)
    private fun execute(attempt: Attempt, step: String, body: ByteArray, header: String?, fence: () -> Unit): Receipt {
        val isAuthorization = step == "authorize"
        check(step == "authorize" || step == attempt.operation)
        current(attempt, fence)
        persist(attempt, if (isAuthorization) "AUTHORIZATION_ATTEMPTED" else "EFFECT_ATTEMPTED")
        current(attempt, fence)
        val originalUrl = target(step)
        val payload = body.copyOf()
        val requestBody = object : RequestBody() {
            private var selected = false
            override fun contentType() = "application/json".toMediaType()
            override fun contentLength() = payload.size.toLong()
            override fun isOneShot() = true
            override fun writeTo(sink: BufferedSink) {
                check(!selected) { "VEIL_PREKEY_HTTP_BODY_ALREADY_SELECTED" }
                selected = true
                current(attempt, fence); sink.write(payload); current(attempt, fence)
            }
        }
        val request = requestBuilder(profile, step, requestBody)
        if (header != null) request.header("X-YNX-Source-Prekey", header)
        val originalRequest = request.build()
        val call = http.newCall(originalRequest)
        call.timeout().timeout(current(attempt, fence), TimeUnit.NANOSECONDS)
        val limit = if (isAuthorization) 1048576 else 32768
        val buffer = ByteArrayOutputStream()
        var responseStatus = 0
        var complete = false
        fun retainReceipt(): Receipt = Receipt(responseStatus, buffer.toByteArray(), complete).also {
            if (isAuthorization) attempt.authorization = it else attempt.effect = it
        }
        try {
            call.execute().use { response ->
                responseStatus = response.code
                retainReceipt() // owned BEFORE header/status/current callbacks
                check(response.request.url == originalUrl && response.priorResponse == null) { "VEIL_PREKEY_HTTP_REDIRECT_REFUSED" }
                require(response.headers.values("Content-Encoding").all { it.equals("identity", ignoreCase = true) })
                val responseBody = checkNotNull(response.body)
                val declared = responseBody.contentLength()
                require(declared in -1..limit.toLong())
                val scratch = ByteArray(8192)
                try {
                    val stream = responseBody.byteStream()
                    var reads = 0
                    while (true) {
                        current(attempt, fence)
                        check(++reads <= limit + 1)
                        val count = stream.read(scratch, 0, minOf(scratch.size, limit + 1 - buffer.size()))
                        if (count < 0) break
                        check(count > 0 && buffer.size() + count <= limit) { "VEIL_PREKEY_HTTP_RESPONSE_LIMIT" }
                        buffer.write(scratch, 0, count); retainReceipt()
                    }
                    complete = true
                    val observed = retainReceipt() // exact original, before ALL late fences
                    if (declared >= 0) require(declared == observed.bytes.size.toLong())
                    require(response.header("Content-Type")?.substringBefore(';')?.trim() == "application/json")
                    current(attempt, fence)
                } finally { scratch.fill(0) }
            }
            val result = retainReceipt()
            current(attempt, fence) // mandatory AFTER response.close()
            persist(attempt, if (isAuthorization) "AUTHORIZATION_OBSERVED" else "EFFECT_OBSERVED")
            current(attempt, fence)
            check(result.status == 200 && result.complete) { "VEIL_PREKEY_HTTP_STATUS_" + result.status }
            return result
        } catch (error: Throwable) {
            retainReceipt() // partial/status/output ownership survives cancellation
            throw error
        } finally { payload.fill(0) }
    }
    private fun perform(attempt: Attempt, budgetMs: Long, observed: (Map<String, Any>, Frame) -> Unit) {
        try {
            persist(attempt, "NATIVE_ATTEMPTED")
            source.withInitialPrekeyAuthorize(attempt.body, attempt.transport, budgetMs) { original, fence ->
                attempt.native = original // adopt before decoding or foreign checks
                persist(attempt, "NATIVE_OBSERVED")
                val (frame, authorize) = authorizationOriginalData(original,attempt.body,attempt.transport,attempt.logical,attempt.operation)
                val authorization = execute(attempt, "authorize", original[0], null, fence)
                val header = bindAuthorizationCarrierData(authorization.bytes, authorize, frame)
                current(attempt, fence)
                val result = execute(attempt, attempt.operation, attempt.body, header, fence)
                val fields = if (attempt.operation == "publish") PUBLISHED_FIELDS else CLAIMED_FIELDS
                observed(flatData(result.bytes, fields, 32768), frame)
                current(attempt, fence)
                persist(attempt, if (attempt.operation == "publish") "PUBLISHED" else "CLAIMED")
                current(attempt, fence)
            }
            current()
            if (attempt.operation == "publish") retained = hasUnfinishedRows()
        } catch (error: Throwable) { fail(attempt, error) }
        finally { active = false }
    }
    private fun hasUnfinishedRows(): Boolean = source.recordStore.transaction(VeilMatrixProductBinding.RecordAccess.READ) { records ->
        val index = records.history(INDEX) ?: return@transaction false
        validateIndex(index); val ids = index.getJSONArray("ids")
        (0 until ids.length()).any { i -> val id=ids.getString(i);val row=checkNotNull(records.history(id));validateRow(row,id);row.getString("phase") !in setOf("PUBLISHED","SESSION_ESTABLISHED") }
    }
    /** Called by the normal product owner with the SAME original fd2 from its
     * actual FirstDeviceIntent/public-original cache, never a bundle hash ID. */
    fun ensureOwnPublished(operation: String, budgetMs: Long = 30000): Publication {
        checked(); require(operation.startsWith("fd2-") && publicBytes(operation.removePrefix("fd2-"),32).size==32)
        val id = key("publish", operation)
        read(id)?.let { row ->
            if(row.getString("phase")!="PUBLISHED"){reconcileOriginalAuthorization(row,budgetMs);error("VEIL_PREKEY_HTTP_ORIGINAL_READBACK_ONLY")}
            val p=row.getJSONObject("published")
            require(p.getString("operation")==operation && p.getString("account")==account)
            current();return Publication(operation,p.getString("bundleSHA256"),account,p.getString("device"))
        }
        val bundle = source.initialPublicBundle()
        val body = ("{\"operation\":\"" + operation + "\",\"bundle\":\"" + b64(bundle) + "\",\"bundleSHA256\":\"" + sha(bundle) + "\"}").toByteArray(Charsets.UTF_8)
        val attempt = select("publish", operation, body, transport("publish"), budgetMs)
        perform(attempt,budgetMs) { value, frame ->
            require(value["version"]==1 && value["state"]=="PUBLIC_PREKEYS_PUBLISHED" && value["operation"]==operation && value["bundleSHA256"]==sha(bundle))
            attempt.publication=Publication(operation,sha(bundle),frame.actor,frame.device)
        }
        return checkNotNull(attempt.publication)
    }
    /** Existing accepted route + public locator DATA -> real claim -> SAME
     * business/Native initial-session producer. No second logical or UI action.
     * Locator values do not authorize a peer: Source and Native verify it. */
    /** Resume only a durably confirmed claim whose Native session was never
     * selected. This reads PUBLIC originals; it never repeats authorization,
     * consumes another prekey or turns an UNKNOWN result into a grant. */
    private fun restoreConfirmedClaim(row: JSONObject, peer: String, peerDevice: String,
        route: String, logical: String, budgetMs: Long): Attempt {
        checked(); validateRow(row, row.getString("key"))
        check(!active && !attempts.containsKey(row.getString("key"))) { "VEIL_PREKEY_HTTP_ORIGINAL_ALREADY_SELECTED" }
        require(budgetMs in 1L..30000L); check(attempts.size < 32) { "VEIL_PREKEY_HTTP_CAPACITY" }
        val claim = confirmedClaimData(row, account, peer, peerDevice, route, logical)
        val body = publicBytes(row.get("effectBody"), 16384)
        val originalTransport = publicBytes(row.get("effectTransport"), 8192)
        require(originalTransport.contentEquals(transport("claim")))
        val native = arrayOf(publicBytes(row.get("nativeAuthorize"), 655360),
            publicBytes(row.get("nativeFrame"), 16384), publicBytes(row.get("nativeNonce"), 32))
        val (frame, request) = authorizationOriginalData(native, body, originalTransport, logical, "claim")
        val authorization = retainedSuccessfulReceiptData(row.getJSONObject("authorization"), 1048576)
        bindAuthorizationCarrierData(authorization, request, frame) // DATA binding, not renewed permission
        val effect = retainedSuccessfulReceiptData(row.getJSONObject("effect"), 32768)
        active = true // fence every foreign current/Native callback during recovery
        try {
            current()
            val ownBundle = source.initialPublicBundle()
            try { requireSameClassicIdentityData(ownBundle, frame.classicKey) }
            finally { ownBundle.fill(0) }
            current()
            val attempt = Attempt(row.getString("key"), "claim", logical, body, originalTransport,
                System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMs))
            attempt.phase = "CLAIMED"; attempt.native = native; attempt.claim = claim
            attempt.authorization = Receipt(200, authorization, true)
            attempt.effect = Receipt(200, effect, true)
            attempt.retainedOriginal = JSONObject(row.toString())
            attempts[attempt.key] = attempt; retained = true
            return attempt
        } finally { active = false }
    }
    fun claimAndEstablish(business: VeilNativeMessageBusiness, command: Map<String,Any?>,
        context: Map<String,Any?>, peerDevice: String, logical: String, budgetMs: Long = 30000): Map<String,Any?> {
        checked(); check(!active) { "VEIL_PREKEY_HTTP_REENTRANT" }; current(); require(command["type"]=="establishSession")
        val uuid=UUID.fromString(logical);require(uuid.version()==4&&uuid.variant()==2&&uuid.toString()==logical)
        require(peerDevice.length in 1..128 && peerDevice.all { it.code in 33..126 })
        val conversation=command["conversationId"] as? String ?: error("VEIL_PREKEY_CONVERSATION_REQUIRED")
        val route=source.routes().single { it.id==conversation }
        val peer=route.peerIdentifier
        val body=claimBodyData(peer,peerDevice,route.id,logical)
        val originalRow=read(key("claim",logical))
        val attempt=if(originalRow!=null){
            if(originalRow.getString("phase")!="CLAIMED"){
                reconcileOriginalAuthorization(originalRow,budgetMs)
                error("VEIL_PREKEY_HTTP_ORIGINAL_READBACK_ONLY")
            }
            restoreConfirmedClaim(originalRow,peer,peerDevice,route.id,logical,budgetMs)
        }else{
            val selected=select("claim",logical,body,transport("claim"),budgetMs)
            perform(selected,budgetMs) { value, _ ->
                require(value["version"]==1&&value["state"]=="PUBLIC_PREKEYS_CLAIMED"&&value["peer"]==peer&&value["peerDevice"]==peerDevice&&value["route"]==route.id&&value["logical"]==logical)
                val bundle=publicBytes(value["bundle"],16384);val digest=sha(bundle)
                require(value["bundleSHA256"]==digest)
                selected.claim=Claim(peer,peerDevice,route.id,logical,bundle,digest)
            }
            selected
        }
        active=true
        try {
            current();persist(attempt,"SESSION_ATTEMPTED");current()
            val original=checkNotNull(attempt.claim)
            // Both normal and confirmed-only recovery enter the same real Core.
            // Never re-enter this producer for SESSION_ATTEMPTED/UNKNOWN.
            val result=business.establishSession(command,context,logical,original.canonicalBundle.copyOf())
            current()
            if(result["completion"]=="confirmed"&&result["originalOperationRef"]==logical){
                persist(attempt,"SESSION_ESTABLISHED");current();retained=hasUnfinishedRows()
            }
            return result
        }catch(error:Throwable){fail(attempt,error)}
        finally{active=false}
    }
    /** Read-only PUBLIC journal, no Source grant, new nonce/signature, HTTP POST
     * or replacement session. Actual server same-nonce query is a separate API. */
    fun retainedState(operation: String, logical: String): String? { checked();return read(key(operation,logical))?.getString("phase") }
    internal data class Frame(val operation:String,val actor:String,val device:String,val logical:String,val hashes:Array<ByteArray>,val classicKey:ByteArray)
    companion object {
        private const val INDEX="normal-initial-prekey-http-index-v1"
        private val PHASES=setOf("SELECTED","NATIVE_ATTEMPTED","NATIVE_OBSERVED","AUTHORIZATION_ATTEMPTED","AUTHORIZATION_OBSERVED","EFFECT_ATTEMPTED","EFFECT_OBSERVED","PUBLISHED","CLAIMED","SESSION_ATTEMPTED","SESSION_ESTABLISHED","UNKNOWN")
        private val AUTHORIZE_FIELDS=listOf("version","deviceProof","accountRoot","accountRegistration","deviceOriginals","requestBody","transportOriginal")
        private val SOURCE_FIELDS=listOf("version","accountRoot","accountRegistration","deviceOriginals","policy","issuerCurrent","anchorCurrent","sourceReference","nonce")
        private val PUBLISHED_FIELDS=listOf("bundleSHA256","operation","state","version")
        private val CLAIMED_FIELDS=listOf("bundle","bundleSHA256","logical","peer","peerDevice","route","state","version")
        internal fun claimBodyData(peer:String,device:String,route:String,logical:String):ByteArray {
            fun quote(value:String):String {
                require(value.isNotEmpty() && value.all { it.code in 33..126 })
                val out=StringBuilder("\"")
                for(c in value)when(c){'"'->out.append("\\\"");'\\'->out.append("\\\\");else->out.append(c)}
                return out.append('"').toString()
            }
            return ("{\"peer\":"+quote(peer)+",\"peerDevice\":"+quote(device)+",\"route\":"+quote(route)+",\"logical\":"+quote(logical)+"}").toByteArray(Charsets.UTF_8)
        }
        private fun digest(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes)
        private fun sha(bytes:ByteArray)=digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}
        private fun b64(bytes:ByteArray)=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        internal fun publicBytes(value:Any?,limit:Int):ByteArray {
            require(value is String && value.isNotEmpty() && value.length <= (limit.toLong()*4+2)/3 && value.all { it.isLetterOrDigit()&&it.code<128||it=='_'||it=='-' })
            val bytes=Base64.getUrlDecoder().decode(value);require(bytes.size in 1..limit && b64(bytes)==value);return bytes
        }
        private fun utf8(raw:ByteArray)=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString()
        /** Strict PUBLIC flat transport parser. No nested proof/authority or
         * successful validation result is constructed by this DATA helper. */
        internal fun flatData(raw:ByteArray,fields:List<String>,limit:Int,canonicalOrder:Boolean=false):Map<String,Any> =
            flatOptionalData(raw,fields,emptyList(),limit,canonicalOrder)
        private fun flatOptionalData(raw:ByteArray,fields:List<String>,optional:List<String>,limit:Int,canonicalOrder:Boolean):Map<String,Any> {
            require(raw.size in 2..limit && fields.size==fields.toSet().size && optional.size==optional.toSet().size && fields.none{it in optional})
            val allowed=fields+optional
            val text=utf8(raw);val p=JSONTokener(text);require(p.nextClean()=='{')
            val out=linkedMapOf<String,Any>()
            while(true){require(p.nextClean()=='"');val key=p.nextString('"');require(key in allowed&&!out.containsKey(key));require(p.nextClean()==':');val lead=p.nextClean();require(lead=='"'||lead in '0'..'9');p.back();val value=p.nextValue();require(value is String || value is Int || value is Long);if(value is String)require(lead=='"');out[key]=value;when(p.nextClean()){'}'->break;','->Unit;else->error("VEIL_PREKEY_HTTP_JSON_INVALID")}}
            require(p.nextClean()=='\u0000' && out.keys.containsAll(fields))
            if(canonicalOrder){val selected=allowed.filter{out.containsKey(it)};require(out.keys.toList()==selected);val original=selected.joinToString(",","{","}"){key->"\""+key+"\":"+when(val value=out.getValue(key)){is String->{require(value.all{it.code in 33..126&&it!='"'&&it!='\\'});"\""+value+"\""};else->value.toString()}};require(original==text)}
            return Collections.unmodifiableMap(out)
        }
        /** Closed PUBLIC persisted-result codecs. None of these DATA results
         * grants identity, device, session or HTTP authority. */
        internal fun retainedSuccessfulReceiptData(value: JSONObject, limit: Int): ByteArray {
            require(value.keys().asSequence().toSet()==setOf("status","bytes","complete"))
            require(value.get("status")==200 && value.get("complete")==true)
            return publicBytes(value.get("bytes"),limit)
        }
        internal fun confirmedClaimData(row: JSONObject, account: String, peer: String,
            peerDevice: String, route: String, logical: String): Claim {
            val uuid=UUID.fromString(logical);require(uuid.version()==4&&uuid.variant()==2&&uuid.toString()==logical)
            require(row.get("version")==1&&row.getString("account")==account&&row.getString("operation")=="claim"&&row.getString("logical")==logical)
            require(row.getString("phase")=="CLAIMED"&&row.get("failureRetained")==false)
            require(publicBytes(row.get("effectBody"),16384).contentEquals(claimBodyData(peer,peerDevice,route,logical)))
            val response=retainedSuccessfulReceiptData(row.getJSONObject("effect"),32768)
            val value=flatData(response,CLAIMED_FIELDS,32768)
            require(value["version"]==1&&value["state"]=="PUBLIC_PREKEYS_CLAIMED"&&value["peer"]==peer&&value["peerDevice"]==peerDevice&&value["route"]==route&&value["logical"]==logical)
            val bundle=publicBytes(value["bundle"],16384);val digest=sha(bundle)
            require(value["bundleSHA256"]==digest)
            val saved=row.getJSONObject("claim")
            require(saved.keys().asSequence().toSet()==setOf("peer","peerDevice","route","logical","bundle","bundleSHA256"))
            require(saved.get("peer")==peer&&saved.get("peerDevice")==peerDevice&&saved.get("route")==route&&saved.get("logical")==logical&&saved.get("bundleSHA256")==digest)
            require(publicBytes(saved.get("bundle"),16384).contentEquals(bundle))
            return Claim(peer,peerDevice,route,logical,bundle,digest)
        }
        /** Exact selected YNXPKB1 public shape only. Native still verifies
         * the real key material, signatures, joint identity and current grant. */
        internal fun requireSameClassicIdentityData(raw: ByteArray, expected: ByteArray) {
            require(raw.size in 17..8192 && expected.size==33 && expected[0].toInt()==5)
            val b=ByteBuffer.wrap(raw);val magic=ByteArray(8);b.get(magic)
            require(magic.contentEquals("YNXPKB1\u0000".toByteArray(Charsets.UTF_8)))
            require(b.int in 1..16380 && b.int in 1..127)
            val tag=b.get().toInt() and 255;require(tag in 0..1)
            fun field():ByteArray {val n=b.short.toInt() and 65535;require(n in 1..4096&&n<=b.remaining());return ByteArray(n).also{b.get(it)}}
            fun classic():ByteArray=field().also{require(it.size==33&&it[0].toInt()==5)}
            if(tag==1){b.int;classic()}
            b.int;classic();require(field().size==64)
            val identity=classic();b.int;field();require(field().size==64&&!b.hasRemaining())
            require(identity.contentEquals(expected)) { "VEIL_PREKEY_CONFIRMED_CLAIM_DEVICE_CHANGED" }
        }
        // One MiB of original public response, base64url expansion and bounded
        // fixed metadata. Never apply this bound to private message ciphertext.
        internal fun authorizationReadEligibleData(phase:String):Boolean = phase in setOf("UNKNOWN","AUTHORIZATION_ATTEMPTED")
        internal const val AUTHORIZATION_QUERY_BYTES = ((1048576 + 2) / 3) * 4 + 512
        internal fun authorizationQueryBodyData(originalRequestSha256:String):ByteArray {
            require(Regex("[0-9a-f]{64}").matches(originalRequestSha256) && originalRequestSha256!="0".repeat(64))
            return ("{\"originalRequestSHA256\":\""+originalRequestSha256+"\"}").toByteArray(Charsets.UTF_8)
        }
        internal fun authorizationObservationData(raw:ByteArray,originalRequestSha256:String):AuthorizationObservationData {
            authorizationQueryBodyData(originalRequestSha256)
            val required=listOf("version","state","originalRequestSHA256")
            val optional=listOf("originalResponseSHA256","originalResponseData")
            val value=flatOptionalData(raw,required,optional,AUTHORIZATION_QUERY_BYTES,true)
            require(value["version"]==1 && value["originalRequestSHA256"]==originalRequestSha256)
            val state=value["state"] as? String ?: error("VEIL_PREKEY_QUERY_STATE_REQUIRED")
            require(state in setOf("PREKEY_AUTHORIZATION_NOT_OBSERVED","PREKEY_AUTHORIZATION_UNCONFIRMED","PREKEY_AUTHORIZATION_RESPONSE_OBSERVED"))
            if(state!="PREKEY_AUTHORIZATION_RESPONSE_OBSERVED") {
                require(optional.none{value.containsKey(it)})
                return AuthorizationObservationData(state,originalRequestSha256,null,null)
            }
            require(optional.all{value.containsKey(it)})
            val responseSha=value["originalResponseSHA256"] as? String ?: error("VEIL_PREKEY_QUERY_DIGEST_REQUIRED")
            require(Regex("[0-9a-f]{64}").matches(responseSha))
            val response=publicBytes(value["originalResponseData"],1048576)
            require(sha(response)==responseSha)
            return AuthorizationObservationData(state,originalRequestSha256,responseSha,response)
        }
        private fun matchProofData(proof:ByteArray,frame:ByteArray){val magic="YNXPKP1\u0000".toByteArray(Charsets.UTF_8);require(proof.size==12+frame.size+64+4627&&proof.copyOfRange(0,8).contentEquals(magic));val b=ByteBuffer.wrap(proof);b.position(8);require(b.int==frame.size);val same=ByteArray(frame.size);b.get(same);require(same.contentEquals(frame))}
        internal fun decodeFrameData(frame:ByteArray):Frame {
            require(frame.size in 1..16384);val domain="YNX/SOCIAL/INITIAL-PREKEY-DEVICE-REQUEST/V1\u0000".toByteArray(Charsets.UTF_8);val b=ByteBuffer.wrap(frame);val prefix=ByteArray(domain.size);b.get(prefix);require(prefix.contentEquals(domain)&&b.int==1);val operation=when(b.int){1->"publish";2->"claim";else->error("VEIL_PREKEY_FRAME_OPERATION")}
            fun bytes(cap:Int,absent:Boolean=false):ByteArray{val n=b.int;require(n in (if(absent)0 else 1)..cap&&n<=b.remaining());return ByteArray(n).also{b.get(it)}}
            val purpose=utf8(bytes(64));require(purpose==if(operation=="publish")"SOCIAL_INITIAL_PREKEY_PUBLISH_V1" else "SOCIAL_INITIAL_PREKEY_CLAIM_ONCE_V1")
            val hashes=Array(10){ByteArray(32).also{b.get(it)}};val actor=utf8(bytes(128));val device=utf8(bytes(128));val classic=bytes(33);require(classic.size==33&&bytes(2592).size==2592)
            val absent=operation=="publish";val targets=Array(4){utf8(bytes(256,absent))};val logical=utf8(bytes(128));if(absent)require(targets.all{it.isEmpty()})else require(targets[3]==logical)
            require(b.remaining()==64);b.position(b.position()+64);require(!b.hasRemaining());return Frame(operation,actor,device,logical,hashes,classic)
        }
        private fun bindAuthorizationCarrierData(raw:ByteArray,request:Map<String,Any>,frame:Frame):String {
            val value=flatData(raw,SOURCE_FIELDS,1048576,canonicalOrder=true)
            require(value["version"]==1)
            for(key in listOf("accountRoot","accountRegistration","deviceOriginals"))require(value[key]==request[key])
            require(publicBytes(value["sourceReference"],32).contentEquals(frame.hashes[3])&&publicBytes(value["nonce"],32).contentEquals(frame.hashes[6]))
            for(key in listOf("policy","issuerCurrent","anchorCurrent"))publicBytes(value[key],65536)
            // Preserve exact raw bytes. No parse/remarshal and no double base64.
            return b64(raw)
        }
        internal fun targetData(profile: Profile, operation: String): HttpUrl {
            require(operation in setOf("publish", "claim", "authorize", "authorize/query"))
            check("https://${profile.authority}" == profile.loginProfile.apiOrigin)
            return ("https://" + profile.authority + profile.mount + operation).toHttpUrl().also {
                check(it.encodedPath == profile.mount + operation && it.encodedQuery == null &&
                    it.encodedFragment == null && it.username.isEmpty() && it.password.isEmpty())
            }
        }
        internal fun transportData(profile: Profile, operation: String): ByteArray {
            val target = targetData(profile, operation)
            // The bytes given to Source signing and the actual HTTP target
            // share ONE fixed profile. Never sign an old authority and route
            // the same request to loopback, or rewrite a retained original.
            return ("{\"method\":\"POST\",\"authority\":\"" + profile.authority +
                "\",\"origin\":\"https://social.ynxweb4.com\",\"path\":\"" +
                target.encodedPath + "\"}").toByteArray(Charsets.UTF_8)
        }
        internal fun requestBuilder(profile: Profile, operation: String, body: RequestBody): Request.Builder {
            val request = Request.Builder().url(targetData(profile, operation)).post(body)
                .header("Origin", "https://social.ynxweb4.com")
                .header("Accept", "application/json").header("Accept-Encoding", "identity")
            request.header("Connection", "close")
            return request
        }
        internal fun configuredClient(profile: Profile): OkHttpClient {
            targetData(profile, "authorize") // fixed QA/production agreement before TLS setup
            val allowed = setOf("publish", "claim", "authorize", "authorize/query")
                .map { targetData(profile, it) }.toSet()
            val builder = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
                .retryOnConnectionFailure(false).cookieJar(CookieJar.NO_COOKIES)
                .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
                .connectTimeout(15,TimeUnit.SECONDS).readTimeout(15,TimeUnit.SECONDS).writeTimeout(15,TimeUnit.SECONDS)
                .addInterceptor { chain ->
                    val request = chain.request()
                    check(request.url in allowed && request.method == "POST" &&
                        request.header("Origin") == "https://social.ynxweb4.com" &&
                        request.headers.values("Connection") == listOf("close")) {
                        "VEIL_PREKEY_TRANSPORT_PROFILE_MISMATCH"
                    }
                    chain.proceed(request)
                }
            builder.protocols(listOf(Protocol.HTTP_1_1))
            return VeilSocialQaLoopbackTls.configure(builder, profile.loginProfile).build()
        }
        fun create(source:VeilNativeMatrixSource,packageName:String,ownerFence:()->Unit):VeilInitialPrekeyHttp {
            val profile=when(packageName){"com.ynx.social.m1qa"->Profile.QA;"com.ynx.social"->Profile.PRODUCTION;else->error("VEIL_PREKEY_HTTP_PROFILE_NOT_CONFIGURED")}
            return VeilInitialPrekeyHttp(source,profile,configuredClient(profile),ownerFence)
        }
    }
}

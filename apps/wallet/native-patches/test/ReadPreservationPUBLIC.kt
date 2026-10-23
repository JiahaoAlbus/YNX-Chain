package expo.modules.securestore

import expo.modules.kotlin.exception.CodedException
import java.security.GeneralSecurityException
import java.security.KeyStore.SecretKeyEntry
import java.security.KeyStore.PrivateKeyEntry
import javax.crypto.BadPaddingException
import javax.crypto.spec.SecretKeySpec
import kotlin.coroutines.*

// PUBLIC boundary doubles only. Actual unmodified reviewed getItemImpl and
// readJSONEncodedItem bodies are inserted below by the test. No Android device,
// real key, private preferences, replacement key or filesystem storage exists.
class KeyPermanentlyInvalidatedException : GeneralSecurityException("PUBLIC invalidated")
class JSONException : Exception("PUBLIC malformed")
class DecryptException(message: String?, key: String, service: String, cause: Throwable? = null) : CodedException("$message/$key/$service",cause)
class SecureStoreOptions(val keychainService: String = "PUBLIC-service")
class SharedPreferences(val values: MutableMap<String,String?> = mutableMapOf()) {
 fun contains(key: String) = values.containsKey(key)
 fun getString(key: String, fallback: String?) = values[key] ?: fallback
}
class JSONObject(val raw: String) {
 init {if(raw=="PUBLIC-malformed")throw JSONException()}
 fun optString(key: String) = if(key=="scheme")raw else ""
 fun optBoolean(key: String, fallback: Boolean) = if(key.isEmpty())false else fallback
}
object AuthenticationHelper {const val REQUIRE_AUTHENTICATION_PROPERTY="auth"}
object Log {fun w(tag: String, message: String) {check(tag.isNotEmpty()&&message.isNotEmpty())}}
class AESEncryptor {companion object {const val NAME="AES"}}
class HybridAESEncryptor {companion object {const val NAME="HYBRID"}}
class PublicReadFixture(val prefs: SharedPreferences,val failure: String = "") {
 val mAESEncryptor=AESEncryptor();val hybridAESEncryptor=HybridAESEncryptor();val authenticationHelper=AuthenticationHelper
 var deletes=0;var creates=0
 val originalCause: Throwable? = when(failure){"bad-padding"->BadPaddingException("PUBLIC bad padding");"invalidated"->KeyPermanentlyInvalidatedException();"general"->GeneralSecurityException("PUBLIC general");else->null}
 fun getSharedPreferences()=prefs
 fun createKeychainAwareKey(key:String,service:String)="$service-$key"
 @Suppress("UNUSED_PARAMETER","UNCHECKED_CAST")
 fun <T> getKeyEntryCompat(type:Class<T>,encryptor:Any,options:SecureStoreOptions,auth:Boolean,suffix:Boolean):T? {
  if(failure=="missing"||type==PrivateKeyEntry::class.java)return null
  return SecretKeyEntry(SecretKeySpec(ByteArray(16),"AES")) as T
 }
 @Suppress("UNUSED_PARAMETER")
 fun AESEncryptor.decryptItem(key:String,item:JSONObject,entry:SecretKeyEntry,options:SecureStoreOptions,auth:Any):String {originalCause?.let {throw it};return "PUBLIC-plaintext"}
 @Suppress("UNUSED_PARAMETER")
 fun HybridAESEncryptor.decryptItem(key:String,item:JSONObject,entry:PrivateKeyEntry,options:SecureStoreOptions,auth:Any):String {error("PUBLIC hybrid unavailable")}
 fun deleteItemImpl(key:String,options:SecureStoreOptions) {deletes++;prefs.values.remove(key);prefs.values.remove(createKeychainAwareKey(key,options.keychainService))}
 suspend fun read():String?=getItemImpl("PUBLIC-key",SecureStoreOptions())
 companion object {const val TAG="PUBLIC";const val SCHEME_PROPERTY="scheme";const val USES_KEYSTORE_SUFFIX_PROPERTY="suffix"}
// EXACT_REVIEWED_READ_METHODS
}
fun <T> sync(body:suspend()->T):T {var result:Result<T>?=null;body.startCoroutine(object:Continuation<T>{override val context=EmptyCoroutineContext;override fun resumeWith(value:Result<T>){result=value}});return result!!.getOrThrow()}
fun main() {
 var failures=0
 for((label,scheme,failure) in listOf(Triple("missing-AES","AES","missing"),Triple("missing-Hybrid","HYBRID","missing"),Triple("bad-padding","AES","bad-padding"),Triple("invalidated","AES","invalidated"),Triple("general-security","AES","general"),Triple("malformed","PUBLIC-malformed",""))) {
  val prefs=SharedPreferences(mutableMapOf("PUBLIC-key" to "PUBLIC-legacy-ciphertext","PUBLIC-service-PUBLIC-key" to scheme));val before=prefs.values.toMap();val fixture=PublicReadFixture(prefs,failure)
  val error=try{sync{fixture.read()};null}catch(e:Throwable){e}
  try {
   check(prefs.values==before&&fixture.deletes==0&&fixture.creates==0) {"$label changed original ciphertext or key references; deletes=${fixture.deletes}"}
   check(error is DecryptException) {"$label must fail closed, not return null/empty inventory"}
   if(fixture.originalCause!=null)check(error.cause===fixture.originalCause) {"$label lost original failure cause"}
   println("PASS $label ciphertext retained; no write/delete/key creation")
  } catch(e:Throwable) {failures++;println("FAIL ${e.message}")}
 }
 val healthy=PublicReadFixture(SharedPreferences(mutableMapOf("PUBLIC-service-PUBLIC-key" to "AES")))
 check(sync{healthy.read()}=="PUBLIC-plaintext"&&healthy.deletes==0);println("PASS existing current record decrypts normally")
 val legacy=PublicReadFixture(SharedPreferences(mutableMapOf("PUBLIC-key" to "AES")))
 check(sync{legacy.read()}=="PUBLIC-plaintext"&&legacy.deletes==0);println("PASS original legacy-key fallback remains readable without migration")
 val absent=PublicReadFixture(SharedPreferences());check(sync{absent.read()}==null&&absent.deletes==0);println("PASS truly missing record alone returns null")
 check(failures==0) {"PUBLIC read preservation failures=$failures"}
 println("PUBLIC_ONLY noDevice=1 actualKeyStore=0 writes=0")
}

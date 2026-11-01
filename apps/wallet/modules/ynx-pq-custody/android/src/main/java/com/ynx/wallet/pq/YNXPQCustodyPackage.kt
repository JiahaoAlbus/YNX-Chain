package com.ynx.wallet.pq
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
class YNXPQCustodyPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == "YNXPQCustody") YNXPQCustodyModule(reactContext) else null
    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf("YNXPQCustody" to ReactModuleInfo("YNXPQCustody", YNXPQCustodyModule::class.java.name, false, false, false, false))
    }
}

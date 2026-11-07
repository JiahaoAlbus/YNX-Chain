package com.ynxweb4.ai

import android.app.Activity
import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.ScrollView
import android.widget.TextView

/** Private actual Android review surface. Never a React/JS approval method. */
internal object NativeProtectedReview {
  private val main = Handler(Looper.getMainLooper())
  private var activity: Activity? = null
  private val dialogs = mutableMapOf<Long, AlertDialog>()
  @JvmStatic external fun bindNativeClass()
  @JvmStatic private external fun recordNativeEvent(id: Long, event: Int)

  fun attachActivity(actual: Activity) {
    check(Looper.myLooper() == Looper.getMainLooper())
    check(actual.javaClass.name == "com.ynxweb4.ai.MainActivity" && actual.packageName == "com.ynxweb4.ai")
    activity = actual
  }
  fun detachActivity(actual: Activity) {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (activity !== actual) return
    activity = null
    dialogs.toMap().forEach { (id, dialog) -> recordNativeEvent(id, 3); dialog.dismiss() }
  }
  @JvmStatic private fun isUIThreadNative(): Boolean = Looper.myLooper() == Looper.getMainLooper()
  @JvmStatic private fun presentationNative(raw: Array<ByteArray>): String = ProtectedReviewPresentation.render(raw)
  @JvmStatic private fun showNative(id: Long, presentation: String) {
    main.post {
      val current = activity
      if (current == null || current.isFinishing || current.isDestroyed || dialogs.isNotEmpty()) {
        recordNativeEvent(id, 3); recordNativeEvent(id, 5); return@post
      }
      try {
        val text = TextView(current).apply {
          this.text = presentation; setPadding(32, 24, 32, 24); textSize = 14f
          setTextIsSelectable(false); filterTouchesWhenObscured = true
        }
        val scroll = ScrollView(current).apply { addView(text) }
        val dialog = AlertDialog.Builder(current).setTitle("YNX AI · 原始任务请求").setView(scroll)
          .setPositiveButton("确认签署此请求") { _, _ -> recordNativeEvent(id, if (activity === current) 1 else 3) }
          .setNegativeButton("拒绝") { _, _ -> recordNativeEvent(id, 2) }
          .setNeutralButton("取消") { _, _ -> recordNativeEvent(id, 3) }.create()
        dialogs[id] = dialog // own partial before show/callbacks
        dialog.setCanceledOnTouchOutside(false)
        dialog.setOnCancelListener { recordNativeEvent(id, 3) }
        dialog.setOnDismissListener { dialogs.remove(id); recordNativeEvent(id, 5) }
        dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        dialog.show()
        dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        listOf(AlertDialog.BUTTON_POSITIVE, AlertDialog.BUTTON_NEGATIVE, AlertDialog.BUTTON_NEUTRAL).forEach { dialog.getButton(it).filterTouchesWhenObscured = true }
        recordNativeEvent(id, 4)
      } catch (_: Throwable) {
        recordNativeEvent(id, 3)
        val partial = dialogs[id]
        // No timeout-based ACK. A partially shown dialog must actually dismiss.
        if (partial != null && partial.isShowing) partial.dismiss()
        else { dialogs.remove(id); recordNativeEvent(id, 5) }
      }
    }
  }
  @JvmStatic private fun dismissNative(id: Long) { main.post { val dialog = dialogs[id]; if (dialog != null) dialog.dismiss() else recordNativeEvent(id, 5) } }
}

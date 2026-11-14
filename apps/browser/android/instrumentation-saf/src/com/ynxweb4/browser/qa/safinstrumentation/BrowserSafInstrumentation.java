package com.ynxweb4.browser.qa.safinstrumentation;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.UriPermission;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.graphics.Rect;
import android.graphics.Point;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;
import android.webkit.WebView;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** Platform-only, actual Main/SAF UI. No AndroidX, product reflection, fake results or preferences. */
public final class BrowserSafInstrumentation extends Instrumentation {
  private static final String TARGET = "com.ynxweb4.browser.qa";
  private static final String MAIN_CLASS = "com.ynxweb4.browser.MainActivity";
  private static final String EMPTY = "暂无已完成下载记录。";
  private Bundle arguments;
  private UiAutomation ui;
  private Activity mainActivity;
  private ActivityMonitor observedPicker;
  private String phase, downloadUrl, expectedSHA, expectedFilename, savedFilename, fixturePage;
  private long expectedBytes, timeoutMillis, deadline, lastHeartbeat;
  private final JSONObject result = new JSONObject();
  private final JSONArray events = new JSONArray();
  private final JSONArray windowSync = new JSONArray();

  @Override public void onCreate(Bundle args) {
    super.onCreate(args); arguments = args == null ? new Bundle() : new Bundle(args); start();
  }

  @Override public void onStart() {
    String status = "FAIL";
    try {
      parseArguments();
      result.put("schema", phase.equals("cancel_existing_picker") ? "YNX_ANDROID_SAF_PICKER_RECOVERY_V1" : "YNX_ANDROID_ACTUAL_SAF_V1").put("phase", phase)
        .put("downloadUrl", downloadUrl).put("expectedSHA256", expectedSHA)
        .put("expectedFilename", expectedFilename).put("savedFilename", savedFilename).put("expectedBytes", expectedBytes)
        .put("pid", Process.myPid()).put("processStartElapsed", Process.getStartElapsedRealtime())
        .put("sdk", android.os.Build.VERSION.SDK_INT).put("events", events);
      require(TARGET.equals(getTargetContext().getPackageName()), "WRONG_TARGET", "Only the dedicated Browser QA target is accepted");
      deadline = SystemClock.elapsedRealtime() + timeoutMillis;
      ui = getUiAutomation();
      AccessibilityServiceInfo info = ui.getServiceInfo();
      info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS | AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
      ui.setServiceInfo(info);
      if (phase.equals("cancel_existing_picker")) {
        result.put("recoveryOnly", true).put("businessAcceptance", "NOT_EVALUATED");
        recoverExistingPicker(); status = "PASS"; return;
      }
      // Start the real product entry, with no test extras or private download-method invocation.
      mainActivity = startActivitySync(new Intent(Intent.ACTION_MAIN).setComponent(new ComponentName(TARGET, MAIN_CLASS))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      awaitMainAddress();
      step("main-ready", new JSONObject());
      if ("reopen".equals(phase)) reopen(); else transfer();
      status = "PASS";
    } catch (Failure error) {
      status = error.status; put(result, "failureCode", error.code); put(result, "detail", error.getMessage());
    } catch (Throwable error) {
      status = "FAIL"; put(result, "failureCode", error.getClass().getSimpleName());
      put(result, "detail", safe(error.getMessage()));
    } finally {
      put(result, "status", status); put(result, "events", events); put(result, "windowSync", windowSync);
      try { put(result, "lastMainReadOnly", mainReadOnly()); } catch (Throwable ignored) {}
      put(result, "downloadListenerObservation", "No public read-only getter; listener is not replaced; UI/intent evidence only");
      put(result, "durationElapsedMillis", deadline == 0 ? 0 : Math.max(0, timeoutMillis - Math.max(0, deadline - SystemClock.elapsedRealtime())));
      if (ui != null) try { put(result, "lastTargetUI", summary(TARGET)); put(result, "lastDocumentsUI", documentsSummary()); } catch (Throwable ignored) {}
      Bundle output = new Bundle(); output.putString("safJson", result.toString());
      output.putString("ynx_result", result.toString());
      output.putString("stream", "P05_SAF " + status + " " + (phase == null ? "invalid-arguments" : phase) + "\n");
      finish("PASS".equals(status) ? Activity.RESULT_OK : Activity.RESULT_CANCELED, output);
    }
  }

  private void parseArguments() throws Exception {
    phase = arguments.getString("phase", "");
    require(phase.equals("cancel") || phase.equals("save") || phase.equals("reopen") || phase.equals("cancel_existing_picker"),
      "INVALID_PHASE", "phase must be cancel/save/reopen/cancel_existing_picker");
    if (phase.equals("cancel_existing_picker")) {
      downloadUrl = ""; expectedSHA = ""; fixturePage = ""; savedFilename = ""; expectedBytes = -1;
      expectedFilename = arguments.getString("expectedFilename", "");
      require(expectedFilename.matches("YNX-[A-Za-z0-9._-]{1,120}"), "RECOVERY_FILENAME_REQUIRED", "Supply the actual owned synthetic picker filename");
      long seconds = Long.parseLong(arguments.getString("timeoutSeconds", "20"));
      require(seconds >= 10 && seconds <= 30, "INVALID_TIMEOUT", "Recovery timeoutSeconds must be 10..30");
      timeoutMillis = seconds * 1000; return;
    }
    downloadUrl = webUrl(arguments.getString("downloadUrl", ""), false);
    expectedSHA = arguments.getString("expectedSHA", "").toLowerCase(java.util.Locale.ROOT);
    require(expectedSHA.matches("[0-9a-f]{64}"), "INVALID_SHA", "expectedSHA must be SHA256 hex");
    fixturePage = arguments.getString("fixturePage", "");
    if (!fixturePage.isEmpty()) fixturePage = webUrl(fixturePage, true);
    String fallback = Uri.parse(downloadUrl).getLastPathSegment();
    expectedFilename = arguments.getString("expectedFilename", fallback == null ? "" : fallback);
    require(expectedFilename.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,127}"), "INVALID_FILENAME", "Use one safe synthetic attachment name");
    savedFilename = arguments.getString("savedFilename", "");
    if (phase.equals("save") && savedFilename.isEmpty())
      savedFilename = "YNX-synthetic-" + Process.myPid() + "-" + SystemClock.elapsedRealtime() + extension(expectedFilename);
    if (!phase.equals("cancel")) require(savedFilename.matches("YNX-[A-Za-z0-9._-]{1,120}"),
      "INVALID_SAVED_FILENAME", "save/reopen require a unique YNX- synthetic name; reuse save JSON on reopen");
    expectedBytes = Long.parseLong(arguments.getString("expectedBytes", "-1"));
    require(expectedBytes == -1 || expectedBytes >= 0 && expectedBytes <= 16 * 1024 * 1024, "INVALID_SIZE", "Synthetic readback is limited to 16MiB");
    long seconds = Long.parseLong(arguments.getString("timeoutSeconds", "90"));
    require(seconds >= 10 && seconds <= 120, "INVALID_TIMEOUT", "timeoutSeconds must be 10..120");
    timeoutMillis = seconds * 1000;
  }

  private static String webUrl(String value, boolean fixture) throws Exception {
    require(value.length() <= 4096 && !value.matches(".*[\\x00-\\x20\\x7f\\\\].*"), "INVALID_URL", "Unsafe URL");
    URI uri = new URI(value);
    boolean loopback = "10.0.2.2".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost()) || "localhost".equals(uri.getHost());
    require(uri.getHost() != null && uri.getUserInfo() == null && uri.getFragment() == null
      && ("https".equals(uri.getScheme()) || fixture && loopback && "http".equals(uri.getScheme())),
      "INVALID_URL", "Attachment requires HTTPS; local fixture page may use loopback HTTP");
    return value;
  }

  private void transfer() throws Exception {
    Map<String, UriPermission> grantsBefore = grants();
    // New synthetic QA profile is a caller precondition, checked through the actual product UI.
    openDownloads(); require(emptyLibrary(), "QA_PROFILE_NOT_EMPTY", "Existing completed downloads found; nothing will be removed or overwritten"); closeDownloads();
    step("baseline-empty-library", new JSONObject().put("persistedGrantCount", grantsBefore.size()));
    IntentFilter pickerFilter = new IntentFilter(Intent.ACTION_CREATE_DOCUMENT);
    pickerFilter.addCategory(Intent.CATEGORY_OPENABLE); pickerFilter.addDataType("*/*");
    // Observation only: null result + block=false never supplies a URI/result or blocks an intent.
    ActivityMonitor pickerMonitor = addMonitor(pickerFilter, null, false);
    observedPicker = pickerMonitor;
    try {
      if (fixturePage.isEmpty()) navigate(downloadUrl);
      else {
        navigate(fixturePage);
        await("synthetic attachment link", () -> find(TARGET, "Download synthetic PDF", false) != null);
        click(TARGET, "Download synthetic PDF", false);
        step("real-web-attachment-click", new JSONObject().put("fixturePage", fixturePage)
          .put("accessibilityActionAccepted", true).put("navigationProof", "not inferred from accepted action")
          .put("mainReadOnly", mainReadOnly()));
      }
      await("system ACTION_CREATE_DOCUMENT", () -> documentsPackage() != null);
      result.put("observedCreateDocumentStarts", pickerMonitor.getHits());
      require(pickerMonitor.getHits() == 1, "PICKER_START_NOT_OBSERVED", "Expected exactly one actual, unblocked ACTION_CREATE_DOCUMENT start");
    } finally {
      result.put("observedCreateDocumentStarts", pickerMonitor.getHits());
      removeMonitor(pickerMonitor); observedPicker = null;
    }
    String documents = documentsPackage();
    require(documents != null, "NO_SYSTEM_PICKER", "DocumentsUI was not reached");
    result.put("documentsPackageDiagnostic", documentsPackageDiagnostic(documents));
    step("actual-system-picker", new JSONObject().put("package", documents).put("ui", summary(documents)));
    if (phase.equals("cancel")) {
      cancelPicker();
      await("Main after picker cancellation", () -> documentsPackage() == null && root(TARGET) != null);
      step("actual-picker-cancelled", new JSONObject().put("ui", summary(TARGET)));
      openDownloads();
      require(emptyLibrary(), "CANCEL_RECORDED_COMPLETION", "Cancelled picker created a completed-download row");
      // Re-sample the real dialog, without injecting a fake result or a completion callback.
      SystemClock.sleep(400); require(emptyLibrary(), "LATE_CANCEL_COMPLETION", "A late completion appeared after cancellation");
      require(grants().keySet().equals(grantsBefore.keySet()), "CANCEL_CREATED_PERSISTED_GRANT", "Cancellation unexpectedly retained a new document grant");
      result.put("cancelNoCompletedRecord", true).put("newPersistedGrantCount", 0);
      step("cancel-library-unchanged", new JSONObject().put("ui", summary(TARGET))); closeDownloads(); return;
    }
    // Exercise an actual user rename, not merely the server suggestion. Never confirm overwrite.
    await("system filename editor", () -> {
      AccessibilityNodeInfo editor = findClass(documents, "android.widget.EditText");
      return editor != null && editor.isEnabled() && editor.isVisibleToUser() && editor.getText() != null && editor.getText().length() > 0;
    });
    AccessibilityNodeInfo name = findClass(documents, "android.widget.EditText");
    require(name != null, "PICKER_FILENAME_MISSING", "System save filename editor is unavailable");
    String proposed = String.valueOf(name.getText());
    require(expectedFilename.equals(proposed), "PICKER_NAME_MISMATCH", "Expected " + expectedFilename + ", system proposed " + safe(proposed));
    Bundle rename = new Bundle(); rename.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, savedFilename);
    require(name.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, rename), "SYSTEM_RENAME_FAILED", "DocumentsUI refused the normal filename edit");
    await("system renamed filename", () -> {
      AccessibilityNodeInfo editor = findClass(documents, "android.widget.EditText");
      return editor != null && savedFilename.contentEquals(editor.getText() == null ? "" : editor.getText());
    });
    AccessibilityNodeInfo renamed = findClass(documents, "android.widget.EditText");
    require(renamed != null && savedFilename.contentEquals(renamed.getText() == null ? "" : renamed.getText()), "SYSTEM_RENAME_NOT_OBSERVED", "The actual filename edit was not retained");
    step("actual-system-rename", new JSONObject().put("suggestedFilename", proposed).put("savedFilename", savedFilename));
    clickSave(documents);
    step("actual-system-save-click", new JSONObject().put("filename", savedFilename));
    await("save return or explicit system refusal", () -> documentsPackage() == null || hasSystemOverwriteOrError());
    require(documentsPackage() == null, "SYSTEM_SAVE_REFUSED", documentsSummary());
    await("actual product download completion", () -> {
      String text = summary(TARGET);
      if (text.contains("下载 · failed") || text.contains("Download failed") || text.contains("下载 · cancelled"))
        throw new Failure("FAIL", "PRODUCT_DOWNLOAD_FAILED", text);
      return text.contains("下载 · completed");
    });
    step("actual-product-completed", new JSONObject().put("ui", summary(TARGET)));
    Map<String, UriPermission> after = grants(); after.keySet().removeAll(grantsBefore.keySet());
    require(after.size() == 1, "READBACK_GRANT_NOT_AVAILABLE", "Expected exactly one newly persisted actual document read grant; observed " + after.size());
    Map.Entry<String, UriPermission> selected = after.entrySet().iterator().next();
    JSONObject document = document(selected.getValue());
    result.put("savedGrantSHA256", selected.getKey()).put("document", document);
    verifyLibrary(document); closeDownloads();
  }

  private void reopen() throws Exception {
    String selected = arguments.getString("savedGrantSHA256", "");
    require(selected.matches("[0-9a-f]{64}"), "MISSING_SAVE_BINDING", "reopen requires savedGrantSHA256 from the save phase");
    String oldStart = arguments.getString("previousProcessStartElapsed", "");
    require(oldStart.matches("[0-9]+"), "MISSING_COLD_BINDING", "reopen requires previousProcessStartElapsed from save JSON");
    require(Long.parseLong(oldStart) != Process.getStartElapsedRealtime(), "NOT_COLD_PROCESS", "The save process is still running");
    UriPermission permission = grants().get(selected);
    require(permission != null, "PERSISTED_READ_GRANT_LOST", "Actual save document grant was not retained across process restart");
    JSONObject document = document(permission);
    verifyLibrary(document);
    result.put("savedGrantSHA256", selected).put("document", document).put("coldProcessObserved", true);
    step("cold-library-and-bytes-retained", new JSONObject().put("previousProcessStartElapsed", Long.parseLong(oldStart)));
    closeDownloads();
  }

  private JSONObject documentsPackageDiagnostic(String pkg) throws Exception {
    JSONObject diagnostic = new JSONObject().put("package", pkg).put("authority", "diagnostic-only");
    try {
      ApplicationInfo app = getTargetContext().getPackageManager().getApplicationInfo(pkg, 0);
      diagnostic.put("lookup", "available").put("systemAppFlag", (app.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0);
    } catch (android.content.pm.PackageManager.NameNotFoundException error) {
      diagnostic.put("lookup", "unknown-package-visibility");
    } catch (SecurityException error) { diagnostic.put("lookup", "unknown-access-restricted"); }
    // Package visibility is not document authority. Actual intent, allowed active picker window
    // and (for readback) a real system-issued URI grant remain mandatory, with no new permission.
    return diagnostic;
  }

  private void recoverExistingPicker() throws Exception {
    String pkg = documentsPackage();
    if (pkg == null) throw new Failure("INCOMPLETE", "NO_EXISTING_PICKER", "No current owned DocumentsUI; no activity or navigation was started");
    await("existing synthetic picker filename", () -> {
      AccessibilityNodeInfo editor = findClass(pkg, "android.widget.EditText");
      return editor != null && editor.isVisibleToUser() && editor.getText() != null && editor.getText().length() > 0;
    });
    AccessibilityNodeInfo editor = findClass(pkg, "android.widget.EditText");
    require(editor != null && expectedFilename.contentEquals(editor.getText()), "RECOVERY_PICKER_MISMATCH", "Current picker does not match the explicitly supplied owned synthetic filename");
    activeOwner(editor, pkg, Math.min(deadline, SystemClock.elapsedRealtime() + 5000), "existing synthetic picker");
    require(!hasSystemOverwriteOrError(), "RECOVERY_UNEXPECTED_REFUSAL", documentsSummary());
    result.put("existingPickerObserved", true).put("existingFilename", expectedFilename)
      .put("programmaticMainLaunch", false).put("documentsPackageDiagnostic", documentsPackageDiagnostic(pkg));
    step("existing-picker-confirmed", new JSONObject().put("package", pkg).put("filename", expectedFilename).put("ui", summary(pkg)));
    IntentFilter filter = new IntentFilter(Intent.ACTION_CREATE_DOCUMENT);
    filter.addCategory(Intent.CATEGORY_OPENABLE); filter.addDataType("*/*");
    ActivityMonitor monitor = addMonitor(filter, null, false); observedPicker = monitor;
    try {
      cancelPicker();
      final long[] absentSince = {0};
      await("existing picker stably dismissed", () -> {
        if (monitor.getHits() != 0) throw new Failure("INCOMPLETE", "NEW_PICKER_DURING_RECOVERY", "OS/product opened a new picker; no new picker is auto-cancelled or saved");
        if (documentsPackage() != null) { absentSince[0] = 0; return false; }
        if (absentSince[0] == 0) absentSince[0] = SystemClock.elapsedRealtime();
        return SystemClock.elapsedRealtime() - absentSince[0] >= 500;
      });
      result.put("pickerClosed", true);
      step("existing-picker-dismissed", new JSONObject().put("recoveryOnly", true).put("businessAcceptance", "NOT_EVALUATED"));
    } finally {
      result.put("newCreateDocumentStartsDuringRecovery", monitor.getHits());
      removeMonitor(monitor); observedPicker = null;
    }
  }

  private void verifyLibrary(JSONObject document) throws Exception {
    openDownloads();
    String row = savedFilename + "\n" + downloadUrl + "\n" + document.getLong("bytes") + " 字节";
    require(find(TARGET, row, false) != null, "COMPLETED_METADATA_MISMATCH", "Actual completed row filename/URL/bytes did not match the granted document");
    require(!emptyLibrary(), "COMPLETED_RECORD_MISSING", "No saved download row");
    result.put("completedMetadataMatched", true);
    step("actual-completed-metadata", new JSONObject().put("filename", savedFilename).put("url", downloadUrl).put("bytes", document.getLong("bytes")));
  }

  private JSONObject document(UriPermission permission) throws Exception {
    require(permission.isReadPermission(), "DOCUMENT_NOT_READABLE", "The real system grant is not readable");
    ContentResolver resolver = getTargetContext().getContentResolver();
    CancellationSignal signal = new CancellationSignal();
    ExecutorService worker = Executors.newSingleThreadExecutor();
    Future<JSONObject> work = worker.submit(() -> {
      // URI comes only from the platform's actual persisted permission list. No DocumentsProvider
      // URI synthesis, raw file path, shell content command or SharedPreferences lookup is used.
      Uri uri = permission.getUri(); String name; long reportedSize = -1;
      try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null, signal)) {
        require(cursor != null && cursor.moveToFirst(), "DOCUMENT_METADATA_UNAVAILABLE", "System provider did not return metadata");
        name = cursor.getString(0); if (!cursor.isNull(1)) reportedSize = cursor.getLong(1);
      }
      require(savedFilename.equals(name), "SAVED_FILENAME_MISMATCH", "Provider document name differs from the actual user-selected name");
      MessageDigest sha = MessageDigest.getInstance("SHA-256"); long bytes = 0;
      ParcelFileDescriptor fd = resolver.openFileDescriptor(uri, "r", signal);
      require(fd != null, "DOCUMENT_OPEN_FAILED", "System provider did not open its actual granted document");
      try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
        byte[] buffer = new byte[32768]; int count;
        while ((count = input.read(buffer)) != -1) {
          bytes += count; require(bytes <= 16 * 1024 * 1024, "SYNTHETIC_SIZE_LIMIT", "Document exceeds synthetic readback limit"); sha.update(buffer, 0, count);
        }
      }
      String hash = hex(sha.digest());
      require(expectedSHA.equals(hash), "SAVED_SHA_MISMATCH", "Actual granted document SHA256 differs from fixture bytes");
      require(expectedBytes < 0 || expectedBytes == bytes, "SAVED_BYTES_MISMATCH", "Actual document byte count differs from fixture");
      require(reportedSize < 0 || reportedSize == bytes, "PROVIDER_SIZE_MISMATCH", "Provider-reported size differs from actual bytes");
      return new JSONObject().put("filename", name).put("bytes", bytes).put("sha256", hash)
        .put("reportedSize", reportedSize).put("mime", resolver.getType(uri));
    });
    try { return work.get(Math.max(1, deadline - SystemClock.elapsedRealtime()), TimeUnit.MILLISECONDS); }
    catch (java.util.concurrent.ExecutionException error) {
      if (error.getCause() instanceof Exception) throw (Exception) error.getCause(); throw error;
    } catch (java.util.concurrent.TimeoutException error) {
      work.cancel(true); signal.cancel(); throw new Failure("INCOMPLETE", "DOCUMENT_READ_TIMEOUT", "Actual provider readback did not complete; no replacement operation issued");
    } finally { worker.shutdownNow(); }
  }

  private Map<String, UriPermission> grants() throws Exception {
    Map<String, UriPermission> result = new HashMap<>();
    for (UriPermission permission : getTargetContext().getContentResolver().getPersistedUriPermissions())
      result.put(hex(MessageDigest.getInstance("SHA-256").digest(permission.getUri().toString().getBytes(StandardCharsets.UTF_8))), permission);
    return result;
  }

  private void navigate(String url) throws Exception {
    waitForIdleSync(); awaitMainAddress();
    final boolean[] edited = {false};
    runOnMainSync(() -> {
      EditText editor = mainEditor();
      if (editor != null && mainActivity.hasWindowFocus()) { editor.setText(url); edited[0] = true; }
    });
    require(edited[0], "ADDRESS_SET_FAILED", "Focused real Main editor was not available");
    waitForIdleSync();
    await("actual Main input retained", () -> {
      final boolean[] same = {false};
      runOnMainSync(() -> { EditText editor = mainEditor(); same[0] = editor != null && url.contentEquals(editor.getText()); });
      return same[0];
    });
    final boolean[] clicked = {false};
    runOnMainSync(() -> {
      EditText editor = mainEditor();
      View go = mainView(mainActivity.getWindow().getDecorView(), "前往");
      Rect visible = new Rect();
      if (mainActivity.hasWindowFocus() && editor != null && url.contentEquals(editor.getText())
          && go != null && go.isEnabled() && go.isShown() && go.getGlobalVisibleRect(visible) && !visible.isEmpty()) clicked[0] = go.performClick();
    });
    require(clicked[0], "GO_ACTION_REFUSED", "Actual Main Go action was not performed; not retried");
    waitForIdleSync();
    step("actual-address-navigation", new JSONObject().put("url", url).put("method", "Activity-public-View"));
  }

  private void awaitMainAddress() throws Exception {
    await("focused real Main address editor", () -> {
      final boolean[] ready = {false};
      runOnMainSync(() -> { ready[0] = mainActivity != null && !mainActivity.isFinishing() && !mainActivity.isDestroyed()
        && mainActivity.hasWindowFocus() && mainEditor() != null; });
      return ready[0];
    });
  }

  // Called only on the app main thread. These are normal public native Views, not product fields.
  private EditText mainEditor() {
    if (mainActivity == null) return null;
    View editor = mainView(mainActivity.getWindow().getDecorView(), "地址或搜索查询");
    return editor instanceof EditText && editor.isShown() && editor.isEnabled() ? (EditText) editor : null;
  }
  private View mainView(View node, String label) {
    if (node == null) return null;
    if (label.contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription())
        || node instanceof TextView && label.contentEquals(((TextView) node).getText())) return node;
    if (node instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) node).getChildCount(); i++) {
      View found = mainView(((ViewGroup) node).getChildAt(i), label); if (found != null) return found;
    }
    return null;
  }

  /** Read only public state of the attached active QA WebView; never replaces product clients/listeners. */
  private JSONObject mainReadOnly() {
    JSONObject value = new JSONObject();
    runOnMainSync(() -> {
      if (mainActivity == null || mainActivity.isDestroyed()) { put(value, "available", false); return; }
      put(value, "available", true); put(value, "mainFocused", mainActivity.hasWindowFocus());
      try {
        EditText editor = mainEditor();
        put(value, "nativeAddress", editor == null ? "<not-visible>" : diagnosticUrl(editor.getText().toString()));
        WebView web = activeWebView(mainActivity.getWindow().getDecorView());
        put(value, "activeWebViewFound", web != null);
        if (web != null) {
          String url = web.getUrl();
          put(value, "webURL", diagnosticUrl(url)); put(value, "originalURL", diagnosticUrl(web.getOriginalUrl()));
          put(value, "progress", web.getProgress());
          put(value, "webEqualsDownload", downloadUrl != null && downloadUrl.equals(url));
          put(value, "webEqualsFixture", fixturePage != null && !fixturePage.isEmpty() && fixturePage.equals(url));
          android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
          if (provider != null) { put(value, "providerPackage", provider.packageName); put(value, "providerVersion", provider.versionName); }
        }
      } catch (RuntimeException error) { put(value, "publicReadError", error.getClass().getSimpleName()); }
    });
    if (observedPicker != null) put(value, "observedCreateDocumentStarts", observedPicker.getHits());
    String downloadState = "not-visible";
    if (ui != null) for (String line : summary(TARGET).split("\n")) {
      if (line.startsWith("下载 ·") || line.contains("网页已失效，未开始下载")) { downloadState = line; break; }
    }
    put(value, "productDownloadUIState", downloadState); // UI evidence only, not a claimed callback event.
    return value;
  }

  private WebView activeWebView(View node) {
    if (node instanceof WebView && node.isShown()) return (WebView) node;
    if (node instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) node).getChildCount(); i++) {
      WebView web = activeWebView(((ViewGroup) node).getChildAt(i)); if (web != null) return web;
    }
    return null;
  }

  private String diagnosticUrl(String url) {
    if (url == null) return "";
    if (url.equals(downloadUrl) || url.equals(fixturePage)) return url;
    try { URI value = new URI(url); return value.getScheme() != null && value.getHost() != null
      ? value.getScheme() + "://" + value.getHost() + "/<redacted-path-query>" : "<non-web-or-input>"; }
    catch (Exception error) { return "<non-web-or-input>"; }
  }

  private void openDownloads() throws Exception {
    click(TARGET, "更多", false); await("tools download item", () -> find(TARGET, "下载", false) != null);
    click(TARGET, "下载", false); await("actual download library", () -> find(TARGET, "下载记录 · 文件保留在所选位置", false) != null
      && (emptyLibrary() || find(TARGET, "android:id/select_dialog_listview", true) != null));
  }
  private void closeDownloads() throws Exception {
    click(TARGET, "关闭", false); waitForIdleSync(); awaitMainAddress();
    await("download dialog dismissed", () -> find(TARGET, "下载记录 · 文件保留在所选位置", false) == null);
  }
  private boolean emptyLibrary() { return find(TARGET, EMPTY, false) != null; }

  private void clickSave(String pkg) throws Exception {
    AccessibilityNodeInfo save = saveButton(pkg);
    require(save != null, "SYSTEM_SAVE_BUTTON_MISSING", summary(pkg));
    if (!save.isEnabled()) {
      // A real user must select a writable location when DocumentsUI opens on Recents.
      // Selecting its ordinary Downloads root does not create a grant or bypass permission UI.
      String roots = firstLabel(pkg, "Show roots", "显示根目录", "显示根文件夹", "打开导航抽屉");
      if (roots != null) {
        click(pkg, roots, false);
        await("system Downloads location", () -> firstLabel(pkg, "Downloads", "下载") != null);
        click(pkg, firstLabel(pkg, "Downloads", "下载"), false);
        await("system Save after location selection", () -> saveButton(pkg) != null);
        step("actual-system-downloads-location", new JSONObject().put("ui", summary(pkg)));
        save = saveButton(pkg);
      }
    }
    require(save != null, "SYSTEM_SAVE_BUTTON_MISSING", summary(pkg));
    if (!save.isVisibleToUser() && imeVisible()) {
      require(ui.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK), "IME_HIDE_FAILED", "System Back was refused");
      await("system filename keyboard dismissed", () -> !imeVisible());
      await("system Save visible", () -> saveButton(pkg) != null && saveButton(pkg).isVisibleToUser());
      save = saveButton(pkg);
    }
    require(save != null, "SYSTEM_SAVE_BUTTON_MISSING", summary(pkg));
    require(save.isEnabled(), "SYSTEM_SAVE_DISABLED", summary(pkg));
    require(!hasSystemOverwriteOrError(), "SYSTEM_SAVE_REFUSED", documentsSummary());
    performClick(save, "system Save", pkg, () -> saveButton(pkg));
  }

  private AccessibilityNodeInfo saveButton(String pkg) {
    AccessibilityNodeInfo value = find(pkg, "Save", false);
    if (value == null) value = find(pkg, "保存", false);
    if (value == null) value = find(pkg, "SAVE", false);
    // Do not press an arbitrary button1 such as an overwrite or permission confirmation.
    return value;
  }

  private void cancelPicker() throws Exception {
    for (int attempt = 0; attempt < 3 && documentsPackage() != null; attempt++) {
      if (phase.equals("cancel_existing_picker") && observedPicker != null && observedPicker.getHits() != 0)
        throw new Failure("INCOMPLETE", "NEW_PICKER_DURING_RECOVERY", "No action is sent to a newly opened picker");
      String pkg = documentsPackage();
      AccessibilityNodeInfo currentRoot = root(pkg);
      require(currentRoot != null, "CANCEL_WINDOW_GONE", "Picker already disappeared before action");
      activeOwner(currentRoot, pkg, Math.min(deadline, SystemClock.elapsedRealtime() + 5000), "system picker Cancel");
      String cancel = firstLabel(pkg, "Cancel", "取消", "CANCEL");
      if (cancel != null) click(pkg, cancel, false);
      else require(ui.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK), "CANCEL_ACTION_FAILED", "System Back was rejected");
      step("actual-system-cancel-action", new JSONObject().put("attempt", attempt + 1).put("imeVisible", imeVisible()));
      // A first Back may only hide the filename keyboard. Do not mistake that for cancellation.
      long until = Math.min(deadline, SystemClock.elapsedRealtime() + 700);
      while (SystemClock.elapsedRealtime() < until && documentsPackage() != null) SystemClock.sleep(100);
    }
  }

  private boolean imeVisible() {
    for (AccessibilityWindowInfo window : ui.getWindows())
      if (window.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD) return true;
    return false;
  }

  private String firstLabel(String pkg, String... values) {
    if (pkg == null) return null;
    for (String value : values) if (find(pkg, value, false) != null) return value;
    return null;
  }

  private boolean hasSystemOverwriteOrError() {
    String text = documentsSummary().toLowerCase(java.util.Locale.ROOT);
    return text.contains("replace") || text.contains("overwrite") || text.contains("替换") || text.contains("覆盖")
      || text.contains("couldn't save") || text.contains("无法保存");
  }

  private void click(String pkg, String label, boolean id) throws Exception {
    await("UI control " + label, () -> find(pkg, label, id) != null);
    AccessibilityNodeInfo node = find(pkg, label, id);
    if (node != null && !node.isVisibleToUser()) {
      node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId());
      SystemClock.sleep(120); node = find(pkg, label, id);
    }
    for (int attempt = 0; node != null && !node.isVisibleToUser() && attempt < 6; attempt++) {
      AccessibilityNodeInfo parent = node.getParent();
      while (parent != null && !"android.widget.HorizontalScrollView".contentEquals(parent.getClassName() == null ? "" : parent.getClassName())) parent = parent.getParent();
      if (parent == null || !parent.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) break;
      SystemClock.sleep(120); node = find(pkg, label, id);
    }
    require(node != null, "UI_CONTROL_GONE", label);
    performClick(node, label, pkg, () -> find(pkg, label, id));
  }

  private interface NodeLookup { AccessibilityNodeInfo get(); }

  private void performClick(AccessibilityNodeInfo node, String label, String pkg, NodeLookup lookup) throws Exception {
    require(allowedPackage(pkg), "UI_PACKAGE_REFUSED", label);
    // A newly rendered dialog can precede its entry in getWindows(). Before sending this new
    // action, re-resolve the same semantic control and wait read-only for exact window ownership.
    // One shared <=5s budget covers ALL ownership checks for this operation; no action is retried.
    long syncUntil = Math.min(deadline, SystemClock.elapsedRealtime() + 5000);
    node = synchronizedNode(pkg, label, lookup, syncUntil);
    AccessibilityNodeInfo clickable = node;
    for (int i = 0; i < 6 && clickable != null && !clickable.isClickable(); i++) clickable = clickable.getParent();
    if (clickable != null && advertisesClick(clickable)) {
      require(clickable.refresh() && clickable.isEnabled() && clickable.isVisibleToUser(), "UI_CLICK_TARGET_CHANGED", label);
      activeOwner(clickable, pkg, syncUntil, label);
      // Do not repeat an advertised action that returned UNKNOWN/false with another pointer tap.
      require(clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK), "UI_CLICK_REFUSED", label);
      return;
    }
    // AlertDialog ListView rows can be enabled/visible without exposing ACTION_CLICK. A real
    // touchscreen tap still invokes their normal OnItemClickListener. Resolve the exact live
    // source node again in the same currently active application window before deriving a point.
    Rect bounds = pointerBounds(node, pkg, syncUntil, label);
    float x = bounds.exactCenterX(), y = bounds.exactCenterY();
    step("actual-pointer-target", new JSONObject().put("package", pkg).put("windowID", node.getWindowId())
      .put("control", label).put("bounds", bounds.toShortString()).put("x", x).put("y", y));
    Rect rechecked = pointerBounds(node, pkg, syncUntil, label);
    require(rechecked.equals(bounds), "UI_POINTER_TARGET_MOVED", label);
    long downTime = SystemClock.uptimeMillis();
    MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
    MotionEvent up = null;
    boolean sentDown = false, sentUp = false;
    try {
      down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
      sentDown = ui.injectInputEvent(down, true);
      require(sentDown, "POINTER_DOWN_REFUSED", label);
      SystemClock.sleep(35);
      up = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y, 0);
      up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
      sentUp = ui.injectInputEvent(up, true);
      if (!sentUp) throw new Failure("INCOMPLETE", "POINTER_UP_REFUSED", "Owned pointer action has UNKNOWN outcome; not retried: " + label);
    } finally {
      if (sentDown && !sentUp) {
        // Cancel only our already-started gesture. This is cleanup, never another click/retry.
        MotionEvent cancel = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_CANCEL, x, y, 0);
        try { cancel.setSource(InputDevice.SOURCE_TOUCHSCREEN); ui.injectInputEvent(cancel, true); } finally { cancel.recycle(); }
      }
      down.recycle(); if (up != null) up.recycle();
    }
    step("actual-pointer-injected", new JSONObject().put("package", pkg).put("windowID", node.getWindowId()).put("control", label));
  }

  private boolean advertisesClick(AccessibilityNodeInfo node) {
    for (AccessibilityNodeInfo.AccessibilityAction action : node.getActionList())
      if (action.getId() == AccessibilityNodeInfo.ACTION_CLICK) return true;
    return false;
  }

  private boolean allowedPackage(String pkg) {
    return TARGET.equals(pkg) || "com.android.documentsui".equals(pkg) || "com.google.android.documentsui".equals(pkg);
  }

  private AccessibilityNodeInfo synchronizedNode(String pkg, String label, NodeLookup lookup, long until) throws Exception {
    String previous = "";
    do {
      if (!TARGET.equals(pkg)) require(!hasSystemOverwriteOrError(), "SYSTEM_SAVE_REFUSED", documentsSummary());
      AccessibilityNodeInfo current = lookup.get();
      List<AccessibilityWindowInfo> windows = ui.getWindows();
      AccessibilityWindowInfo owner = null;
      if (current != null && current.refresh()) {
        // A disabled/refused control is never converted into a delayed permission or click.
        require(current.isEnabled() && current.isVisibleToUser(), "UI_CONTROL_NOT_INTERACTABLE", label);
        owner = ownerIfReady(current, pkg, windows);
      }
      JSONObject snapshot = windowSnapshot(current, pkg, label, windows, owner != null);
      String state = snapshot.toString();
      if (!state.equals(previous)) { recordWindowSync(snapshot); previous = state; }
      if (owner != null && SystemClock.elapsedRealtime() <= until) return current;
      if (SystemClock.elapsedRealtime() >= until) break;
      SystemClock.sleep(Math.min(100, Math.max(1, until - SystemClock.elapsedRealtime())));
    } while (SystemClock.elapsedRealtime() <= until);
    throw new Failure("INCOMPLETE", "UI_WINDOW_SYNC_TIMEOUT", "No same-package active/focused application window registered for " + label + " within bounded read-only sync");
  }

  private AccessibilityWindowInfo activeOwner(AccessibilityNodeInfo node, String pkg, long until, String label) throws Exception {
    String previous = "";
    do {
      require(node.refresh() && node.isEnabled() && node.isVisibleToUser(), "UI_CLICK_TARGET_CHANGED", label);
      List<AccessibilityWindowInfo> windows = ui.getWindows();
      AccessibilityWindowInfo owner = ownerIfReady(node, pkg, windows);
      JSONObject snapshot = windowSnapshot(node, pkg, label, windows, owner != null);
      String state = snapshot.toString();
      if (!state.equals(previous)) { recordWindowSync(snapshot); previous = state; }
      if (owner != null && SystemClock.elapsedRealtime() <= until) return owner;
      if (SystemClock.elapsedRealtime() >= until) break;
      SystemClock.sleep(Math.min(100, Math.max(1, until - SystemClock.elapsedRealtime())));
    } while (SystemClock.elapsedRealtime() <= until);
    throw new Failure("INCOMPLETE", "UI_WINDOW_SYNC_TIMEOUT", "Exact source window lost before action: " + label);
  }

  private AccessibilityWindowInfo ownerIfReady(AccessibilityNodeInfo node, String pkg, List<AccessibilityWindowInfo> windows) throws Failure {
    require(pkg.contentEquals(node.getPackageName() == null ? "" : node.getPackageName()), "UI_NODE_PACKAGE_CHANGED", pkg);
    for (AccessibilityWindowInfo window : windows) {
      if (window.getId() != node.getWindowId()) continue;
      AccessibilityNodeInfo owner = window.getRoot();
      require(window.getType() == AccessibilityWindowInfo.TYPE_APPLICATION, "UI_WINDOW_NOT_APPLICATION", pkg);
      if (android.os.Build.VERSION.SDK_INT >= 30) require(window.getDisplayId() == 0, "NONDEFAULT_DISPLAY", pkg);
      if (window.isActive() && window.isFocused() && owner != null
          && pkg.contentEquals(owner.getPackageName() == null ? "" : owner.getPackageName())) return window;
    }
    return null;
  }

  private JSONObject windowSnapshot(AccessibilityNodeInfo node, String pkg, String label,
      List<AccessibilityWindowInfo> windows, boolean ready) throws Exception {
    JSONArray values = new JSONArray();
    for (AccessibilityWindowInfo window : windows) {
      if (values.length() >= 32) break;
      AccessibilityNodeInfo root = window.getRoot();
      String owner = root == null || root.getPackageName() == null ? "" : root.getPackageName().toString();
      values.put(new JSONObject().put("id", window.getId()).put("type", window.getType()).put("layer", window.getLayer())
        .put("active", window.isActive()).put("focused", window.isFocused())
        .put("package", allowedPackage(owner) ? owner : "<other-window>"));
    }
    return new JSONObject().put("control", label).put("package", pkg)
      .put("nodeWindowID", node == null ? -1 : node.getWindowId()).put("matched", ready).put("windows", values);
  }

  private void recordWindowSync(JSONObject snapshot) throws Exception {
    if (windowSync.length() < 64) windowSync.put(snapshot);
    step("read-only-window-sync", snapshot);
  }

  private Rect pointerBounds(AccessibilityNodeInfo original, String pkg, long until, String label) throws Exception {
    require(original.refresh(), "UI_NODE_GONE", pkg);
    AccessibilityWindowInfo owner = activeOwner(original, pkg, until, label);
    AccessibilityNodeInfo fresh = walk(owner.getRoot(), candidate -> candidate.equals(original));
    require(fresh != null && fresh.refresh() && fresh.isEnabled() && fresh.isVisibleToUser(), "UI_POINTER_NODE_CHANGED", pkg);
    activeOwner(fresh, pkg, until, label);
    if (!TARGET.equals(pkg)) require(!hasSystemOverwriteOrError(), "SYSTEM_SAVE_REFUSED", documentsSummary());
    Rect view = new Rect(), window = new Rect(); fresh.getBoundsInScreen(view); owner.getBoundsInScreen(window);
    require(!view.isEmpty() && view.intersect(window) && !view.isEmpty(), "UI_POINTER_BOUNDS_EMPTY", pkg);
    Point screen = new Point();
    WindowManager manager = getTargetContext().getSystemService(WindowManager.class);
    require(manager != null, "UI_DISPLAY_UNAVAILABLE", pkg);
    manager.getDefaultDisplay().getRealSize(screen);
    require(screen.x > 0 && screen.y > 0 && view.intersect(new Rect(0, 0, screen.x, screen.y)) && !view.isEmpty(),
      "UI_POINTER_OUTSIDE_SCREEN", pkg);
    int x = view.centerX(), y = view.centerY();
    // A keyboard, permission dialog or any other higher window must not receive our gesture.
    for (AccessibilityWindowInfo other : ui.getWindows()) {
      if (other.getId() == owner.getId() || other.getLayer() <= owner.getLayer()) continue;
      Rect obscuring = new Rect(); other.getBoundsInScreen(obscuring);
      require(!obscuring.contains(x, y), "UI_POINTER_OBSCURED", pkg);
    }
    return view;
  }

  private AccessibilityNodeInfo find(String pkg, String label, boolean id) {
    AccessibilityNodeInfo root = root(pkg); return walk(root, node -> id ? label.equals(node.getViewIdResourceName())
      : label.contentEquals(node.getText() == null ? "" : node.getText()) || label.contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription()));
  }
  private AccessibilityNodeInfo findClass(String pkg, String className) {
    return walk(root(pkg), node -> className.contentEquals(node.getClassName() == null ? "" : node.getClassName()));
  }
  private interface Match { boolean matches(AccessibilityNodeInfo node); }
  private AccessibilityNodeInfo walk(AccessibilityNodeInfo node, Match match) {
    if (node == null) return null;
    if (match.matches(node)) return node;
    for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo result = walk(node.getChild(i), match); if (result != null) return result; }
    return null;
  }
  private AccessibilityNodeInfo root(String pkg) {
    if (ui == null) return null;
    AccessibilityNodeInfo active = ui.getRootInActiveWindow();
    if (active != null && pkg.contentEquals(active.getPackageName() == null ? "" : active.getPackageName())) return active;
    for (AccessibilityWindowInfo window : ui.getWindows()) {
      AccessibilityNodeInfo value = window.getRoot();
      if (value != null && pkg.contentEquals(value.getPackageName() == null ? "" : value.getPackageName())) return value;
    }
    return null;
  }
  private String documentsPackage() {
    if (root("com.google.android.documentsui") != null) return "com.google.android.documentsui";
    if (root("com.android.documentsui") != null) return "com.android.documentsui";
    return null;
  }
  private String documentsSummary() { String pkg = documentsPackage(); return pkg == null ? "" : summary(pkg); }
  private String summary(String pkg) {
    StringBuilder value = new StringBuilder(); collect(root(pkg), value, new HashSet<>()); return safe(value.toString());
  }
  private void collect(AccessibilityNodeInfo node, StringBuilder output, Set<String> seen) {
    if (node == null || output.length() > 4096) return;
    if (node.isVisibleToUser()) {
      String text = node.getText() == null ? "" : node.getText().toString();
      if (!text.isEmpty() && seen.add(text)) output.append(text).append('\n');
      if (node.getViewIdResourceName() != null && node.getViewIdResourceName().endsWith("button1"))
        output.append("save-button-enabled=").append(node.isEnabled()).append('\n');
    }
    for (int i = 0; i < node.getChildCount(); i++) collect(node.getChild(i), output, seen);
  }

  private void await(String stage, Callable<Boolean> condition) throws Exception {
    while (SystemClock.elapsedRealtime() < deadline) {
      if (condition.call()) return;
      if (SystemClock.elapsedRealtime() - lastHeartbeat >= 2000) {
        lastHeartbeat = SystemClock.elapsedRealtime();
        JSONObject data = new JSONObject().put("for", stage);
        if ("system ACTION_CREATE_DOCUMENT".equals(stage)) data.put("mainReadOnly", mainReadOnly());
        step("waiting", data);
      }
      SystemClock.sleep(160);
    }
    throw new Failure("INCOMPLETE", "UI_TIMEOUT", "Timed out waiting for " + stage);
  }
  private void step(String stage, JSONObject data) throws Exception {
    JSONObject event = new JSONObject().put("stage", stage).put("elapsedRealtime", SystemClock.elapsedRealtime()).put("data", data);
    events.put(event); Bundle stream = new Bundle(); stream.putString("stream", "P05_SAF " + phase + " " + stage + "\n");
    stream.putString("safEvent", event.toString()); sendStatus(1, stream);
  }
  private static void require(boolean value, String code, String detail) throws Failure {
    if (!value) throw new Failure("FAIL", code, detail);
  }
  private static final class Failure extends Exception {
    final String status, code;
    Failure(String status, String code, String detail) { super(detail); this.status = status; this.code = code; }
  }
  private static void put(JSONObject value, String key, Object item) { try { value.put(key, item); } catch (Exception ignored) {} }
  private static String hex(byte[] data) { StringBuilder result = new StringBuilder(); for (byte b : data) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return result.toString(); }
  private static String extension(String name) { int dot = name.lastIndexOf('.'); return dot < 0 ? ".bin" : name.substring(dot); }
  private static String safe(String value) {
    if (value == null) return "";
    // Never output document URIs, filesystem paths, content bytes, credentials or preference data.
    String redacted = value.replaceAll("content://[^\\s]+", "<document-uri>")
      .replaceAll("https?://[^\\s]+", "<web-url>").replaceAll("/(?:storage|sdcard|data|mnt)/[^\\s]+", "<filesystem-path>");
    return redacted.substring(0, Math.min(redacted.length(), 4096));
  }
}

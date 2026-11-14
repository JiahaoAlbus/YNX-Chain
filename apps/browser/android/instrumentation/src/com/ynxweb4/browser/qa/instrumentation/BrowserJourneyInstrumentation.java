package com.ynxweb4.browser.qa.instrumentation;

import android.app.Activity;
import android.app.Instrumentation;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Only public view actions and read-only DOM inspection. No product-private calls/state writes. */
public final class BrowserJourneyInstrumentation extends Instrumentation {
    private static final String TARGET = "com.ynxweb4.browser.qa";
    private Activity activity;
    private Bundle arguments;
    private String phase, fixture, markerA, markerB, titleA, titleB;
    private long timeout;
    private final JSONArray steps = new JSONArray();
    private final JSONArray menuActions = new JSONArray();
    private final long began = SystemClock.elapsedRealtime();

    private interface MainCall<T> { T call() throws Exception; }
    private interface Work { JSONObject run() throws Exception; }
    private static final class JourneyFailure extends Exception {
        final String status;
        final JSONObject evidence;
        JourneyFailure(String status, String reason, JSONObject evidence) { super(reason); this.status = status; this.evidence = evidence; }
    }

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments); this.arguments = arguments == null ? new Bundle() : arguments; start();
    }
    @Override public void onStart() {
        String outcome = "FAIL", detail = "Driver did not finish";
        JSONObject result = new JSONObject();
        try {
            phase = arg("phase", "core"); timeout = Math.max(5000, Math.min(120000, Long.parseLong(arg("timeout_ms", "45000"))));
            fixture = arg("fixture_base", "");
            if (!fixture.isEmpty()) {
                URI uri = URI.create(fixture);
                if (!"http".equals(uri.getScheme()) || !"10.0.2.2".equals(uri.getHost()) || uri.getPort() < 1024 || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !(uri.getPath().isEmpty() || "/".equals(uri.getPath()))) throw new IllegalArgumentException("fixture_base must be the assigned http://10.0.2.2:PORT");
                while (fixture.endsWith("/")) fixture = fixture.substring(0, fixture.length() - 1);
            }
            markerA = arg("marker_a", "YNX_ANDROID_PAGE_A"); markerB = arg("marker_b", "YNX_ANDROID_PAGE_B");
            titleA = arg("title_a", "YNX Fixture A"); titleB = arg("title_b", "YNX Fixture B");
            if (!TARGET.equals(getTargetContext().getPackageName())) throw new IllegalArgumentException("QA target package only");
            if (!java.util.Arrays.asList("core", "https", "search", "search_bing", "restore_seed", "restore_verify", "restore_bookmark_verify", "menu_probe", "inspect_restored_dom").contains(phase)) throw new IllegalArgumentException("Unknown phase; SAF belongs to its independent runner");
            if (phase.equals("core") || phase.startsWith("restore_")) requireFixture();
            if (markerA.isEmpty() || markerB.isEmpty() || titleA.isEmpty() || titleB.isEmpty() || markerA.length() > 128 || markerB.length() > 128 || titleA.length() > 128 || titleB.length() > 128) throw new IllegalArgumentException("Bounded nonempty fixture labels required");
            Intent launch = new Intent(Intent.ACTION_MAIN).setComponent(new ComponentName(TARGET, "com.ynxweb4.browser.MainActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity = startActivitySync(launch); waitForIdleSync();
            if (activity == null || !TARGET.equals(activity.getPackageName()) || !"com.ynxweb4.browser.MainActivity".equals(activity.getClass().getName())) throw new IllegalStateException("Did not launch actual QA MainActivity");
            PackageInfo installed = getTargetContext().getPackageManager().getPackageInfo(TARGET, 0);
            result.put("targetPackage", TARGET).put("targetVersion", installed.versionName).put("targetVersionCode", installed.getLongVersionCode());
            step("actual_standard_activity", () -> {
                require(nativeText().contains("YNX Browser") && main(() -> address() != null), "Standard address UI missing");
                return new JSONObject().put("activity", activity.getClass().getName()).put("nativeText", nativeText());
            });
            switch (phase) {
                case "core": core(); break;
                case "https": https(); break;
                case "search": search(false); break;
                case "search_bing": search(true); break;
                case "restore_seed": seedRestore(); break;
                case "restore_verify": verifyRestore(); break;
                case "restore_bookmark_verify": verifyRestoredBookmark(); break;
                case "menu_probe": step("actual_tools_menu_hierarchy_only", () -> { clickNative("更多"); return menuHierarchy(); }); break;
                case "inspect_restored_dom": inspectRestoredDOM(); break;
            }
            outcome = "PASS"; detail = "All checks in this phase completed against actual UI/DOM";
        } catch (JourneyFailure failure) {
            outcome = failure.status; detail = failure.getMessage();
            try { result.put("failureEvidence", failure.evidence); } catch (Exception ignored) {}
        } catch (Throwable error) {
            detail = error.getClass().getName() + ": " + String.valueOf(error.getMessage());
        } finally {
            try {
                result.put("schema", "ynx-android-standard-ui-journey-v1").put("phase", phase == null ? "unknown" : phase)
                    .put("status", outcome).put("detail", detail).put("elapsedMs", SystemClock.elapsedRealtime() - began).put("steps", steps)
                    .put("nativeMenuActions", menuActions)
                    .put("driverActions", "public native views/accessibility clicks; actual WebView pointer event; read-only DOM")
                    .put("forbiddenActionsUsed", false).put("sourceCompilationIsRuntimeAcceptance", false)
                    .put("SAF", "NOT_RUN_IN_THIS_RUNNER").put("privacyRoutes", "NOT_ACTIVATED");
            } catch (Exception ignored) {}
            Bundle report = new Bundle(); report.putString("ynx_result", result.toString());
            report.putString("stream", "\nYNX_RESULT " + result + "\n"); finish(Activity.RESULT_OK, report);
        }
    }

    private void core() throws Exception {
        requireFixture();
        step("fixture_page_a", () -> { navigate(fixture + "/page-a"); return awaitDocument(markerA, false); });
        step("actual_dom_link_to_b", () -> { tapFixtureLink("to-b", fixture + "/page-b"); return awaitDocument(markerB, false); });
        step("native_back", () -> { clickNative("‹"); return awaitDocument(markerA, false); });
        step("native_forward", () -> { clickNative("›"); return awaitDocument(markerB, false); });
        final int initialCount = closeButtons().size();
        step("new_tab_and_input", () -> {
            clickNative("＋标签"); require(closeButtons().size() == initialCount + 1, "New tab count did not increase");
            navigate(fixture + "/page-a"); JSONObject doc = awaitDocument(markerA, false); return doc.put("tabCount", closeButtons().size());
        });
        step("switch_actual_tab", () -> { clickTabContaining(titleB, false); return awaitDocument(markerB, false); });
        step("close_only_new_tab", () -> {
            List<Button> close = closeButtons(); require(close.size() == initialCount + 1, "Concurrent tab change; refusing to close an unowned tab");
            click(close.get(initialCount)); require(closeButtons().size() == initialCount, "Close did not remove one tab");
            return awaitDocument(markerB, false).put("tabCount", closeButtons().size());
        });
        step("bookmark_via_real_dialog", () -> {
            clickNative("书签"); clickAccessible("收藏当前页", false);
            awaitNativeContains("已保存书签", 5000); return new JSONObject().put("nativeText", nativeText());
        });
        step("bookmark_reopen_actual_row", () -> {
            navigate(fixture + "/page-a"); awaitDocument(markerA, false); clickNative("书签");
            clickAccessible(fixture + "/page-b", true); return awaitDocument(markerB, false);
        });
        step("history_reopen_actual_row", () -> {
            navigate(fixture + "/page-a"); awaitDocument(markerA, false); clickNative("历史");
            clickAccessible(fixture + "/page-b", true); return awaitDocument(markerB, false);
        });
    }

    private void https() throws Exception {
        step("real_iana_https", () -> { navigate("https://www.iana.org/domains/reserved"); JSONObject doc = awaitDocument("IANA", true);
            require(doc.optString("url").startsWith("https://www.iana.org/"), "HTTPS target changed unexpectedly"); return doc; });
    }

    private void search(boolean bing) throws Exception {
        String query = arg("query", "YNX browser privacy");
        if (query.length() > 200 || query.trim().isEmpty()) throw new IllegalArgumentException("Bounded explicit search query required");
        String failureStatus = null, failureMessage = null; JSONObject failureEvidence = null;
        try {
            step(bing ? "explicit_bing_setting" : "explicit_default_ddg_setting", () -> { chooseProvider(bing); return new JSONObject().put("provider", bing ? "Bing (explicit UI choice)" : "DuckDuckGo"); });
            try {
                step(bing ? "bing_query_actual_results" : "ddg_query_actual_results", () -> {
                    navigate(query); return awaitSearchResults(bing, query);
                });
            } catch (JourneyFailure failure) { failureStatus = failure.status; failureMessage = failure.getMessage(); failureEvidence = failure.evidence; }
        } finally {
            // A real menu action, even after a network/challenge outcome. Never write preferences.
            if (bing) step("restore_default_ddg_via_menu", () -> { chooseProvider(false); return new JSONObject().put("provider", "DuckDuckGo").put("searchResubmitted", false); });
        }
        if (failureStatus != null) throw new JourneyFailure(failureStatus, failureMessage, failureEvidence);
    }
    private void chooseProvider(boolean bing) throws Exception {
        clickNative("更多"); clickAccessible("搜索服务", false);
        awaitDialogText("当前搜索模板\n", true);
        clickAccessible(bing ? "Bing（仅明确选择）" : "DuckDuckGo（默认）", false);
        awaitNativeContains("搜索服务已按选择保存", 5000);
        // Read the persisted choice through the real public settings UI, not its private store.
        clickNative("更多"); clickAccessible("搜索服务", false);
        String template = bing ? "https://www.bing.com/search?q={query}" : "https://duckduckgo.com/?q={query}";
        awaitDialogText("当前搜索模板\n" + template, false);
        menuActions.put(new JSONObject().put("selectionVerifiedInActualDialog", template));
        sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK); waitForIdleSync();
    }

    private void seedRestore() throws Exception {
        requireFixture();
        step("restore_seed_a", () -> { navigate(fixture + "/page-a"); return awaitDocument(markerA, false); });
        step("restore_seed_new_b", () -> { clickNative("＋标签"); navigate(fixture + "/page-b"); return awaitDocument(markerB, false); });
        step("restore_seed_bookmark", () -> { clickNative("书签"); clickAccessible("收藏当前页", false); awaitNativeContains("已保存书签", 5000); return new JSONObject().put("nativeText", nativeText()); });
        step("leave_to_home_persists_normal_state", () -> {
            sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_HOME); waitForIdleSync();
            return new JSONObject().put("nextRequiredExternalAction", "parent force-stop only this QA package, then run restore_verify; do not clear data");
        });
    }
    private void verifyRestore() throws Exception {
        requireFixture();
        step("cold_restored_selected_b_dom", () -> {
            // No navigation/input before this check; it must come from the app's normal restore.
            JSONObject doc = awaitDocument(markerB, false); String shown = main(() -> address().getText().toString());
            require(shown.equals(fixture + "/page-b"), "Cold restored selected address mismatch");
            return doc.put("address", shown).put("tabLabels", tabLabels());
        });
        step("cold_restored_a_tab_switch", () -> { clickTabContaining(titleA, true); return awaitDocument(markerA, false); });
        step("cold_bookmark_actual_row", () -> { clickNative("书签"); clickAccessible(fixture + "/page-b", true); return awaitDocument(markerB, false); });
    }
    private void verifyRestoredBookmark() throws Exception {
        requireFixture();
        // Resume only the failed bookmark tail of restore_verify. No seed, tab creation,
        // address input, or preference writes can create the required existing row.
        step("cold_existing_bookmark_actual_row", () -> {
            clickNative("书签"); clickAccessible(fixture + "/page-b", true);
            JSONObject doc = awaitDocument(markerB, false);
            require((fixture + "/page-b").equals(doc.optString("url")), "Restored bookmark loaded an unexpected URL");
            return doc.put("newBookmarkCreated", false).put("seedRepeated", false).put("combineWithEarlierColdRestoreReceipt", true);
        });
    }
    private void inspectRestoredDOM() throws Exception {
        step("read_only_actual_restored_dom", () -> {
            // No input, loadUrl, DOM activation, menu/provider change, or tab switch.
            // Normal MainActivity cold restoration owns any initial page load.
            long end = SystemClock.elapsedRealtime() + timeout; JSONObject latest = new JSONObject();
            while (SystemClock.elapsedRealtime() < end) {
                WebView web = visibleWeb(); String text = nativeText();
                if (web != null) {
                    latest = document(web);
                    if (latest.optBoolean("challenge")) throw new JourneyFailure("CAPTCHA", "Restored document has visible challenge; no action taken", summarize(latest));
                    if ("complete".equals(latest.optString("readyState")) && !text.contains("正在载入")) {
                        String script = "JSON.stringify(Array.prototype.slice.call(document.querySelectorAll('a[href]'),0,30).map(function(a){var h=a.closest('h1,h2,h3')||a.querySelector('h1,h2,h3'),r=a.closest('li,article,[role=\"listitem\"],[class*=\"algo\"],[class*=\"result\"]'),p=a.parentElement,anc=[];for(var n=p,i=0;n&&i<3;n=n.parentElement,i++)anc.push({tag:n.tagName,classes:String(n.className||'').slice(0,200),id:n.id||''});return {href:a.href,rawHref:a.getAttribute('href'),text:(a.innerText||a.textContent||'').trim().slice(0,250),classes:String(a.className||'').slice(0,200),parentTag:p?p.tagName:'',parentClasses:p?String(p.className||'').slice(0,200):'',heading:h?{tag:h.tagName,text:(h.innerText||h.textContent||'').trim().slice(0,200)}:null,closestResult:r?{tag:r.tagName,classes:String(r.className||'').slice(0,200),id:r.id||''}:null,ancestors:anc};}))";
                        Object decoded = new JSONTokener(javascript(web, script)).nextValue();
                        require(decoded instanceof String, "Read-only restored anchor probe returned no JSON");
                        JSONArray anchors = new JSONArray((String) decoded);
                        return summarize(latest).put("nativeAddress", main(() -> address().getText().toString())).put("anchors", anchors).put("anchorLimit", 30).put("nativeText", text)
                            .put("scope", "READ_ONLY_RESTORED_DOM_DIAGNOSTIC").put("searchAccepted", false).put("querySubmittedByProbe", false).put("providerChanged", false).put("tabSwitched", false);
                    }
                } else if (nativeFailure(text)) throw new JourneyFailure("UNREACHABLE", "Normal restored page displayed an actual navigation/network/TLS failure; probe made no request", new JSONObject().put("nativeText", text));
                SystemClock.sleep(250);
            }
            throw new JourneyFailure("UNREACHABLE", "No complete restored document within bounded read-only observation", summarize(latest).put("nativeText", nativeText()));
        });
    }

    private JSONObject awaitSearchResults(boolean bing, String query) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeout; JSONObject latest = new JSONObject();
        while (SystemClock.elapsedRealtime() < end) {
            String text = nativeText(); WebView web = visibleWeb();
            if (web == null) {
                if (nativeFailure(text)) throw new JourneyFailure("UNREACHABLE", "Main displayed actual navigation/network/TLS failure", new JSONObject().put("nativeText", text).put("address", main(() -> address().getText().toString())));
            } else {
                latest = document(web); String url = latest.optString("url"); URI actual;
                try { actual = URI.create(url); } catch (RuntimeException error) { actual = URI.create("about:blank"); }
                String host = actual.getHost() == null ? "" : actual.getHost().toLowerCase(Locale.ROOT);
                boolean own = bing ? (host.equals("bing.com") || host.endsWith(".bing.com")) : (host.equals("duckduckgo.com") || host.endsWith(".duckduckgo.com"));
                if (latest.optBoolean("challenge")) throw new JourneyFailure("CAPTCHA", "Actual provider challenge observed; stopped without solving or retrying", summarize(latest));
                if (!url.isEmpty() && !"about:blank".equals(url) && !own) throw new JourneyFailure("FAIL", "Search navigated outside explicitly selected provider", summarize(latest));
                if (latest.optBoolean("refusal")) throw new JourneyFailure("UNREACHABLE", "Actual provider error/refusal page; no search result acceptance", summarize(latest));
                int count = latest.optInt(bing ? "bingResultCount" : "ddgResultCount");
                if (own && query.equals(android.net.Uri.parse(url).getQueryParameter("q")) && "complete".equals(latest.optString("readyState")) && count > 0) {
                    return summarize(latest).put("actualResultLinkCount", count).put("provider", bing ? "Bing explicit" : "DuckDuckGo").put("nativeText", text);
                }
            }
            SystemClock.sleep(300);
        }
        throw new JourneyFailure("UNREACHABLE", "No actual result anchors within bounded wait; no alternative submission", summarize(latest).put("nativeText", nativeText()));
    }
    private JSONObject awaitDocument(String marker, boolean external) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeout; JSONObject latest = new JSONObject();
        while (SystemClock.elapsedRealtime() < end) {
            WebView web = visibleWeb(); String text = nativeText();
            if (web != null) {
                latest = document(web);
                if (latest.optBoolean("challenge")) throw new JourneyFailure("CAPTCHA", "Actual page challenge; no interaction", summarize(latest));
                if ("complete".equals(latest.optString("readyState")) && latest.optString("body").contains(marker) && !text.contains("正在载入")) return summarize(latest).put("marker", marker).put("nativeText", text);
            } else if (nativeFailure(text)) throw new JourneyFailure(external ? "UNREACHABLE" : "FAIL", "Actual Main frame error rather than expected page", new JSONObject().put("nativeText", text));
            SystemClock.sleep(250);
        }
        throw new JourneyFailure(external ? "UNREACHABLE" : "FAIL", "Expected actual document marker not observed", summarize(latest).put("expectedMarker", marker).put("nativeText", nativeText()));
    }

    private JSONObject document(WebView web) throws Exception {
        String script = "JSON.stringify((function(){var b=(document.body&&document.body.innerText||'').slice(0,30000),h=location.href,c=document.querySelector('.anomaly-modal,#captcha,.g-recaptcha,[id*=\"captcha\"]');return {url:h,title:document.title,body:b,readyState:document.readyState,ddgResultCount:document.querySelectorAll('a.result__a,a[data-testid=\"result-title-a\"]').length,bingResultCount:document.querySelectorAll('li.b_algo h2 a[href]').length,challenge:!!(c&&c.getClientRects().length)||/verify you are human|unfortunately, bots use duckduckgo|select all squares|请完成验证|验证码/i.test(b),refusal:h.indexOf('/static-pages/home-error/')>=0||document.documentElement.getAttribute('data-errorpage')==='true'||b.indexOf('We have detected that you have connected over Tor')>=0||b.indexOf('Unexpected error. Please try again')>=0};})())";
        String raw = javascript(web, script); Object decoded = new JSONTokener(raw).nextValue();
        return decoded instanceof String ? new JSONObject((String) decoded) : new JSONObject();
    }
    private String javascript(WebView web, String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>(); CountDownLatch done = new CountDownLatch(1);
        runOnMainSync(() -> web.evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        if (!done.await(5, TimeUnit.SECONDS)) throw new JourneyFailure("FAIL", "Actual WebView DOM callback timed out", new JSONObject());
        return value.get() == null ? "null" : value.get();
    }
    private JSONObject summarize(JSONObject doc) throws Exception {
        String body = doc.optString("body");
        return new JSONObject().put("url", doc.optString("url")).put("title", doc.optString("title")).put("readyState", doc.optString("readyState"))
            .put("bodyCharacters", body.length()).put("bodySHA256", sha(body)).put("bodyExcerpt", body.substring(0, Math.min(body.length(), 1000)))
            .put("ddgResultCount", doc.optInt("ddgResultCount")).put("bingResultCount", doc.optInt("bingResultCount"))
            .put("challenge", doc.optBoolean("challenge")).put("refusal", doc.optBoolean("refusal"));
    }

    private void tapFixtureLink(String id, String expectedUrl) throws Exception {
        WebView web = visibleWeb(); require(web != null, "No actual WebView for link touch");
        String script = "JSON.stringify((function(){var e=document.getElementById(" + JSONObject.quote(id) + ");if(!e)return null;var r=e.getBoundingClientRect();return {href:e.href,x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight};})())";
        Object decoded = new JSONTokener(javascript(web, script)).nextValue();
        require(decoded instanceof String, "Fixture link geometry missing"); JSONObject geometry = new JSONObject((String) decoded);
        require(expectedUrl.equals(geometry.optString("href")), "Refusing touch of unreviewed fixture link");
        require(geometry.optDouble("x") > 0 && geometry.optDouble("y") > 0 && geometry.optDouble("x") < geometry.optDouble("viewportWidth") && geometry.optDouble("y") < geometry.optDouble("viewportHeight"), "Fixture link is outside actual viewport");
        float[] point = main(() -> { int[] location = new int[2]; web.getLocationOnScreen(location); float scale = (float) (web.getWidth() / geometry.getDouble("viewportWidth")); return new float[]{location[0] + (float) geometry.getDouble("x") * scale, location[1] + (float) geometry.getDouble("y") * scale}; });
        long downAt = SystemClock.uptimeMillis(); MotionEvent down = MotionEvent.obtain(downAt, downAt, MotionEvent.ACTION_DOWN, point[0], point[1], 0);
        MotionEvent up = MotionEvent.obtain(downAt, downAt + 80, MotionEvent.ACTION_UP, point[0], point[1], 0); down.setSource(InputDevice.SOURCE_TOUCHSCREEN); up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try { sendPointerSync(down); sendPointerSync(up); } finally { down.recycle(); up.recycle(); }
        waitForIdleSync();
    }
    private void navigate(String input) throws Exception {
        main(() -> { EditText address = address(); require(address != null, "Address field missing"); address.requestFocus(); address.setText(input); return null; });
        clickNative("前往"); waitForIdleSync();
    }
    private void clickNative(String label) throws Exception {
        Button button = main(() -> { for (View item : flatten(activity.getWindow().getDecorView())) if (item instanceof Button && label.contentEquals(((Button) item).getText()) && item.isShown()) return (Button) item; return null; });
        require(button != null, "Actual native button missing: " + label); click(button);
    }
    private void click(View view) throws Exception {
        main(() -> { require(view.isShown() && view.isEnabled(), "View unavailable for real action"); view.requestRectangleOnScreen(new Rect(0, 0, view.getWidth(), view.getHeight()), true); return null; });
        waitForIdleSync(); main(() -> { require(view.performClick(), "Actual View.performClick refused"); return null; }); waitForIdleSync();
    }
    private void clickAccessible(String label, boolean contains) throws Exception {
        long end = SystemClock.elapsedRealtime() + 5000;
        while (SystemClock.elapsedRealtime() < end) {
            AccessibilityNodeInfo root = interactiveQARoot();
            AccessibilityNodeInfo match = findAccessible(root, label, contains);
            if (match != null) {
                require(match.isEnabled(), "Actual named dialog row is disabled; refusing action");
                if (!match.refresh()) { SystemClock.sleep(100); continue; }
                if (clickAccessibilityTarget(match, 0)) { menuActions.put(new JSONObject().put("label", label).put("action", "actual Accessibility ACTION_CLICK")); waitForIdleSync(); return; }
                // The observed platform AlertDialog TextView rows are enabled but expose no
                // ACTION_CLICK. Touch only that freshly found, named, QA-owned list item.
                if (isDialogListItem(match) && match.isVisibleToUser() && match.isEnabled()) {
                    AccessibilityNodeInfo currentRoot = interactiveQARoot();
                    AccessibilityNodeInfo current = findAccessible(currentRoot, label, contains);
                    if (current == null || current.getWindowId() != match.getWindowId() || !isDialogListItem(current) || !current.isEnabled() || !current.isVisibleToUser()) throw new JourneyFailure("FAIL", "QA dialog changed before reviewed row touch", new JSONObject().put("label", label));
                    Rect row = new Rect(), window = new Rect(); current.getBoundsInScreen(row); currentRoot.getBoundsInScreen(window);
                    int x = row.centerX(), y = row.centerY();
                    require(!row.isEmpty() && window.contains(x, y) && x > 0 && y > 0 && x < getTargetContext().getResources().getDisplayMetrics().widthPixels && y < getTargetContext().getResources().getDisplayMetrics().heightPixels, "Named dialog row has no valid on-screen touch point");
                    menuActions.put(new JSONObject().put("label", label).put("action", "actual pointer at live named QA AlertDialog list row").put("bounds", row.toShortString()).put("windowId", current.getWindowId()));
                    tapScreen(x, y); return;
                }
            }
            SystemClock.sleep(100);
        }
        throw new JourneyFailure("FAIL", "Actual dialog/menu row not clickable: " + label, new JSONObject().put("nativeText", nativeText()).put("menuHierarchy", menuHierarchy()));
    }
    private void enableInteractiveWindows() {
        AccessibilityServiceInfo info = getUiAutomation().getServiceInfo();
        int required = AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        if (info != null && (info.flags & required) != required) { info.flags |= required; getUiAutomation().setServiceInfo(info); }
    }
    private AccessibilityNodeInfo interactiveQARoot() {
        enableInteractiveWindows();
        for (AccessibilityWindowInfo window : getUiAutomation().getWindows()) {
            if (window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION || !window.isActive() || !window.isFocused()) continue;
            AccessibilityNodeInfo root = window.getRoot();
            if (root != null && root.getPackageName() != null && TARGET.contentEquals(root.getPackageName())) return root;
        }
        return null;
    }
    private boolean clickAccessibilityTarget(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 3 || !node.isEnabled() || !node.isVisibleToUser() || node.getPackageName() == null || !TARGET.contentEquals(node.getPackageName())) return false;
        for (AccessibilityNodeInfo.AccessibilityAction action : node.getActionList()) if (action.getId() == AccessibilityNodeInfo.ACTION_CLICK && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
        for (int i = 0; i < node.getChildCount(); i++) if (clickAccessibilityTarget(node.getChild(i), depth + 1)) return true;
        if (depth == 0) {
            AccessibilityNodeInfo parent = node.getParent();
            for (int i = 0; parent != null && i < 3; i++, parent = parent.getParent()) {
                if (parent.getWindowId() != node.getWindowId() || parent.getPackageName() == null || !TARGET.contentEquals(parent.getPackageName()) || !parent.isEnabled() || !parent.isVisibleToUser()) break;
                for (AccessibilityNodeInfo.AccessibilityAction action : parent.getActionList()) if (action.getId() == AccessibilityNodeInfo.ACTION_CLICK && parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            }
        }
        return false;
    }
    private boolean isDialogListItem(AccessibilityNodeInfo node) {
        if (node == null || !"android:id/text1".equals(node.getViewIdResourceName()) || !"android.widget.TextView".contentEquals(node.getClassName())) return false;
        AccessibilityNodeInfo parent = node.getParent();
        return parent != null && parent.getWindowId() == node.getWindowId() && "android:id/select_dialog_listview".equals(parent.getViewIdResourceName()) && "android.widget.ListView".contentEquals(parent.getClassName()) && parent.isVisibleToUser() && parent.isEnabled();
    }
    private void tapScreen(float x, float y) {
        long at = SystemClock.uptimeMillis(); MotionEvent down = MotionEvent.obtain(at, at, MotionEvent.ACTION_DOWN, x, y, 0), up = MotionEvent.obtain(at, at + 80, MotionEvent.ACTION_UP, x, y, 0);
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN); up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try { sendPointerSync(down); sendPointerSync(up); } finally { down.recycle(); up.recycle(); }
        waitForIdleSync();
    }
    private void awaitDialogText(String label, boolean contains) throws Exception {
        long end = SystemClock.elapsedRealtime() + 5000;
        while (SystemClock.elapsedRealtime() < end) { AccessibilityNodeInfo found = findAccessible(interactiveQARoot(), label, contains); if (found != null && found.isEnabled()) return; SystemClock.sleep(100); }
        throw new JourneyFailure("FAIL", "Expected actual QA dialog state not observed: " + label, menuHierarchy());
    }
    private JSONObject menuHierarchy() throws Exception {
        JSONObject evidence = new JSONObject().put("activeRootBeforeWindowFlag", nodeHierarchy(getUiAutomation().getRootInActiveWindow()));
        AccessibilityServiceInfo info = getUiAutomation().getServiceInfo();
        if (info != null) { info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS; getUiAutomation().setServiceInfo(info); }
        SystemClock.sleep(250);
        JSONArray windows = new JSONArray();
        for (AccessibilityWindowInfo window : getUiAutomation().getWindows()) {
            AccessibilityNodeInfo root = window.getRoot();
            if (root == null || root.getPackageName() == null || !TARGET.contentEquals(root.getPackageName())) continue;
            windows.put(new JSONObject().put("id", window.getId()).put("type", window.getType()).put("layer", window.getLayer()).put("active", window.isActive()).put("focused", window.isFocused()).put("nodes", nodeHierarchy(root)));
            if (windows.length() >= 6) break;
        }
        return evidence.put("qaWindowsAfterWindowFlag", windows).put("activeRootAfterWindowFlag", nodeHierarchy(getUiAutomation().getRootInActiveWindow())).put("nativeText", nativeText()).put("selectionMade", false).put("searchSubmitted", false);
    }
    private JSONArray nodeHierarchy(AccessibilityNodeInfo root) throws Exception {
        JSONArray nodes = new JSONArray(); appendNodeHierarchy(root, "0", 0, nodes); return nodes;
    }
    private void appendNodeHierarchy(AccessibilityNodeInfo node, String path, int depth, JSONArray nodes) throws Exception {
        if (node == null || depth > 12 || nodes.length() >= 120) return;
        if (node.getPackageName() == null || !TARGET.contentEquals(node.getPackageName())) return;
        Rect bounds = new Rect(); node.getBoundsInScreen(bounds); JSONArray actions = new JSONArray();
        for (AccessibilityNodeInfo.AccessibilityAction action : node.getActionList()) actions.put(action.getId());
        nodes.put(new JSONObject().put("path", path).put("package", bounded(node.getPackageName())).put("class", bounded(node.getClassName())).put("text", bounded(node.getText())).put("description", bounded(node.getContentDescription())).put("viewId", node.getViewIdResourceName()).put("clickable", node.isClickable()).put("enabled", node.isEnabled()).put("visible", node.isVisibleToUser()).put("bounds", bounds.toShortString()).put("actions", actions).put("windowId", node.getWindowId()));
        for (int i = 0; i < node.getChildCount() && nodes.length() < 120; i++) appendNodeHierarchy(node.getChild(i), path + "." + i, depth + 1, nodes);
    }
    private static String bounded(CharSequence value) { String text = value == null ? "" : value.toString(); return text.substring(0, Math.min(text.length(), 200)); }
    private AccessibilityNodeInfo findAccessible(AccessibilityNodeInfo node, String label, boolean contains) {
        if (node == null) return null;
        String text = node.getText() == null ? "" : node.getText().toString();
        if (node.isVisibleToUser() && (contains ? text.contains(label) : text.equals(label))) return node;
        for (int i = 0; i < node.getChildCount(); i++) { AccessibilityNodeInfo found = findAccessible(node.getChild(i), label, contains); if (found != null) return found; }
        return null;
    }
    private void clickTabContaining(String title, boolean allowActive) throws Exception {
        Button selected = main(() -> { for (View item : flatten(activity.getWindow().getDecorView())) if (item instanceof Button) {
            String text = ((Button) item).getText().toString(); if (text.contains(title) && (allowActive || !text.startsWith("● ")) && item.isShown()) return (Button) item;
        } return null; });
        require(selected != null, "Expected restored/other tab missing: " + title); click(selected);
    }
    private List<Button> closeButtons() throws Exception {
        return main(() -> { List<Button> result = new ArrayList<>(); for (View item : flatten(activity.getWindow().getDecorView())) if (item instanceof Button && "×".contentEquals(((Button) item).getText()) && item.isShown()) result.add((Button) item); return result; });
    }
    private JSONArray tabLabels() throws Exception {
        return main(() -> { JSONArray labels = new JSONArray(); for (View item : flatten(activity.getWindow().getDecorView())) if (item instanceof Button) {
            CharSequence description = item.getContentDescription(); if (description != null && description.toString().startsWith("关闭标签 ")) labels.put(description.toString());
        } return labels; });
    }
    private EditText address() {
        for (View item : flatten(activity.getWindow().getDecorView())) if (item instanceof EditText && item.getContentDescription() != null && "地址或搜索查询".contentEquals(item.getContentDescription())) return (EditText) item;
        return null;
    }
    private WebView visibleWeb() throws Exception {
        return main(() -> { for (View item : flatten(activity.getWindow().getDecorView())) if (item instanceof WebView && item.isShown()) return (WebView) item; return null; });
    }
    private String nativeText() throws Exception {
        return main(() -> { StringBuilder result = new StringBuilder(); for (View item : flatten(activity.getWindow().getDecorView())) if (item instanceof TextView && !(item instanceof EditText) && item.isShown()) result.append(((TextView) item).getText()).append('\n'); return result.substring(0, Math.min(result.length(), 12000)); });
    }
    private static List<View> flatten(View root) { List<View> result = new ArrayList<>(); result.add(root); if (root instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) root).getChildCount(); i++) result.addAll(flatten(((ViewGroup) root).getChildAt(i))); return result; }
    private void awaitNativeContains(String marker, long milliseconds) throws Exception {
        long end = SystemClock.elapsedRealtime() + milliseconds;
        while (SystemClock.elapsedRealtime() < end) { if (nativeText().contains(marker)) return; SystemClock.sleep(100); }
        throw new JourneyFailure("FAIL", "Native completion status missing: " + marker, new JSONObject().put("nativeText", nativeText()));
    }
    private static boolean nativeFailure(String text) { return text.contains("载入失败") || text.contains("TLS 证书校验失败") || text.contains("网页未能载入") || text.contains("网站返回 HTTP"); }
    private <T> T main(MainCall<T> call) throws Exception {
        AtomicReference<T> result = new AtomicReference<>(); AtomicReference<Exception> failure = new AtomicReference<>();
        runOnMainSync(() -> { try { result.set(call.call()); } catch (Exception error) { failure.set(error); } });
        if (failure.get() != null) throw failure.get(); return result.get();
    }
    private void step(String name, Work work) throws Exception {
        long start = SystemClock.elapsedRealtime(); JSONObject record = new JSONObject().put("name", name);
        try { record.put("evidence", work.run()).put("status", "PASS"); }
        catch (JourneyFailure failure) { record.put("status", failure.status).put("detail", failure.getMessage()).put("evidence", failure.evidence); throw failure; }
        catch (Exception error) { record.put("status", "FAIL").put("detail", error.getClass().getName() + ": " + error.getMessage()); throw error; }
        finally { record.put("elapsedMs", SystemClock.elapsedRealtime() - start); steps.put(record); Bundle event = new Bundle(); event.putString("ynx_step", record.toString()); sendStatus(0, event); }
    }
    private void requireFixture() { if (fixture.isEmpty()) throw new IllegalArgumentException("This phase requires assigned fixture_base"); }
    private void require(boolean value, String reason) throws JourneyFailure { if (!value) throw new JourneyFailure("FAIL", reason, new JSONObject()); }
    private String arg(String key, String fallback) { String value = arguments.getString(key); return value == null ? fallback : value; }
    private static String sha(String text) throws Exception { byte[] bytes = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)); StringBuilder out = new StringBuilder(); for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02x", value & 255)); return out.toString(); }
}

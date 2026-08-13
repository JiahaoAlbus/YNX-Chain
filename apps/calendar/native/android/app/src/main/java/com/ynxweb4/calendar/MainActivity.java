package com.ynxweb4.calendar;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.os.LocaleListCompat;

import com.google.android.material.card.MaterialCardView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.InputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.interfaces.ECPublicKey;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends AppCompatActivity {
  private static final String CLIENT = "ynx-calendar-v1";
  private static final String BUNDLE = "com.ynxweb4.calendar";
  private static final String CALLBACK = "ynxcalendar://wallet-auth/callback";
  private static final int BLUE = Color.rgb(0, 47, 167);
  private static final int BLUE_DARK = Color.rgb(0, 35, 117);
  private static final int INK = Color.rgb(16, 24, 40);
  private static final int MUTED = Color.rgb(102, 112, 133);
  private static final int LINE = Color.rgb(226, 229, 238);
  private static final int WASH = Color.rgb(247, 248, 252);
  private static final int SOFT_BLUE = Color.rgb(237, 241, 255);
  private static final String[] LOCALES = {"system", "en", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"};

  private SharedPreferences preferences;
  private LinearLayout agenda;
  private TextView connectionLabel;
  private TextView dateRange;
  private LinearLayout weekStrip;
  private String activeView = "Week";
  private LocalDate focusDate = LocalDate.now();
  private ConnectivityManager.NetworkCallback networkCallback;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    preferences = getSharedPreferences("ynx_calendar", MODE_PRIVATE);
    applyLocale();
    render();
    registerNetworkStatus();
    callback(getIntent());
  }

  @Override protected void onDestroy() {
    if (networkCallback != null) {
      try { ((ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE)).unregisterNetworkCallback(networkCallback); }
      catch (RuntimeException ignored) { }
    }
    super.onDestroy();
  }

  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    callback(intent);
  }

  private void render() {
    getWindow().setStatusBarColor(WASH);
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    LinearLayout page = column();
    page.setBackgroundColor(WASH);
    setContentView(page);
    page.addView(topBar());

    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    LinearLayout content = column();
    content.setPadding(dp(18), dp(18), dp(18), dp(30));
    content.addView(hero());
    content.addView(viewToolbar(), matchWrap(0, 12, 0, 12));
    content.addView(calendarWorkspace());
    content.addView(assistantCard(), matchWrap(0, 16, 0, 0));
    scroll.addView(content);
    page.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
  }

  private View topBar() {
    LinearLayout bar = row();
    bar.setGravity(Gravity.CENTER_VERTICAL);
    bar.setPadding(dp(18), dp(10), dp(12), dp(10));
    bar.setBackgroundColor(Color.WHITE);

    ImageView logo = new ImageView(this);
    logo.setAdjustViewBounds(true);
    logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
    logo.setContentDescription("YNX");
    try (InputStream source = getAssets().open("ynx-logo.png")) {
      logo.setImageDrawable(android.graphics.drawable.Drawable.createFromStream(source, "YNX logo"));
    } catch (Exception ignored) { logo.setImageResource(com.ynxweb4.calendar.R.drawable.ic_calendar); }
    bar.addView(logo, new LinearLayout.LayoutParams(dp(72), dp(38)));

    TextView product = text("Calendar", 18, true, INK);
    product.setPadding(dp(8), 0, 0, 0);
    bar.addView(product, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

    Spinner locale = new Spinner(this);
    locale.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, LOCALES));
    locale.setSelection(Math.max(0, Arrays.asList(LOCALES).indexOf(preferences.getString("locale", "system"))));
    locale.setContentDescription("Language / 语言");
    locale.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
      public void onNothingSelected(android.widget.AdapterView<?> parent) { }
      public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
        String selected = LOCALES[position];
        if (!selected.equals(preferences.getString("locale", "system"))) {
          preferences.edit().putString("locale", selected).apply();
          applyLocale();
          recreate();
        }
      }
    });
    bar.addView(locale, new LinearLayout.LayoutParams(dp(92), dp(48)));
    return bar;
  }

  private View hero() {
    LinearLayout root = column();
    LinearLayout statusRow = row();
    statusRow.setGravity(Gravity.CENTER_VERTICAL);
    connectionLabel = text("", 12, true, MUTED);
    statusRow.addView(connectionLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    Button reconnect = quietButton("Reconnect", view -> updateConnectionStatus());
    reconnect.setContentDescription("Retry Calendar network connection");
    statusRow.addView(reconnect);
    root.addView(statusRow);
    root.addView(text("Your time, clearly coordinated", 30, true, INK), matchWrap(0, 8, 0, 0));
    root.addView(text("Plan across time zones, review every change, and keep guest drafts private on this device.", 14, false, MUTED), matchWrap(0, 6, 0, 0));
    updateConnectionStatus();
    return root;
  }

  private View viewToolbar() {
    MaterialCardView card = card(Color.WHITE);
    LinearLayout root = column();
    root.setPadding(dp(14), dp(12), dp(14), dp(12));

    HorizontalScrollView views = new HorizontalScrollView(this);
    views.setHorizontalScrollBarEnabled(false);
    LinearLayout choices = row();
    for (String name : new String[]{"Day", "Week", "Month", "Agenda"}) {
      Button button = pill(name, name.equals(activeView));
      button.setTag(name);
      button.setOnClickListener(view -> {
        activeView = String.valueOf(view.getTag());
        render();
      });
      choices.addView(button, wrapWrap(0, 0, 8, 0));
    }
    views.addView(choices);
    root.addView(views);

    LinearLayout navigation = row();
    navigation.setGravity(Gravity.CENTER_VERTICAL);
    Button previous = quietButton("‹", view -> moveRange(-1));
    previous.setContentDescription("Previous " + activeView.toLowerCase(Locale.ROOT));
    Button today = quietButton(getString(R.string.today), view -> { focusDate = LocalDate.now(); refreshDates(); });
    Button next = quietButton("›", view -> moveRange(1));
    next.setContentDescription("Next " + activeView.toLowerCase(Locale.ROOT));
    navigation.addView(previous);
    navigation.addView(today, wrapWrap(8, 0, 8, 0));
    navigation.addView(next);
    dateRange = text("", 15, true, INK);
    dateRange.setGravity(Gravity.END);
    navigation.addView(dateRange, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    root.addView(navigation, matchWrap(0, 10, 0, 0));
    card.addView(root);
    return card;
  }

  private View calendarWorkspace() {
    LinearLayout root = column();
    weekStrip = row();
    weekStrip.setContentDescription(getString(R.string.a11y_timeline));
    root.addView(weekStrip);

    MaterialCardView agendaCard = card(Color.WHITE);
    LinearLayout agendaRoot = column();
    agendaRoot.setPadding(dp(18), dp(18), dp(18), dp(18));
    LinearLayout heading = row();
    heading.setGravity(Gravity.CENTER_VERTICAL);
    heading.addView(text(activeView + " schedule", 20, true, INK), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    Button create = primaryButton("＋  " + getString(R.string.create), view -> create());
    create.setContentDescription(getString(R.string.create));
    heading.addView(create);
    agendaRoot.addView(heading);
    agendaRoot.addView(text(ZoneId.systemDefault().getId() + " · changes require review", 12, false, MUTED), matchWrap(0, 4, 0, 10));
    agenda = column();
    agendaRoot.addView(agenda);
    agendaCard.addView(agendaRoot);
    root.addView(agendaCard, matchWrap(0, 12, 0, 0));
    refreshDates();
    reloadAgenda();
    return root;
  }

  private View assistantCard() {
    MaterialCardView card = card(SOFT_BLUE);
    card.setStrokeColor(Color.rgb(205, 214, 247));
    LinearLayout root = column();
    root.setPadding(dp(18), dp(18), dp(18), dp(18));
    root.addView(text(getString(R.string.ai), 18, true, BLUE_DARK));
    root.addView(text(getString(R.string.privacy), 13, false, MUTED), matchWrap(0, 5, 0, 10));
    LinearLayout actions = row();
    actions.addView(quietButton(getString(R.string.review), view -> showAIBoundary()), new LinearLayout.LayoutParams(0, dp(48), 1));
    actions.addView(quietButton(getString(R.string.recover), view -> wallet(true)), new LinearLayout.LayoutParams(0, dp(48), 1));
    root.addView(actions);
    root.addView(text(getString(R.string.security), 12, false, MUTED), matchWrap(0, 10, 0, 0));
    card.addView(root);
    return card;
  }

  private void refreshDates() {
    if (dateRange == null || weekStrip == null) return;
    LocalDate start = focusDate.minusDays((focusDate.getDayOfWeek().getValue() + 6) % 7);
    LocalDate end = start.plusDays(6);
    if ("Day".equals(activeView)) dateRange.setText(focusDate.format(DateTimeFormatter.ofPattern("MMM d, yyyy")));
    else if ("Month".equals(activeView)) dateRange.setText(focusDate.format(DateTimeFormatter.ofPattern("MMMM yyyy")));
    else dateRange.setText(start.format(DateTimeFormatter.ofPattern("MMM d")) + " – " + end.format(DateTimeFormatter.ofPattern("MMM d")));
    weekStrip.removeAllViews();
    for (int index = 0; index < 7; index++) {
      LocalDate day = start.plusDays(index);
      LinearLayout cell = column();
      cell.setGravity(Gravity.CENTER);
      cell.setPadding(dp(2), dp(10), dp(2), dp(10));
      if (day.equals(focusDate)) cell.setBackground(shape(SOFT_BLUE, 12, BLUE, 1));
      cell.addView(text(day.getDayOfWeek().getDisplayName(TextStyle.SHORT, Locale.getDefault()).substring(0, 1), 11, true, MUTED));
      TextView number = text(String.valueOf(day.getDayOfMonth()), 16, true, day.equals(focusDate) ? BLUE : INK);
      number.setGravity(Gravity.CENTER);
      cell.addView(number);
      cell.setContentDescription(day.format(DateTimeFormatter.ofPattern("EEEE, MMMM d")));
      cell.setOnClickListener(view -> { focusDate = day; refreshDates(); });
      weekStrip.addView(cell, new LinearLayout.LayoutParams(0, dp(66), 1));
    }
  }

  private void moveRange(int direction) {
    if ("Day".equals(activeView)) focusDate = focusDate.plusDays(direction);
    else if ("Month".equals(activeView)) focusDate = focusDate.plusMonths(direction);
    else focusDate = focusDate.plusWeeks(direction);
    refreshDates();
  }

  private void reloadAgenda() {
    agenda.removeAllViews();
    String title = preferences.getString("event_title", "").trim();
    if (title.isEmpty()) {
      LinearLayout empty = column();
      empty.setGravity(Gravity.CENTER);
      empty.setPadding(dp(8), dp(34), dp(8), dp(34));
      TextView icon = text("○", 34, false, BLUE);
      icon.setContentDescription("Empty calendar");
      empty.addView(icon);
      empty.addView(text(getString(R.string.empty), 17, true, INK));
      empty.addView(text("Create an event or continue in guest mode without an account.", 13, false, MUTED), matchWrap(0, 4, 0, 0));
      agenda.addView(empty);
      return;
    }
    LinearLayout event = row();
    event.setGravity(Gravity.TOP);
    event.setPadding(dp(14), dp(14), dp(14), dp(14));
    event.setBackground(shape(Color.rgb(250, 251, 255), 12, LINE, 1));
    View rail = new View(this);
    rail.setBackground(shape(BLUE, 99, BLUE, 0));
    event.addView(rail, new LinearLayout.LayoutParams(dp(4), dp(76)));
    LinearLayout copy = column();
    copy.setPadding(dp(12), 0, dp(8), 0);
    copy.addView(text(title, 17, true, INK));
    copy.addView(text(preferences.getString("event_time", "") + " · " + preferences.getString("event_zone", ZoneId.systemDefault().getId()), 13, false, MUTED));
    copy.addView(text(getString(R.string.repeat) + ": " + preferences.getString("event_repeat", "none") + " · " + getString(R.string.reminder) + ": 15m", 12, false, MUTED));
    event.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    event.setOnClickListener(view -> eventActions(title));
    event.setContentDescription(title + ", open event actions");
    agenda.addView(event);
  }

  private void create() {
    LinearLayout form = column();
    form.setPadding(dp(20), 0, dp(20), 0);
    EditText title = input("Event title", preferences.getString("event_title", ""));
    EditText time = input("Start · 2026-08-14 10:00", preferences.getString("event_time", ""));
    EditText zone = input(getString(R.string.timezone), preferences.getString("event_zone", ZoneId.systemDefault().getId()));
    EditText invite = input(getString(R.string.invite), "");
    Spinner recurrence = new Spinner(this);
    recurrence.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"none", "daily", "weekly", "monthly", "yearly"}));
    form.addView(labeled("Event details", title));
    form.addView(labeled("Date and time", time));
    form.addView(labeled(getString(R.string.timezone), zone));
    form.addView(labeled(getString(R.string.invite), invite));
    form.addView(labeled(getString(R.string.repeat), recurrence));
    form.addView(text(getString(R.string.conflict) + " · Changes are previewed before approval.", 12, false, MUTED), matchWrap(0, 12, 0, 0));
    new AlertDialog.Builder(this)
        .setTitle(getString(R.string.create))
        .setView(form)
        .setNegativeButton(android.R.string.cancel, null)
        .setPositiveButton(getString(R.string.review), (dialog, which) -> {
          String eventTitle = title.getText().toString().trim();
          if (eventTitle.isEmpty()) eventTitle = "Untitled event";
          preferences.edit()
              .putString("event_title", eventTitle)
              .putString("event_time", time.getText().toString().trim())
              .putString("event_zone", zone.getText().toString().trim())
              .putString("event_repeat", String.valueOf(recurrence.getSelectedItem()))
              .putBoolean("queued", !online()).apply();
          reloadAgenda();
        }).show();
  }

  private void eventActions(String title) {
    new AlertDialog.Builder(this)
        .setTitle(title)
        .setItems(new String[]{getString(R.string.update), getString(R.string.rsvp), getString(R.string.share), getString(R.string.cancel_event)}, (dialog, which) -> {
          if (which == 0) create();
          else if (which == 3) confirmCancel();
          else toastBoundary(which == 1 ? "RSVP requires a verified invitation." : "Sharing requires a verified YNX identity.");
        }).show();
  }

  private void confirmCancel() {
    new AlertDialog.Builder(this).setTitle(getString(R.string.cancel_event))
        .setMessage("Review this cancellation before removing the local draft.")
        .setNegativeButton(android.R.string.cancel, null)
        .setPositiveButton(getString(R.string.approve), (dialog, which) -> {
          preferences.edit().remove("event_title").apply();
          reloadAgenda();
        }).show();
  }

  private void showAIBoundary() {
    new AlertDialog.Builder(this).setTitle(getString(R.string.ai))
        .setMessage(getString(R.string.privacy) + "\n\n" + getString(R.string.unavailable) + ". The hosted AI gateway is not enabled in this native preview.")
        .setNegativeButton(android.R.string.cancel, null)
        .setPositiveButton(getString(R.string.approve), null).show();
  }

  private void toastBoundary(String message) {
    new AlertDialog.Builder(this).setTitle("YNX Calendar").setMessage(message).setPositiveButton(android.R.string.ok, null).show();
  }

  private void registerNetworkStatus() {
    ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
    networkCallback = new ConnectivityManager.NetworkCallback() {
      @Override public void onAvailable(Network network) { runOnUiThread(() -> updateConnectionStatus()); }
      @Override public void onLost(Network network) { runOnUiThread(() -> updateConnectionStatus()); }
      @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) { runOnUiThread(() -> updateConnectionStatus()); }
    };
    manager.registerNetworkCallback(new NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), networkCallback);
  }

  private void updateConnectionStatus() {
    if (connectionLabel == null) return;
    boolean connected = online();
    connectionLabel.setText(connected ? "●  Network available · Testnet session not signed in" : "●  " + getString(R.string.offline));
    connectionLabel.setTextColor(connected ? Color.rgb(2, 122, 72) : Color.rgb(180, 35, 24));
  }

  private void wallet(boolean recovery) {
    try {
      JSONObject request = new JSONObject();
      DateTimeFormatter format = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
      request.put("version", "1");
      request.put("nonce", nonce());
      request.put("chainId", "ynx_6423-1");
      request.put("requestingProduct", "calendar");
      request.put("productClientId", CLIENT);
      request.put("bundleId", BUNDLE);
      request.put("productDeviceAlgorithm", "p256-sha256");
      request.put("productDeviceKey", key());
      request.put("callback", CALLBACK);
      request.put("scopes", new JSONArray().put(recovery ? "calendar:recover" : "calendar:account"));
      request.put("purpose", recovery ? "Recover YNX Calendar on this device" : "Sign in to YNX Calendar on this device");
      request.put("issuedAt", format.format(Instant.now()));
      request.put("expiresAt", format.format(Instant.now().plusSeconds(300)));
      preferences.edit().putString("pending_request", canonical(request)).apply();
      String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(canonical(request).getBytes(StandardCharsets.UTF_8));
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("ynxwallet://authorize?request=" + encoded)));
    } catch (ActivityNotFoundException missing) {
      new AlertDialog.Builder(this).setTitle("YNX Wallet required")
          .setMessage("Install YNX Wallet to approve this native sign-in. You can continue using device-only guest drafts now.")
          .setNegativeButton("Continue as guest", null)
          .setPositiveButton("Open YNX ecosystem", (dialog, which) -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://ynxweb4.com/ecosystem"))))
          .show();
    } catch (Exception error) {
      toastBoundary(getString(R.string.unavailable) + ": " + error.getClass().getSimpleName());
    }
  }

  private void callback(Intent intent) {
    if (intent == null || intent.getData() == null) return;
    try {
      Uri uri = intent.getData();
      if (!"ynxcalendar".equals(uri.getScheme()) || !"wallet-auth".equals(uri.getHost()) || !"/callback".equals(uri.getPath()) || uri.getFragment() != null || !uri.getQueryParameterNames().equals(Collections.singleton("response"))) throw new SecurityException();
      String encoded = uri.getQueryParameter("response");
      String pending = preferences.getString("pending_request", null);
      if (encoded == null || pending == null) throw new SecurityException();
      JSONObject response = new JSONObject(new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8));
      JSONObject request = new JSONObject(pending);
      for (String name : Arrays.asList("version", "nonce", "chainId", "requestingProduct", "productClientId", "bundleId", "productDeviceAlgorithm", "productDeviceKey", "callback", "purpose"))
        if (!request.getString(name).equals(response.getString(name))) throw new SecurityException();
      if (!request.getJSONArray("scopes").toString().equals(response.getJSONArray("scopes").toString())) throw new SecurityException();
      String requestNonce = response.getString("nonce");
      if (preferences.getBoolean("consumed." + requestNonce, false)) throw new SecurityException();
      String expected = hex(MessageDigest.getInstance("SHA-256").digest(("YNX_WALLET_AUTH_REQUEST_V1\n" + canonical(request)).getBytes(StandardCharsets.UTF_8)));
      if (!expected.equals(response.getString("requestDigest"))) throw new SecurityException();
      preferences.edit().putBoolean("consumed." + requestNonce, true).putString("wallet_response", canonical(response)).putString("wallet_state", "gateway_required").apply();
      toastBoundary("Wallet approval received. Central Gateway verification is still required before a session is created.");
    } catch (Exception rejected) {
      toastBoundary(getString(R.string.security));
    }
  }

  private String hex(byte[] value) {
    StringBuilder result = new StringBuilder();
    for (byte item : value) result.append(String.format("%02x", item));
    return result.toString();
  }

  private String canonical(Object value) throws JSONException {
    if (value == JSONObject.NULL) return "null";
    if (value instanceof String) return JSONObject.quote((String) value);
    if (value instanceof JSONArray array) {
      StringBuilder result = new StringBuilder("[");
      for (int index = 0; index < array.length(); index++) {
        if (index > 0) result.append(",");
        result.append(canonical(array.get(index)));
      }
      return result.append("]").toString();
    }
    if (value instanceof JSONObject object) {
      ArrayList<String> names = new ArrayList<>();
      object.keys().forEachRemaining(names::add);
      Collections.sort(names);
      StringBuilder result = new StringBuilder("{");
      for (int index = 0; index < names.size(); index++) {
        if (index > 0) result.append(",");
        result.append(JSONObject.quote(names.get(index))).append(":").append(canonical(object.get(names.get(index))));
      }
      return result.append("}").toString();
    }
    return String.valueOf(value);
  }

  private String key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    String alias = "ynx_calendar_product_device";
    if (!store.containsAlias(alias)) {
      KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
      generator.initialize(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
          .setDigests(KeyProperties.DIGEST_SHA256)
          .setAlgorithmParameterSpec(new java.security.spec.ECGenParameterSpec("secp256r1")).build());
      generator.generateKeyPair();
    }
    ECPublicKey publicKey = (ECPublicKey) store.getCertificate(alias).getPublicKey();
    byte[] compressed = new byte[33];
    byte[] x = fixed(publicKey.getW().getAffineX());
    compressed[0] = (byte) (publicKey.getW().getAffineY().testBit(0) ? 3 : 2);
    System.arraycopy(x, 0, compressed, 1, 32);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(compressed);
  }

  private byte[] fixed(BigInteger number) {
    byte[] input = number.toByteArray();
    byte[] output = new byte[32];
    System.arraycopy(input, Math.max(0, input.length - 32), output, Math.max(0, 32 - input.length), Math.min(32, input.length));
    return output;
  }

  private String nonce() {
    byte[] value = new byte[32];
    new SecureRandom().nextBytes(value);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
  }

  private void applyLocale() {
    String locale = preferences == null ? "system" : preferences.getString("locale", "system");
    AppCompatDelegate.setApplicationLocales("system".equals(locale) ? LocaleListCompat.getEmptyLocaleList() : LocaleListCompat.forLanguageTags(locale));
  }

  private boolean online() {
    ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
    Network network = manager.getActiveNetwork();
    NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
    return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
  }

  private MaterialCardView card(int color) {
    MaterialCardView card = new MaterialCardView(this);
    card.setCardBackgroundColor(color);
    card.setRadius(dp(16));
    card.setCardElevation(dp(1));
    card.setStrokeWidth(dp(1));
    card.setStrokeColor(LINE);
    return card;
  }

  private LinearLayout row() { LinearLayout value = new LinearLayout(this); value.setOrientation(LinearLayout.HORIZONTAL); return value; }
  private LinearLayout column() { LinearLayout value = new LinearLayout(this); value.setOrientation(LinearLayout.VERTICAL); return value; }

  private TextView text(String value, int size, boolean bold, int color) {
    TextView text = new TextView(this);
    text.setText(value);
    text.setTextSize(size);
    text.setTextColor(color);
    text.setTypeface(Typeface.create("sans", bold ? Typeface.BOLD : Typeface.NORMAL));
    text.setLineSpacing(0, 1.08f);
    return text;
  }

  private Button primaryButton(String label, View.OnClickListener listener) {
    Button button = new Button(this);
    button.setText(label);
    button.setTextColor(Color.WHITE);
    button.setTextSize(13);
    button.setAllCaps(false);
    button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    button.setMinHeight(dp(46));
    button.setBackground(shape(BLUE, 10, BLUE, 0));
    button.setOnClickListener(listener);
    return button;
  }

  private Button quietButton(String label, View.OnClickListener listener) {
    Button button = new Button(this);
    button.setText(label);
    button.setTextColor(BLUE_DARK);
    button.setTextSize(13);
    button.setAllCaps(false);
    button.setMinHeight(dp(42));
    button.setBackground(shape(Color.WHITE, 10, LINE, 1));
    button.setOnClickListener(listener);
    return button;
  }

  private Button pill(String label, boolean active) {
    Button button = new Button(this);
    button.setText(label);
    button.setAllCaps(false);
    button.setTextSize(13);
    button.setTextColor(active ? Color.WHITE : MUTED);
    button.setTypeface(Typeface.DEFAULT, active ? Typeface.BOLD : Typeface.NORMAL);
    button.setBackground(shape(active ? BLUE : WASH, 9, active ? BLUE : Color.TRANSPARENT, 0));
    button.setMinHeight(dp(40));
    return button;
  }

  private GradientDrawable shape(int fill, int radius, int stroke, int strokeWidth) {
    GradientDrawable drawable = new GradientDrawable();
    drawable.setColor(fill);
    drawable.setCornerRadius(dp(radius));
    if (strokeWidth > 0) drawable.setStroke(dp(strokeWidth), stroke);
    return drawable;
  }

  private EditText input(String hint, String value) {
    EditText input = new EditText(this);
    input.setHint(hint);
    input.setText(value);
    input.setSingleLine(true);
    input.setTextColor(INK);
    input.setHintTextColor(MUTED);
    input.setBackground(shape(WASH, 10, LINE, 1));
    input.setPadding(dp(12), 0, dp(12), 0);
    input.setMinHeight(dp(50));
    return input;
  }

  private View labeled(String label, View control) {
    LinearLayout group = column();
    TextView name = text(label, 12, true, MUTED);
    group.addView(name, matchWrap(0, 12, 0, 6));
    group.addView(control, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
    return group;
  }

  private LinearLayout.LayoutParams matchWrap(int left, int top, int right, int bottom) {
    LinearLayout.LayoutParams value = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    value.setMargins(dp(left), dp(top), dp(right), dp(bottom));
    return value;
  }

  private LinearLayout.LayoutParams wrapWrap(int left, int top, int right, int bottom) {
    LinearLayout.LayoutParams value = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    value.setMargins(dp(left), dp(top), dp(right), dp(bottom));
    return value;
  }

  private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density); }
}

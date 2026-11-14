package com.ynx.social.matrix;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Process;
import android.os.UserManager;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import java.io.File;
import java.io.FileDescriptor;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;

/** Internal PRE_DEVICE local custody only. Not an Expo/JNI message API or
 * source/device/history/admission/restore/rollback proof. No key operation.
 * Called ONLY by the actual submitted JNI command on its reserved worker,
 * after real identity checking AND common inventory reservation. */
public final class VeilOwnKeyLocalStoreContext {
  private VeilOwnKeyLocalStoreContext() {}
  public enum Profile {
    SOCIAL_V1("com.ynx.social"), PUBLIC_VEIL_QA_V1("com.ynx.social.veilqa"), M1_QA_V1("com.ynx.social.m1qa");
    final String packageName;
    Profile(String name) { packageName = name; }
  }
  public enum Status { UNVERIFIED_LOCAL_READY, REFUSED_LOCAL, UNKNOWN_LOCAL, CLOSED_LOCAL }
  private enum OpenMode { FRESH_PREPARATION, EXISTING_ONLY }
  /** No Boolean permission or new registry. Actual existing command rechecks
   * its submitted state, identity, SAME worker and reserved commonInventory.
   * A dummy implementation never establishes those external facts. */
  public interface SubmittedCheck { void revalidate() throws Throwable; }
  /** Synchronous private use; do not escape path or release owner while native
   * SQLite store still owns it. Retain this owner until C-store cleanup ends. */
  public interface PathUse { void use(String databasePath) throws Throwable; }
  public static final class Outcome {
    private Status status;
    private final Owner owner;
    private Throwable primary;
    private Throwable secondary;
    private String publicCode;
    private Outcome(Status s, Owner o, Throwable p, String c) {
      this(s, o, p, null, c);
    }
    private Outcome(Status s, Owner o, Throwable p, Throwable extra, String c) {
      status = s; owner = o; primary = p; secondary = extra; publicCode = c;
    }
    public Status status() { return status; }
    public Owner owner() { return owner; }
    public Throwable primary() { return primary; }
    public Throwable secondary() { return secondary; }
    public String publicCode() { return publicCode; }
    private Outcome finish(Status s, Throwable p, Throwable extra, String code) {
      status = s; primary = p; secondary = extra; publicCode = code; return this;
    }
  }
  // Carriers allocated BEFORE effects; finalization assigns references only.
  // Read-only to caller, populated once for return; not a permission object.
  private static final class Refusal extends Exception {
    private static final long serialVersionUID = 1L;
    Refusal(String code) { super(code); }
  }
  private static void require(boolean value, String code) throws Refusal {
    if (!value) throw new Refusal(code);
  }
  /** Only Android's user-0 CE framework aliases, never a caller path policy.
   * Context/PackageManager identity, lstat, UID/mode and FD pins are separately
   * mandatory. This predicate alone grants no filesystem or device authority.
   */
  static boolean isRecognizedFrameworkDataAlias(String supplied, String canonical,
      String packageName, int uid) {
    if (uid < 10000 || uid >= 100000 ||
        !("com.ynx.social".equals(packageName) || "com.ynx.social.veilqa".equals(packageName) || "com.ynx.social.m1qa".equals(packageName))) return false;
    String userRoot = "/data/user/0/" + packageName;
    String legacyRoot = "/data/data/" + packageName;
    return (userRoot.equals(supplied) && legacyRoot.equals(canonical)) ||
        (legacyRoot.equals(supplied) && userRoot.equals(canonical));
  }
  private static final byte[] DOMAIN =
      "YNX-SOCIAL-PREDEVICE-OWNKEY-NAMESPACE-V1".getBytes(StandardCharsets.US_ASCII);
  /** SHA256 of LP(domain)||LP(exact UTF8 alias)||LP(BE64 signed generation).
   * Public deterministic bookkeeping, NOT secret hashing/KDF/authentication.
   * No trim, case fold or Unicode normalization; malformed UTF16 rejected. */
  public static String namespaceForPublicInputs(String alias, long generation) throws Exception {
    require(alias != null && !alias.isEmpty() && alias.length() <= 256, "LOCAL_ALIAS_BOUND");
    require(generation >= 0, "LOCAL_GENERATION_BOUND");
    ByteBuffer encoded;
    try {
      encoded = StandardCharsets.UTF_8.newEncoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(alias));
    } catch (CharacterCodingException ignored) { throw new Refusal("LOCAL_ALIAS_ENCODING"); }
    require(encoded.remaining() <= 256, "LOCAL_ALIAS_BOUND");
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    digest.update(ByteBuffer.allocate(4).putInt(DOMAIN.length).array()); digest.update(DOMAIN);
    digest.update(ByteBuffer.allocate(4).putInt(encoded.remaining()).array()); digest.update(encoded);
    digest.update(ByteBuffer.allocate(4).putInt(8).array());
    digest.update(ByteBuffer.allocate(8).putLong(generation).array());
    byte[] value = digest.digest();
    char[] hex = new char[64]; String digits = "0123456789abcdef";
    for (int i = 0; i < value.length; i++) {
      hex[i * 2] = digits.charAt((value[i] & 255) >>> 4);
      hex[i * 2 + 1] = digits.charAt(value[i] & 15);
    }
    return new String(hex);
  }
  private static final class Pin {
    final String path;
    FileDescriptor fd;
    final long dev, ino;
    final boolean frameworkContainer, databaseFile;
    boolean closed, closeUncertain;
    Pin(String p, StructStat s, boolean framework) {
      this(p, s, framework, false);
    }
    Pin(String p, StructStat s, boolean framework, boolean database) {
      path = p; dev = s.st_dev; ino = s.st_ino; frameworkContainer = framework; databaseFile = database;
    }
  }
  public static final class Owner {
    private final Thread thread = Thread.currentThread();
    private final Context retained;
    private final Profile profile;
    private final SubmittedCheck submitted;
    private final OpenMode mode;
    private final int uid = Process.myUid(), pid = Process.myPid();
    private final int gid = Os.getgid();
    private final ArrayList<Pin> pins = new ArrayList<Pin>(6);
    private String databasePath;
    private String ceDataPath;
    private String ceSuppliedDataPath;
    private boolean ready, active, closed, closeUncertain, hadFileEffect;
    private Owner(Context c, Profile p, SubmittedCheck s, OpenMode m) {
      retained = c; profile = p; submitted = s; mode = m;
    }
    private void checkThread() throws Refusal {
      require(Thread.currentThread() == thread, "LOCAL_OWNER_THREAD");
      require(!closed && !active && !closeUncertain, "LOCAL_OWNER_LIFETIME");
    }
    private void checkContext() throws Throwable {
      require(submitted != null, "LOCAL_SUBMITTED_GUARD_REQUIRED"); submitted.revalidate();
      require(retained != null && retained.getApplicationContext() == retained,
          "LOCAL_RETAINED_APP_CONTEXT_REQUIRED");
      require(profile != null && profile.packageName.equals(retained.getPackageName()), "LOCAL_PACKAGE");
      require(Process.myUid() == uid && Process.myPid() == pid, "LOCAL_PROCESS_CHANGED");
      require(Os.getuid() == uid && Os.geteuid() == uid && Os.getgid() == gid && Os.getegid() == gid,
          "LOCAL_PROCESS_GROUP_PROFILE");
      ApplicationInfo info = retained.getApplicationInfo();
      require(info != null && info.uid == uid && profile.packageName.equals(info.packageName), "LOCAL_UID");
      if (ceDataPath != null) {
        File currentData = retained.getDataDir();
        require(ceSuppliedDataPath.equals(info.dataDir) && currentData != null
            && ceSuppliedDataPath.equals(currentData.getAbsolutePath())
            && ceDataPath.equals(currentData.getCanonicalPath()), "LOCAL_CE_DATA_CHANGED");
        // An OS ancestor alias is not permission to follow an app-owned leaf
        // link or retarget the original directory after a callback.
        StructStat supplied = Os.lstat(ceSuppliedDataPath), canonical = Os.lstat(ceDataPath);
        statPolicy(supplied, true); statPolicy(canonical, true);
        require(supplied.st_dev == canonical.st_dev && supplied.st_ino == canonical.st_ino,
            "LOCAL_CE_DATA_IDENTITY_CHANGED");
      }
      ApplicationInfo installed = retained.getPackageManager().getApplicationInfo(profile.packageName, 0);
      require(installed != null && installed.uid == uid && profile.packageName.equals(installed.packageName),
          "LOCAL_INSTALLED_PACKAGE_UID");
      if (ceDataPath != null) {
        require(ceSuppliedDataPath.equals(installed.dataDir)
            && ceDataPath.equals(new File(installed.dataDir).getCanonicalPath()), "LOCAL_INSTALLED_DATA_CHANGED");
      }
      require(!retained.isDeviceProtectedStorage(), "LOCAL_CE_REQUIRED");
      UserManager users = (UserManager) retained.getSystemService(Context.USER_SERVICE);
      require(users != null && users.isUserUnlocked(), "LOCAL_USER_LOCKED");
    }
    private void statPolicy(StructStat s, boolean frameworkContainer) throws Refusal {
      int mode = s.st_mode & 07777;
      require(OsConstants.S_ISDIR(s.st_mode) && s.st_uid == uid && s.st_gid == gid
          && (mode == 0700 || (frameworkContainer && mode == 0771)),
          "LOCAL_NAMESPACE_POLICY");
    }
    private void pin(File directory, boolean create, boolean frameworkContainer) throws Throwable {
      checkContext();
      String path = directory.getAbsolutePath();
      if (create) {
        require(mode == OpenMode.FRESH_PREPARATION, "LOCAL_EXISTING_ONLY_NO_CREATE");
        hadFileEffect = true;
        try { Os.mkdir(path, 0700); }
        catch (ErrnoException e) { if (e.errno != OsConstants.EEXIST) throw e; }
      }
      StructStat before = Os.lstat(path); statPolicy(before, frameworkContainer);
      checkContext();
      require(pins.size() < 5, "LOCAL_PIN_BOUND");
      Pin p = new Pin(path, before, frameworkContainer); pins.add(p);
      // Preallocated list capacity + pin registration precede open. No allocation
      // between the returned descriptor and its owning field assignment.
      hadFileEffect = true;
      p.fd = Os.open(path,
          OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW | OsConstants.O_CLOEXEC, 0);
      StructStat actual = Os.fstat(p.fd); statPolicy(actual, frameworkContainer);
      require(actual.st_dev == before.st_dev && actual.st_ino == before.st_ino, "LOCAL_PATH_REPLACED");
      verifyPins();
    }
    private void databasePolicy(StructStat s) throws Refusal {
      require(OsConstants.S_ISREG(s.st_mode) && s.st_uid == uid && s.st_gid == gid
          && (s.st_mode & 07777) == 0600 && s.st_nlink == 1,
          "LOCAL_EXISTING_DATABASE_POLICY");
    }
    private void pinExistingDatabase(File database) throws Throwable {
      require(mode == OpenMode.EXISTING_ONLY && pins.size() == 5,
          "LOCAL_EXISTING_DATABASE_STAGE");
      checkContext(); verifyPins();
      String path = database.getAbsolutePath();
      StructStat before = Os.lstat(path); databasePolicy(before);
      Pin p = new Pin(path, before, false, true); pins.add(p);
      hadFileEffect = true;
      // No O_CREAT, SQLite open, schema initialization or repair. NONBLOCK
      // avoids waiting if a regular leaf is raced into a FIFO before open.
      p.fd = Os.open(path, OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW
          | OsConstants.O_CLOEXEC | OsConstants.O_NONBLOCK, 0);
      StructStat actual = Os.fstat(p.fd); databasePolicy(actual);
      require(actual.st_dev == before.st_dev && actual.st_ino == before.st_ino,
          "LOCAL_EXISTING_DATABASE_REPLACED");
      checkContext(); verifyPins();
    }
    private void verifyPins() throws Throwable {
      for (Pin p : pins) {
        require(p.fd != null && !p.closed && !p.closeUncertain, "LOCAL_PIN_LIFETIME");
        StructStat current = Os.lstat(p.path), actual = Os.fstat(p.fd);
        if (p.databaseFile) { databasePolicy(current); databasePolicy(actual); }
        else { statPolicy(current, p.frameworkContainer); statPolicy(actual, p.frameworkContainer); }
        require(current.st_dev == p.dev && current.st_ino == p.ino && actual.st_dev == p.dev && actual.st_ino == p.ino,
            "LOCAL_PATH_REPLACED");
      }
    }
    /** Every failure retains this owner and EXACT primary object. No implicit
     * close/delete/retry on a callback or validation error. */
    public Outcome withDatabasePath(PathUse use) {
      return withPath(use, OpenMode.FRESH_PREPARATION);
    }
    /** Requires a separately matched native existing-only open. Java path
     * qualification does not make the old creating C open safe for recovery. */
    public Outcome withExistingDatabasePath(PathUse use) {
      return withPath(use, OpenMode.EXISTING_ONLY);
    }
    private Outcome withPath(PathUse use, OpenMode expected) {
      Outcome result = new Outcome(Status.REFUSED_LOCAL, this, null, "LOCAL_PATH_REFUSED");
      Throwable primary = null, secondary = null;
      boolean entered = false;
      try {
        checkThread(); require(mode == expected, "LOCAL_PATH_MODE_MISMATCH");
        require(ready && use != null, "LOCAL_NOT_READY");
        active = true; entered = true; checkContext(); verifyPins();
        try { use.use(databasePath); } catch (Throwable t) { primary = t; }
        try { checkContext(); verifyPins(); }
        catch (Throwable t) {
          if (primary == null) primary = t;
          else if (primary != t) {
            secondary = t;
            // Independent references are authoritative; suppression is best effort.
            try { primary.addSuppressed(t); } catch (Throwable ignored) { }
          }
        }
        finally { active = false; }
        if (primary != null) return result.finish(Status.UNKNOWN_LOCAL, primary, secondary, "LOCAL_PATH_USE_FAILED");
        return result.finish(Status.UNVERIFIED_LOCAL_READY, null, null, "LOCAL_UNVERIFIED");
      } catch (Throwable t) {
        return result.finish(Status.REFUSED_LOCAL, t, null, "LOCAL_PATH_REFUSED");
      } finally { if (entered) active = false; }
    }
    /** Same thread cleanup even after guard/user-unlock refusal. A failed
     * close is ambiguous: retain owner/FD and NEVER blindly retry that close.
     * Existing command/TLS supervisor owns further disposition; no reset. */
    public Outcome close() {
      Outcome result = new Outcome(Status.REFUSED_LOCAL, this, null, "LOCAL_CLOSE_REFUSED");
      try {
        require(Thread.currentThread() == thread && !active, "LOCAL_CLEANUP_THREAD_OR_BORROW");
        if (closed) return result.finish(Status.CLOSED_LOCAL, null, null, "LOCAL_CLOSED");
        require(!closeUncertain, "LOCAL_CLEANUP_UNCERTAIN");
        for (int i = pins.size() - 1; i >= 0; i--) {
          Pin p = pins.get(i);
          if (p.closed || p.fd == null) continue;
          try { Os.close(p.fd); p.closed = true; }
          catch (Throwable t) {
            p.closeUncertain = true; closeUncertain = true; ready = false;
            return result.finish(Status.UNKNOWN_LOCAL, t, null, "LOCAL_CLOSE_UNKNOWN");
          }
        }
        ready = false; closed = true;
        return result.finish(Status.CLOSED_LOCAL, null, null, "LOCAL_CLOSED");
      } catch (Throwable t) { return result.finish(Status.REFUSED_LOCAL, t, null, "LOCAL_CLOSE_REFUSED"); }
    }
  }
  /** Does not expose raw path input/FDs or mint a reservation. Caller already
   * owns real inventory slot and retains Outcome.owner even on failure. */
  public static Outcome prepare(Context retainedAppContext, Profile profile, String localAlias,
      long storageGeneration, SubmittedCheck actualSubmittedCheck) {
    return prepareInMode(retainedAppContext, profile, localAlias, storageGeneration,
        actualSubmittedCheck, OpenMode.FRESH_PREPARATION);
  }
  /** No directory creation, no getNoBackupFilesDir, no database creation.
   * Missing state remains refusal/unknown with owner retained, never genesis.
   * Public alias/generation are expectations, not authorization to recover. */
  public static Outcome prepareExisting(Context retainedAppContext, Profile profile, String localAlias,
      long storageGeneration, SubmittedCheck actualSubmittedCheck) {
    return prepareInMode(retainedAppContext, profile, localAlias, storageGeneration,
        actualSubmittedCheck, OpenMode.EXISTING_ONLY);
  }
  private static Outcome prepareInMode(Context retainedAppContext, Profile profile, String localAlias,
      long storageGeneration, SubmittedCheck actualSubmittedCheck, OpenMode mode) {
    Owner owner = new Owner(retainedAppContext, profile, actualSubmittedCheck, mode);
    Outcome result = new Outcome(Status.REFUSED_LOCAL, owner, null, "LOCAL_PREPARE_FAILED");
    try {
      owner.checkThread(); owner.checkContext();
      String namespace = namespaceForPublicInputs(localAlias, storageGeneration);
      owner.checkContext();
      File suppliedData = retainedAppContext.getDataDir();
      owner.checkContext();
      require(suppliedData != null && suppliedData.isAbsolute(), "LOCAL_CE_DATA_ROOT");
      StructStat suppliedDataStat = Os.lstat(suppliedData.getAbsolutePath());
      owner.statPolicy(suppliedDataStat, true);
      File data = suppliedData.getCanonicalFile();
      String declaredData = retainedAppContext.getApplicationInfo().dataDir;
      ApplicationInfo installed = retainedAppContext.getPackageManager().getApplicationInfo(profile.packageName, 0);
      require(declaredData != null && new File(declaredData).isAbsolute()
          && declaredData.equals(suppliedData.getAbsolutePath()) && installed != null
          && installed.uid == owner.uid && profile.packageName.equals(installed.packageName)
          && declaredData.equals(installed.dataDir), "LOCAL_CE_DATA_IDENTITY");
      require(suppliedData.getAbsolutePath().equals(data.getPath()) ||
          isRecognizedFrameworkDataAlias(suppliedData.getAbsolutePath(), data.getPath(), profile.packageName, owner.uid),
          "LOCAL_DATA_SYMLINK");
      StructStat canonicalDataStat = Os.lstat(data.getPath());
      owner.statPolicy(canonicalDataStat, true);
      require(suppliedDataStat.st_dev == canonicalDataStat.st_dev && suppliedDataStat.st_ino == canonicalDataStat.st_ino,
          "LOCAL_CE_DATA_IDENTITY_CHANGED");
      owner.ceSuppliedDataPath = suppliedData.getAbsolutePath();
      owner.ceDataPath = data.getPath();
      owner.pin(data, false, true);
      owner.checkContext();
      File supplied;
      if (mode == OpenMode.FRESH_PREPARATION) {
        // Only fresh preparation may call this directory-creating framework API.
        owner.hadFileEffect = true;
        supplied = retainedAppContext.getNoBackupFilesDir();
      } else {
        supplied = new File(suppliedData, "no_backup");
      }
      owner.checkContext(); owner.verifyPins();
      require(supplied != null && supplied.isAbsolute(), "LOCAL_NO_BACKUP_ROOT");
      require(supplied.getAbsolutePath().equals(new File(suppliedData, "no_backup").getAbsolutePath()),
          "LOCAL_ROOT_OUTSIDE_CE_DATA");
      StructStat suppliedRootStat = Os.lstat(supplied.getAbsolutePath());
      owner.statPolicy(suppliedRootStat, true);
      File root = supplied.getCanonicalFile();
      require(root.equals(new File(data, "no_backup")), "LOCAL_ROOT_OUTSIDE_CE_DATA");
      StructStat canonicalRootStat = Os.lstat(root.getPath());
      owner.statPolicy(canonicalRootStat, true);
      require(suppliedRootStat.st_dev == canonicalRootStat.st_dev && suppliedRootStat.st_ino == canonicalRootStat.st_ino,
          "LOCAL_ROOT_IDENTITY_CHANGED");
      owner.pin(root, false, true);
      boolean create = mode == OpenMode.FRESH_PREPARATION;
      File core = new File(root, "ynx-social-core-v1"); owner.pin(core, create, false);
      File ownkeys = new File(core, "ownkeys-v1"); owner.pin(ownkeys, create, false);
      File leaf = new File(ownkeys, namespace); owner.pin(leaf, create, false);
      File database = new File(leaf, "ownkeys.sqlite3");
      if (mode == OpenMode.EXISTING_ONLY) owner.pinExistingDatabase(database);
      owner.databasePath = database.getAbsolutePath();
      owner.checkContext(); owner.verifyPins(); owner.ready = true;
      return result.finish(Status.UNVERIFIED_LOCAL_READY, null, null, "LOCAL_UNVERIFIED");
    } catch (Throwable t) {
      return result.finish(owner.hadFileEffect ? Status.UNKNOWN_LOCAL : Status.REFUSED_LOCAL,
          t, null, "LOCAL_PREPARE_FAILED");
    }
  }
}

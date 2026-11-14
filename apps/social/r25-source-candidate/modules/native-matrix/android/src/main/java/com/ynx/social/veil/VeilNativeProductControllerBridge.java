package com.ynx.social.veil;
public final class VeilNativeProductControllerBridge {
private VeilNativeProductControllerBridge() {}
/** qbjl2M ABI1. Same original worker; inventory never grants account access. */
public static native int nativeProductPortsAbiVersion();
public static native long nativeReadProductSnapshot(byte[] output);
public static native long nativeSubscribeProductInvalidation();
public static native long nativePollProductInvalidation(long subscription, long afterEpoch);
public static native int nativeUnsubscribeProductInvalidation(long subscription);
public static native long nativeExecuteProduct(long epoch, int action, long selector, byte[] frame);
public static native long nativeReceiveOpaqueEvent(long epoch, long selector, byte[] frame);
/** Output presence is not message-purpose or device authority. */
public static native int nativeMessageOutputAbiVersion();
/** Same worker/original operation; positive is written length, negative is refusal. */
public static native long nativeCopyMessageOutput(long epoch, long selector, byte[] output);
/** Zero retires already-consumed output only, never claims peer delivery. */
public static native int nativeRetireMessageOutput(long epoch, long selector);
/** Original signed public records only; same owning worker and authenticated
 * local keys. A zero result is not permission to send a message. */
public static native int nativeAcquireAcceptedDevice(byte[] originalRecords);
public static native int nativeRestoreAcceptedDevice(byte[] originalRecords);
public static native int nativeAcceptedDeviceCurrent();
public static native int nativeReleaseAcceptedDevice();
/** Exact original MessageOpen public transport, never private session state. */
public static native int nativeOpenMessageSession(byte[] originalRecords);
public static native int nativeMessageSessionCurrent();
public static native int nativeCloseMessageSession();

 public static native int nativeAbiVersion();
 public static native int nativeOpen();
 public static native int nativeStatus();
 public static native int nativeClose();
 public static native int nativeReleaseNoEffectForThreadExit();
 /** Companion ABI for YNXM framing; check for 1 before message operations. */
 public static native int nativeMessageAbiVersion();
 /** 1 only for native before-key-effect original journal acknowledgement. */
 public static native int nativeLocalGenesisBindingAbiVersion();
 /** Process-local selector only. Negative values are native refusal codes. */
 public static native long nativeAcquireMessageOperation();
 /** Advance the SAME operation on its original worker. 30 is held, not done. */
 public static native int nativeAdvanceMessage(long selector);
 /** Both ingress methods require a complete VeilMessageFrame, not raw bytes.
  * A selector/frame never supplies authenticated route or device authority.
  */
 public static native int nativePrepareSend(long selector, byte[] frame);
 public static native int nativePrepareReceive(long selector, byte[] frame);
 /** Native public DATA builder, never a Source/session authorization. */
 public static native byte[] nativeInitialSessionFrame(byte[] logical, byte[] canonicalBundle);
 /** Low-level same-owner preparation; normal flow uses atomic begin below. */
 public static native int nativePrepareInitialSession(long selector, byte[] frame, byte[] canonicalBundle);
 /** Normal same-epoch/source begin+submit once. Positive selector is NOT commit. */
 public static native long nativeBeginInitialSessionProduct(long epoch, byte[] frame, byte[] canonicalBundle);
 /** Public DATA only; actual own records/purpose are verified by Native. */
 public static native byte[] nativeInitialSessionReceiveFrame(byte[] logical, byte[] preKeyWire, byte[] canonicalPublishedOwnBundle);
 /** Separate receive-kind5 original, begin+submit once; selector is not commit. */
 public static native long nativeBeginInitialSessionReceiveProduct(long epoch, byte[] frame);
}

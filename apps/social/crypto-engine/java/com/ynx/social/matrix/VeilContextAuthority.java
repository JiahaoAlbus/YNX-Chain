package com.ynx.social.matrix;

import java.util.Arrays;
import kotlin.Unit;
import org.signal.libsignal.protocol.IdentityKey;
import org.signal.libsignal.protocol.SignalProtocolAddress;

/** Native producer port only. No real implementation/enrollment is supplied here. */
final class VeilContextAuthority {
  interface IndependentVerifier {
    // Must independently verify current device admission, stable route, generations,
    // negotiated epoch and reviewed SDK/JNI provenance. Never copy request metadata.
    Grant verify(VeilRecordTransaction transaction, String suppliedRouteHandle);
  }
  interface CommitGuardPort { void guardCommit(Runnable guard); }
  static final class Grant {
    final VeilApplicationContext context;
    final Runnable recheck;
    // Native verifier result, not evidence by construction. QA grants are synthetic.
    Grant(VeilApplicationContext context, Runnable recheck) { this.context = context.copy(); this.recheck = recheck; }
  }
  private final IndependentVerifier verifier;
  VeilContextAuthority(IndependentVerifier verifier) { this.verifier = verifier; }
  static VeilContextAuthority unavailable() { return new VeilContextAuthority(null); }
  Grant resolve(VeilRecordTransaction tx, String handle, IdentityKey own,
      SignalProtocolAddress local, SignalProtocolAddress peer) {
    tx.checkLive();
    if (verifier == null) throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    Grant supplied = verifier.verify(tx, handle);
    if (supplied == null || supplied.recheck == null) throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    Grant grant = new Grant(supplied.context, supplied.recheck);
    VeilApplicationContext context = grant.context;
    if (!context.local.name.equals(local.getName()) || context.local.device != local.getDeviceId() ||
        !context.peer.name.equals(peer.getName()) || context.peer.device != peer.getDeviceId() ||
        !Arrays.equals(context.local.identity(), own.serialize())) throw VeilAuthenticatedEnvelope.fail("VEIL_AUTHENTICATED_CONTEXT_MISMATCH");
    VeilSignalOutbox.requireLocalAddress(tx, local);
    VeilSignalProtocolStore store = new VeilSignalProtocolStore(tx, own);
    store.getIdentityKeyPair();
    IdentityKey pin = store.getIdentity(peer);
    if (pin == null || !Arrays.equals(pin.serialize(), context.peer.identity()))
      throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    // Independent recheck must work after record handles freeze: no new private IO.
    Runnable check = () -> { grant.recheck.run(); };
    if (tx instanceof VeilNativeTransaction nativeTx) nativeTx.guardCommit(() -> { check.run(); return Unit.INSTANCE; });
    else if (tx instanceof CommitGuardPort guarded) guarded.guardCommit(check);
    else throw VeilAuthenticatedEnvelope.fail("VEIL_APPLICATION_CONTEXT_UNAVAILABLE");
    grant.recheck.run(); tx.checkLive(); return grant;
  }
}

package com.ynx.social.matrix;

import java.util.Arrays;

/** Immutable data only; admission comes from the independent native verifier, not this type. */
final class VeilApplicationContext {
  static final String SUITE = "signal-session-0.104.0";
  final String route;
  final Device local, peer;
  // Unsigned uint64 bits: nonzero, no floating conversion or signed reinterpretation.
  final long epoch;
  VeilApplicationContext(String route, Device local, Device peer, long epoch) {
    this.route = route;
    this.local = local.copy(); this.peer = peer.copy(); this.epoch = epoch;
    VeilAuthenticatedEnvelope.validateContext(this);
  }
  VeilApplicationContext copy() { return new VeilApplicationContext(route, local, peer, epoch); }
  static final class Device {
    final String name;
    final int device;
    private final byte[] identity;
    final long generation;
    Device(String name, int device, byte[] identity, long generation) {
      this.name = name; this.device = device; this.identity = identity.clone(); this.generation = generation;
    }
    byte[] identity() { return identity.clone(); }
    Device copy() { return new Device(name, device, identity, generation); }
    boolean same(Device other) { return name.equals(other.name) && device == other.device &&
        generation == other.generation && Arrays.equals(identity, other.identity); }
  }
}

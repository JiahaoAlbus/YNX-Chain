package com.ynx.social.matrix;

import java.util.Objects;
import org.signal.libsignal.protocol.SignalProtocolAddress;

/** Encoding validation BEFORE SDK/JNI construction; not a device trust proof. */
final class VeilSignalAddress {
  private final SignalProtocolAddress address;
  private VeilSignalAddress(SignalProtocolAddress address) { this.address = address; }
  static VeilSignalAddress of(String originalName, int device) {
    Objects.requireNonNull(originalName);
    VeilContextEncoding.validate(originalName);
    if (device < 1 || device > 127) throw new IllegalArgumentException("VEIL_ADDRESS_DEVICE_UNSUPPORTED");
    SignalProtocolAddress address = new SignalProtocolAddress(originalName, device);
    if (!originalName.equals(address.getName()) ||
        !address.toString().equals(originalName + "." + device)) {
      throw new IllegalArgumentException("VEIL_ADDRESS_ENCODING_MISMATCH");
    }
    return new VeilSignalAddress(address);
  }
  SignalProtocolAddress sdk() { return address; }
}

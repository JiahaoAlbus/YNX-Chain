package kernel

// PrepareOriginalSourceSigningInputDATA forwards to the sole original Source
// framing implementation. It neither canonicalizes body nor signs/adopts it.
// A successful result is public DATA, never Source or role authority.
func PrepareOriginalSourceSigningInputDATA(role string, bodyOriginal []byte) ([]byte, error) {
	return sourceSigningInput(role, bodyOriginal)
}

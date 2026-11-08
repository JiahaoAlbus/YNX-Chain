package native

import "time"

// ServerIdentity is copied PUBLIC DATA from one held server Context. Its DER,
// hashes, names, validity and configured profile are not a Root, Source, target
// pin, issuer or proof of a peer handshake. Callers may construct this DATA;
// normal owners must independently compare the actual original qualification.
// Returned slices and names have no shared caller-mutable/native storage.
// NotBefore/NotAfter bound the configured local certificate chain, including
// the root selected by its existing verification store. They do not extend it.
type ServerIdentity struct {
	CertificateDER, SPKIDER        []byte
	CertificateSHA256, SPKISHA256  string
	DNSNames                       []string
	NotBefore, NotAfter            time.Time
	RuntimeVersion                 string
	Protocol, Group, Cipher        string
	Signature                      string
	ServerAuth, Mutual, TicketsOff bool
}

// ServerContextFDCleanupError preserves an ambiguous close of OWNED duplicate
// descriptors. CloseUnknown bits 1/2 identify the C helper's certificate/key
// duplicates and bit 4 identifies the public CA duplicate. An absent numeric
// descriptor is -1. These values must not be closed again: the OS may already
// have reused them. The original Auth/native owner must retain its original
// borrow/debt; this error never acknowledges successful physical cleanup.
type ServerContextFDCleanupError struct {
	CertificateFD, PrivateKeyFD, CAFD int
	CloseUnknown                      uint32
	Cause                             error
}

func (*ServerContextFDCleanupError) Error() string {
	return "securelink: owned server credential duplicate close unknown; retain original borrow"
}

func (e *ServerContextFDCleanupError) Unwrap() error { return e.Cause }

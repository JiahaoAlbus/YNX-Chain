// Package native supplies the actual OpenSSL TLS endpoint used by securelink.
// No HTTP field or caller-supplied TLS snapshot can create an authenticated Conn.
package native

import (
	"errors"
	"sync/atomic"
	"time"
)

var ErrUnavailable = errors.New("securelink: native PQ TLS runtime unavailable (requires securelink_openssl, cgo, OpenSSL 3.6.4)")

// ConnectionID identifies one native TLS endpoint for this process lifetime.
// The zero value is invalid. Its private field prevents caller-created IDs;
// copied Conn handles retain the same ID, including after they close.
type ConnectionID struct{ value uint64 }

var connectionSequence atomic.Uint64

func newConnectionID() (ConnectionID, error) {
	for {
		previous := connectionSequence.Load()
		if previous == ^uint64(0) {
			return ConnectionID{}, errors.New("securelink: native connection ID space exhausted")
		}
		if connectionSequence.CompareAndSwap(previous, previous+1) {
			return ConnectionID{value: previous + 1}, nil
		}
	}
}

type Config struct {
	CertFile string
	KeyFile  string
	CAFile   string
	PeerSAN  string
	Server   bool
}

// State is a diagnostic snapshot, never an authentication capability. Consumers
// must obtain it directly from a live *Conn, rather than accept a supplied State.
// NotAfter is the earliest expiry of the verified peer chain, local leaf and
// configured local chain, allowing live calls to enforce expiry.
type State struct {
	Protocol, Group, Cipher, PeerSAN, LocalSAN string
	PeerFingerprint, RootFingerprint           string
	PeerEKU, LocalEKU, PeerSignature           string
	RuntimeVersion                             string
	NotAfter                                   time.Time
	Verified, Mutual, Resumed                  bool
	AllChainMLDSA87                            bool
}

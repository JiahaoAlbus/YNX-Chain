package ynxauth

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const MaxWalletPolicyProjectionBytes = 8 << 20
const MaxWalletPolicyProjectionRecords = 1024

// WalletPolicyProjection is the existing owner-scoped HTTP representation.
// It preserves every ledger integer as decimal text and each complete public
// key as lowercase hex. It is public DATA, never an authorization source.
type WalletPolicyProjection struct {
	Version     string                             `json:"version"`
	NetworkID   string                             `json:"networkId"`
	EnableAt    uint64                             `json:"enableAt,string"`
	Records     []WalletPolicyRecordProjection     `json:"records"`
	Revocations []WalletPolicyRevocationProjection `json:"revocations,omitempty"`
}

type WalletPolicyRecordProjection struct {
	AlgorithmVersion string `json:"algorithmVersion"`
	Owner            string `json:"owner"`
	PKA              string `json:"pkA"`
	PKB              string `json:"pkB"`
	Revision         uint64 `json:"revision,string"`
	RegisteredAt     uint64 `json:"registeredAt,string"`
	ActiveFrom       uint64 `json:"activeFrom,string"`
	LedgerNonce      uint64 `json:"ledgerNonce,string"`
}

type WalletPolicyRevocationProjection struct {
	Owner               string `json:"owner"`
	AuthorizingRevision uint64 `json:"authorizingRevision,string"`
	ThroughRevision     uint64 `json:"throughRevision,string"`
	RegisteredAt        uint64 `json:"registeredAt,string"`
	RevokedFrom         uint64 `json:"revokedFrom,string"`
	LedgerNonce         uint64 `json:"ledgerNonce,string"`
}

func walletPolicyHex(s string, size int) ([]byte, error) {
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != size || hex.EncodeToString(b) != s {
		return nil, errors.New("noncanonical wallet policy hex")
	}
	return b, nil
}

func validateWalletPolicyOwner(s State, owner string) error {
	if !accountaddress.IsCanonical(owner) || len(s.NetworkID) != 32 || len(s.Records) > MaxWalletPolicyProjectionRecords || len(s.Revocations) > 1 {
		return errors.New("invalid bounded wallet policy owner projection")
	}
	if err := s.Validate(s.NetworkID); err != nil {
		return err
	}
	for _, r := range s.Records {
		if r.Owner != owner {
			return errors.New("wallet policy contains another owner")
		}
	}
	for _, r := range s.Revocations {
		if r.Owner != owner {
			return errors.New("wallet revocation contains another owner")
		}
	}
	return nil
}

func EncodeWalletPolicyProjection(s State, expectedOwner string) ([]byte, error) {
	if err := validateWalletPolicyOwner(s, expectedOwner); err != nil {
		return nil, err
	}
	p := WalletPolicyProjection{Version: s.Version, NetworkID: hex.EncodeToString(s.NetworkID), EnableAt: s.EnableAt, Records: []WalletPolicyRecordProjection{}}
	for _, r := range s.Records {
		p.Records = append(p.Records, WalletPolicyRecordProjection{r.AlgorithmVersion, r.Owner, hex.EncodeToString(r.PKA), hex.EncodeToString(r.PKB), r.Revision, r.RegisteredAt, r.ActiveFrom, r.LedgerNonce})
	}
	for _, r := range s.Revocations {
		p.Revocations = append(p.Revocations, WalletPolicyRevocationProjection{r.Owner, r.AuthorizingRevision, r.ThroughRevision, r.RegisteredAt, r.RevokedFrom, r.LedgerNonce})
	}
	raw, err := json.Marshal(p)
	if err != nil || len(raw) == 0 || len(raw) > MaxWalletPolicyProjectionBytes {
		return nil, errors.New("wallet policy projection exceeds bound")
	}
	return raw, nil
}

// DecodeWalletPolicyProjection consumes the exact policy object emitted by
// PQWalletAccountView. The expected network/owner must be chosen independently
// by the original caller. This check does not authenticate the HTTP source,
// grant signing approval, or install the projection as global ledger state.
func DecodeWalletPolicyProjection(raw, expectedNetwork []byte, expectedOwner string) (State, error) {
	var s State
	if len(raw) == 0 || len(raw) > MaxWalletPolicyProjectionBytes || len(expectedNetwork) != 32 {
		return s, errors.New("invalid bounded wallet policy projection")
	}
	var p WalletPolicyProjection
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&p) != nil || d.Decode(&struct{}{}) != io.EOF {
		return s, errors.New("invalid wallet policy projection JSON")
	}
	network, err := walletPolicyHex(p.NetworkID, 32)
	if err != nil || !bytes.Equal(network, expectedNetwork) || len(p.Records) > MaxWalletPolicyProjectionRecords || len(p.Revocations) > 1 {
		return s, errors.New("wallet policy network or record bound mismatch")
	}
	s = State{Version: p.Version, NetworkID: network, EnableAt: p.EnableAt, Records: []Record{}}
	for _, r := range p.Records {
		a, aerr := walletPolicyHex(r.PKA, 2592)
		b, berr := walletPolicyHex(r.PKB, 64)
		if aerr != nil || berr != nil {
			return State{}, errors.New("invalid full wallet policy public keys")
		}
		s.Records = append(s.Records, Record{AlgorithmVersion: r.AlgorithmVersion, Owner: r.Owner, PKA: a, PKB: b, Revision: r.Revision, RegisteredAt: r.RegisteredAt, ActiveFrom: r.ActiveFrom, LedgerNonce: r.LedgerNonce})
	}
	for _, r := range p.Revocations {
		s.Revocations = append(s.Revocations, RevocationRecord{Owner: r.Owner, AuthorizingRevision: r.AuthorizingRevision, ThroughRevision: r.ThroughRevision, RegisteredAt: r.RegisteredAt, RevokedFrom: r.RevokedFrom, LedgerNonce: r.LedgerNonce})
	}
	canonical, err := EncodeWalletPolicyProjection(s, expectedOwner)
	if err != nil || !bytes.Equal(canonical, raw) {
		return State{}, errors.New("noncanonical or mismatched wallet policy projection")
	}
	return s, nil
}

package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const (
	PQWalletAuthorizationPath = "/pq-wallet/authorization/"
	PQWalletHistoryPath       = "/pq-wallet/history/"
	MaxPQWalletQueryBytes     = 8 << 20
	MaxPQWalletPolicyRecords  = 1024
)

// PQWalletAccountView is a complete OWNER projection from one committed state.
// Policy must never be installed as the global ledger: an unaffected owner has
// a v1 projection even when GlobalPolicyVersion is v2. No mempool/pending state
// or light-client proof is represented by this configured Comet RPC observation.
type PQWalletAccountView struct {
	Source                       string         `json:"source"`
	RecordsView                  string         `json:"recordsView"`
	PolicyView                   string         `json:"policyView"`
	RecordsComplete              bool           `json:"recordsComplete"`
	Owner                        string         `json:"owner"`
	NativeChainID                int64          `json:"nativeChainId,string"`
	NetworkID                    string         `json:"networkId"`
	CommittedHeight              int64          `json:"committedHeight,string"`
	CommittedAppHash             string         `json:"committedAppHash"`
	ExecutionHeight              uint64         `json:"executionHeight,string"`
	LedgerNonce                  uint64         `json:"ledgerNonce,string"`
	Enabled                      bool           `json:"enabled"`
	GlobalPolicyVersion          string         `json:"globalPolicyVersion,omitempty"`
	Policy                       *ynxauth.State `json:"policy"`
	AuthorizationStatus          string         `json:"authorizationStatus"`
	PQSigningEnabled             bool           `json:"pqSigningEnabled"`
	CommittedAuthorizationStatus string         `json:"committedAuthorizationStatus"`
	CommittedPQSigningEnabled    bool           `json:"committedPQSigningEnabled"`
}

// PQWalletHistoryView retains native wire identity separately from its actual
// Comet envelope identity. Source-import entries have no invented ABCI hash or
// index. The gateway obtains a real index from Comet /tx for ABCI entries.
type PQWalletHistoryView struct {
	Source              string              `json:"source"`
	Authorization       PQWalletAccountView `json:"authorization"`
	ABCITransactionHash string              `json:"abciTransactionHash,omitempty"`
	ExecutionHeight     uint64              `json:"executionHeight,string"`
	Transaction         chain.Transaction   `json:"transaction"`
}

// JSON is a Wallet projection, not State's persistence encoding. All policy
// integers are decimal strings so JSON.parse cannot round a uint64. Full public
// keys and the original genesis identity use canonical lowercase hexadecimal.
type pqWalletPolicyJSON struct {
	Version     string                   `json:"version"`
	NetworkID   string                   `json:"networkId"`
	EnableAt    uint64                   `json:"enableAt,string"`
	Records     []pqWalletRecordJSON     `json:"records"`
	Revocations []pqWalletRevocationJSON `json:"revocations,omitempty"`
}
type pqWalletRecordJSON struct {
	AlgorithmVersion string `json:"algorithmVersion"`
	Owner            string `json:"owner"`
	PKA              string `json:"pkA"`
	PKB              string `json:"pkB"`
	Revision         uint64 `json:"revision,string"`
	RegisteredAt     uint64 `json:"registeredAt,string"`
	ActiveFrom       uint64 `json:"activeFrom,string"`
	LedgerNonce      uint64 `json:"ledgerNonce,string"`
}
type pqWalletRevocationJSON struct {
	Owner               string `json:"owner"`
	AuthorizingRevision uint64 `json:"authorizingRevision,string"`
	ThroughRevision     uint64 `json:"throughRevision,string"`
	RegisteredAt        uint64 `json:"registeredAt,string"`
	RevokedFrom         uint64 `json:"revokedFrom,string"`
	LedgerNonce         uint64 `json:"ledgerNonce,string"`
}
type pqWalletAccountAlias PQWalletAccountView
type pqWalletAccountJSON struct {
	*pqWalletAccountAlias
	Policy *pqWalletPolicyJSON `json:"policy"`
}

func (v PQWalletAccountView) MarshalJSON() ([]byte, error) {
	out := pqWalletAccountJSON{pqWalletAccountAlias: (*pqWalletAccountAlias)(&v)}
	if p := v.Policy; p != nil {
		out.Policy = &pqWalletPolicyJSON{Version: p.Version, NetworkID: hex.EncodeToString(p.NetworkID), EnableAt: p.EnableAt, Records: []pqWalletRecordJSON{}}
		for _, r := range p.Records {
			out.Policy.Records = append(out.Policy.Records, pqWalletRecordJSON{r.AlgorithmVersion, r.Owner, hex.EncodeToString(r.PKA), hex.EncodeToString(r.PKB), r.Revision, r.RegisteredAt, r.ActiveFrom, r.LedgerNonce})
		}
		for _, r := range p.Revocations {
			out.Policy.Revocations = append(out.Policy.Revocations, pqWalletRevocationJSON{r.Owner, r.AuthorizingRevision, r.ThroughRevision, r.RegisteredAt, r.RevokedFrom, r.LedgerNonce})
		}
	}
	return json.Marshal(out)
}

func (v *PQWalletAccountView) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || len(data) > MaxPQWalletQueryBytes {
		return errors.New("invalid bounded PQ Wallet account JSON")
	}
	var value PQWalletAccountView
	out := pqWalletAccountJSON{pqWalletAccountAlias: (*pqWalletAccountAlias)(&value)}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(&out); err != nil {
		return err
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return errors.New("trailing PQ Wallet account JSON")
	}
	if p := out.Policy; p != nil {
		if !walletHex(p.NetworkID, 32, false) || len(p.Records) > MaxPQWalletPolicyRecords || len(p.Revocations) > 1 {
			return errors.New("invalid PQ Wallet policy JSON shape")
		}
		network, _ := hex.DecodeString(p.NetworkID)
		value.Policy = &ynxauth.State{Version: p.Version, NetworkID: network, EnableAt: p.EnableAt, Records: []ynxauth.Record{}}
		for _, r := range p.Records {
			if !walletHex(r.PKA, 2592, false) || !walletHex(r.PKB, 64, false) {
				return errors.New("invalid full PQ Wallet public keys")
			}
			a, _ := hex.DecodeString(r.PKA)
			b, _ := hex.DecodeString(r.PKB)
			value.Policy.Records = append(value.Policy.Records, ynxauth.Record{AlgorithmVersion: r.AlgorithmVersion, Owner: r.Owner, PKA: a, PKB: b, Revision: r.Revision, RegisteredAt: r.RegisteredAt, ActiveFrom: r.ActiveFrom, LedgerNonce: r.LedgerNonce})
		}
		for _, r := range p.Revocations {
			value.Policy.Revocations = append(value.Policy.Revocations, ynxauth.RevocationRecord{Owner: r.Owner, AuthorizingRevision: r.AuthorizingRevision, ThroughRevision: r.ThroughRevision, RegisteredAt: r.RegisteredAt, RevokedFrom: r.RevokedFrom, LedgerNonce: r.LedgerNonce})
		}
	}
	canonical, err := json.Marshal(value)
	if err != nil || !bytes.Equal(canonical, data) {
		return errors.New("noncanonical PQ Wallet account JSON")
	}
	*v = value
	return nil
}

func walletHex(value string, size int, prefix bool) bool {
	if prefix {
		if !strings.HasPrefix(value, "0x") {
			return false
		}
		value = value[2:]
	}
	b, err := hex.DecodeString(value)
	return err == nil && len(b) == size && hex.EncodeToString(b) == value
}

func walletPolicyStatus(policy *ynxauth.State, owner string, height uint64) (string, bool) {
	if policy == nil {
		return "legacy", false
	}
	status := "legacy"
	for _, r := range policy.Records {
		if r.Owner == owner && r.RegisteredAt <= height {
			status = "pending_activation"
		}
	}
	if _, active := policy.PolicyAt(owner, height); active {
		status = "active"
	}
	for _, r := range policy.Revocations {
		if r.Owner == owner && r.RegisteredAt <= height {
			status = "revocation_pending"
			if height >= r.RevokedFrom {
				status = "revoked"
			}
		}
	}
	_, err := policy.TrustedRegistration(owner, ynxauth.TransactionPurpose, height)
	return status, err == nil
}

// ValidatePQWalletAccountView validates the complete bounded projection; it
// cannot authenticate an RPC server or turn its self-reported AppHash into a
// trusted checkpoint. Gateways additionally bind ABCI response.Height.
func ValidatePQWalletAccountView(v PQWalletAccountView, owner string) error {
	if !accountaddress.IsCanonical(owner) || v.Owner != owner || v.Source != "comet-rpc" || v.RecordsView != "committed" || v.PolicyView != "next_execution" || !v.RecordsComplete || v.NativeChainID <= 0 || !walletHex(v.NetworkID, 32, false) || !walletHex(v.CommittedAppHash, 32, false) || v.CommittedHeight < 0 || v.CommittedHeight == math.MaxInt64 || v.ExecutionHeight != uint64(v.CommittedHeight)+1 {
		return errors.New("invalid committed PQ Wallet account view")
	}
	if v.Policy == nil {
		if v.Enabled || v.GlobalPolicyVersion != "" {
			return errors.New("disabled PQ Wallet view contains policy authority")
		}
	} else {
		network, _ := hex.DecodeString(v.NetworkID)
		if !v.Enabled || (v.GlobalPolicyVersion != ynxauth.PolicyVersion && v.GlobalPolicyVersion != ynxauth.PolicyRevocationVersion) || v.Policy.Validate(network) != nil || v.Policy.Version == "" || len(v.Policy.Records) > MaxPQWalletPolicyRecords || len(v.Policy.Revocations) > 1 || (v.GlobalPolicyVersion == ynxauth.PolicyVersion && v.Policy.Version != ynxauth.PolicyVersion) || (len(v.Policy.Revocations) == 0 && v.Policy.Version != ynxauth.PolicyVersion) {
			return errors.New("invalid PQ Wallet owner policy projection")
		}
		for _, r := range v.Policy.Records {
			if r.Owner != owner || r.RegisteredAt > uint64(v.CommittedHeight) || r.LedgerNonce > v.LedgerNonce {
				return errors.New("PQ Wallet registration is not in this committed account")
			}
		}
		for _, r := range v.Policy.Revocations {
			if r.Owner != owner || r.RegisteredAt > uint64(v.CommittedHeight) || r.LedgerNonce > v.LedgerNonce {
				return errors.New("PQ Wallet revocation is not in this committed account")
			}
		}
	}
	next, nextEnabled := walletPolicyStatus(v.Policy, owner, v.ExecutionHeight)
	current, currentEnabled := walletPolicyStatus(v.Policy, owner, uint64(v.CommittedHeight))
	if v.AuthorizationStatus != next || v.PQSigningEnabled != nextEnabled || v.CommittedAuthorizationStatus != current || v.CommittedPQSigningEnabled != currentEnabled {
		return errors.New("PQ Wallet status disagrees with complete history")
	}
	return nil
}

func pqWalletAccountView(s CommittedState, migration chain.ConsensusMigrationState, owner string) (PQWalletAccountView, error) {
	v := PQWalletAccountView{Source: "comet-rpc", RecordsView: "committed", PolicyView: "next_execution", RecordsComplete: true, Owner: owner, NativeChainID: s.ChainID, NetworkID: migration.OriginalGenesisHash, CommittedHeight: s.Height, CommittedAppHash: s.AppHash}
	if s.Height < 0 || s.Height == math.MaxInt64 {
		return v, errors.New("PQ Wallet next execution height is unavailable")
	}
	v.ExecutionHeight = uint64(s.Height) + 1
	if i, exists := accountIndex(s.Accounts, owner); exists {
		v.LedgerNonce = s.Accounts[i].Nonce
	}
	if s.AccountPolicy != nil {
		network, err := hex.DecodeString(migration.OriginalGenesisHash)
		if err != nil || s.AccountPolicy.Validate(network) != nil || s.AccountPolicy.Version == "" {
			return v, errors.New("invalid committed PQ account policy")
		}
		v.Enabled, v.GlobalPolicyVersion = true, s.AccountPolicy.Version
		p := &ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: bytes.Clone(s.AccountPolicy.NetworkID), EnableAt: s.AccountPolicy.EnableAt, Records: []ynxauth.Record{}}
		for _, r := range s.AccountPolicy.Records {
			if r.Owner == owner {
				r.PKA, r.PKB = bytes.Clone(r.PKA), bytes.Clone(r.PKB)
				p.Records = append(p.Records, r)
			}
		}
		for _, r := range s.AccountPolicy.Revocations {
			if r.Owner == owner {
				p.Revocations = append(p.Revocations, r)
				p.Version = ynxauth.PolicyRevocationVersion
			}
		}
		v.Policy = p
	}
	v.AuthorizationStatus, v.PQSigningEnabled = walletPolicyStatus(v.Policy, owner, v.ExecutionHeight)
	v.CommittedAuthorizationStatus, v.CommittedPQSigningEnabled = walletPolicyStatus(v.Policy, owner, uint64(s.Height))
	return v, ValidatePQWalletAccountView(v, owner)
}

func pqWalletOriginalEnvelope(tx chain.Transaction) ([]byte, []byte, error) {
	kind, prefix := PQTransferType, pqTransferMemo
	switch tx.Type {
	case "transfer":
	case PQMigrationType:
		kind, prefix = PQMigrationType, pqMigrationMemo
	case PQRevocationType:
		kind, prefix = PQRevocationType, pqRevocationMemo
	default:
		return nil, nil, errors.New("not a supported original PQ authorization")
	}
	if !strings.HasPrefix(tx.Memo, prefix) || len(tx.Memo) > len(prefix)+2*ynxauth.MaxMigrationBytes {
		return nil, nil, errors.New("PQ history has no original bounded wire")
	}
	wire, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, prefix))
	if err != nil || prefix+hex.EncodeToString(wire) != tx.Memo || SignedTransactionHash(wire) != tx.Hash {
		return nil, nil, errors.New("PQ original wire hash mismatch")
	}
	payload, err := EncodePQTransaction(kind, wire)
	return wire, payload, err
}

func pqWalletHistoryView(s CommittedState, migration chain.ConsensusMigrationState, hash string) (PQWalletHistoryView, error) {
	var v PQWalletHistoryView
	if !walletHex(hash, 32, true) {
		return v, errors.New("canonical original PQ wire hash is required")
	}
	found := false
	for _, entry := range s.PQHistory {
		if entry.Transaction.Hash == hash {
			if found {
				return v, errors.New("duplicate PQ original history")
			}
			found = true
			v.Source, v.Transaction, v.ABCITransactionHash = "comet-rpc", entry.Transaction, entry.ABCITransactionHash
		}
	}
	if tx, exists := sourceHistoryTransaction(migration, hash); exists {
		if found {
			return v, errors.New("PQ original appears in both source and Comet history")
		}
		found = true
		v.Source, v.Transaction = "source_import", tx
	}
	if !found {
		return v, errors.New("PQ original transaction not found")
	}
	tx := v.Transaction
	_, payload, err := pqWalletOriginalEnvelope(tx)
	if err != nil {
		return v, err
	}
	if tx.BlockNum == 0 || s.Height < 0 || tx.BlockNum > uint64(s.Height) || v.Source == "source_import" && tx.BlockNum > migration.Height || v.Source == "comet-rpc" && (tx.BlockNum <= migration.Height || v.ABCITransactionHash != SignedTransactionHash(payload)) {
		return v, errors.New("PQ original execution provenance mismatch")
	}
	if err := chain.ValidateConsensusHistoricalPQTransaction(tx, s.AccountPolicy, tx.BlockNum, s.ChainID); err != nil {
		return v, err
	}
	v.ExecutionHeight = tx.BlockNum
	v.Authorization, err = pqWalletAccountView(s, migration, tx.From)
	return v, err
}

// Called only under Application.Query's existing RLock. Reject unsupported
// historical/proof requests rather than returning latest data under an old H.
func queryPQWallet(response *abcitypes.ResponseQuery, req *abcitypes.RequestQuery, s CommittedState, migration chain.ConsensusMigrationState) bool {
	account := strings.HasPrefix(req.Path, PQWalletAuthorizationPath)
	if !account && !strings.HasPrefix(req.Path, PQWalletHistoryPath) {
		return false
	}
	fail := func(err error) { response.Code, response.Log, response.Value = 1, err.Error(), nil }
	if req.Prove || len(req.Data) != 0 || req.Height < 0 || req.Height != 0 && req.Height != s.Height {
		fail(errors.New("PQ Wallet query supports current committed height only, without proof or data"))
		return true
	}
	var value any
	var err error
	if account {
		value, err = pqWalletAccountView(s, migration, strings.TrimPrefix(req.Path, PQWalletAuthorizationPath))
	} else {
		value, err = pqWalletHistoryView(s, migration, strings.TrimPrefix(req.Path, PQWalletHistoryPath))
	}
	if err != nil {
		fail(err)
		return true
	}
	response.Value, err = json.Marshal(value)
	if err != nil || len(response.Value) > MaxPQWalletQueryBytes {
		fail(errors.New("PQ Wallet response exceeds bounded complete query"))
	}
	return true
}

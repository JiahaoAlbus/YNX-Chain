package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	initialABIVersion      = 1
	initialMemberCapacity  = 98304
	initialMessageMaximum  = 4096 // existing RegistrationIntent E15 decoder
	initialGenesisMaximum  = 64 << 20
	initialAccountsMaximum = 8 << 20
	initialAccountsCount   = 1024
	initialAccountsVersion = "YNX-PQ-INITIAL-ACCOUNTS/v1"
	initialMemberMaximum   = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + initialMessageMaximum + 28
)

type initialExpected struct {
	GenesisSHA256, NetworkID []byte
	Owner                    string
	NativeChainID            uint64
	ExecutionHeight          string
	PKA, PKB                 []byte
}

type initialInputs struct {
	message, genesis []byte
	expected         initialExpected
}

type initialPlan struct {
	message  []byte
	expected initialExpected
	height   uint64
	trusted  ynxbatch.Registration
}

// This is the existing public pq_initial_accounts configuration, not a second
// address derivation or a self-signed registration source. Full Genesis bytes
// and their independently selected SHA are still Main/Auth's responsibility.
type initialGenesisBinding struct {
	Owner           string                         `json:"owner"`
	PKA             string                         `json:"pkA"`
	PKB             string                         `json:"pkB"`
	PreparedFunding *initialGenesisPreparedFunding `json:"preparedFunding,omitempty"`
}

// Public source preparation DATA only. Complete migration/last-block Faucet
// receipt/lot/occupancy checks belong to the independently pinned bootstrap.
// Native checks this exact optional shape and syntax, never a balance or grant.
type initialGenesisPreparedFunding struct {
	SourceStateHash string `json:"sourceStateHash"`
	FaucetHash      string `json:"faucetHash"`
}

type initialGenesisConfiguration struct {
	Version   string                  `json:"version"`
	NetworkID string                  `json:"networkId"`
	EnableAt  string                  `json:"enableAt"`
	BirthFee  string                  `json:"birthFee"`
	Accounts  []initialGenesisBinding `json:"accounts"`
}

// Check all original JSON objects before projection. Token numbers remain
// json.Number, including unrelated original app_state uint64s. The depth bound
// is only a bounded public ABI parser budget; no consensus limit is changed.
func initialUniqueJSONValue(d *json.Decoder, depth int) error {
	if depth > 128 {
		return errors.New("Genesis JSON depth exceeds ABI read budget")
	}
	token, err := d.Token()
	if err != nil {
		return err
	}
	delim, container := token.(json.Delim)
	if !container {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			key, err := d.Token()
			name, ok := key.(string)
			if err != nil || !ok || seen[name] {
				return errors.New("duplicate or invalid original Genesis JSON field")
			}
			seen[name] = true
			if err := initialUniqueJSONValue(d, depth+1); err != nil {
				return err
			}
		}
		end, err := d.Token()
		if err != nil || end != json.Delim('}') {
			return errors.New("unclosed Genesis JSON object")
		}
	case '[':
		for d.More() {
			if err := initialUniqueJSONValue(d, depth+1); err != nil {
				return err
			}
		}
		end, err := d.Token()
		if err != nil || end != json.Delim(']') {
			return errors.New("unclosed Genesis JSON array")
		}
	default:
		return errors.New("unexpected Genesis JSON delimiter")
	}
	return nil
}

func initialCanonicalKey(value string, size int) ([]byte, bool) {
	raw, err := hex.DecodeString(value)
	return raw, err == nil && len(raw) == size && hex.EncodeToString(raw) == value && !bytes.Equal(raw, make([]byte, size))
}

func initialGenesisRegistration(raw []byte, expected initialExpected, height uint64) (ynxbatch.Registration, error) {
	fail := func() (ynxbatch.Registration, error) {
		return ynxbatch.Registration{}, errors.New("initial Genesis original binding mismatch")
	}
	digest := sha256.Sum256(raw)
	if !bytes.Equal(digest[:], expected.GenesisSHA256) || !utf8.Valid(raw) {
		return fail()
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if initialUniqueJSONValue(d, 0) != nil || d.Decode(new(any)) != io.EOF {
		return fail()
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return fail()
	}
	var chainID, initialHeight string
	if json.Unmarshal(fields["chain_id"], &chainID) != nil || json.Unmarshal(fields["initial_height"], &initialHeight) != nil || chainID != "ynx_"+strconv.FormatUint(expected.NativeChainID, 10)+"-1" {
		return fail()
	}
	initial, ok := txPositiveDecimal(initialHeight)
	if !ok || initial > math.MaxInt64 || height < initial {
		return fail()
	}
	configurationRaw := fields["pq_initial_accounts"]
	if len(configurationRaw) == 0 || len(configurationRaw) > initialAccountsMaximum {
		return fail()
	}
	var configuration initialGenesisConfiguration
	decoder := json.NewDecoder(bytes.NewReader(configurationRaw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&configuration) != nil || decoder.Decode(new(any)) != io.EOF {
		return fail()
	}
	canonical, err := json.Marshal(configuration)
	var compact bytes.Buffer
	if err != nil || json.Compact(&compact, configurationRaw) != nil || !bytes.Equal(canonical, compact.Bytes()) {
		return fail()
	}
	enable, ok := txPositiveDecimal(configuration.EnableAt)
	if !ok || enable > math.MaxInt64 || height < enable || configuration.Version != initialAccountsVersion || configuration.BirthFee != "0" ||
		configuration.NetworkID != hex.EncodeToString(expected.NetworkID) || len(configuration.Accounts) == 0 || len(configuration.Accounts) > initialAccountsCount {
		return fail()
	}
	previous := ""
	var matched ynxbatch.Registration
	for _, binding := range configuration.Accounts {
		if !accountaddress.IsCanonical(binding.Owner) || binding.Owner <= previous {
			return fail()
		}
		previous = binding.Owner
		a, aok := initialCanonicalKey(binding.PKA, ynxbatch.PublicKeyASize)
		b, bok := initialCanonicalKey(binding.PKB, ynxbatch.PublicKeyBSize)
		if !aok || !bok {
			return fail()
		}
		if funding := binding.PreparedFunding; funding != nil {
			_, sourceOK := initialCanonicalKey(funding.SourceStateHash, 32)
			if expected.NativeChainID != 6423 || !sourceOK || len(funding.FaucetHash) != 66 || !strings.HasPrefix(funding.FaucetHash, "0x") {
				return fail()
			}
			faucet, err := hex.DecodeString(funding.FaucetHash[2:])
			if err != nil || len(faucet) != 32 || hex.EncodeToString(faucet) != funding.FaucetHash[2:] {
				return fail()
			}
		}
		if binding.Owner == expected.Owner {
			if !bytes.Equal(a, expected.PKA) || !bytes.Equal(b, expected.PKB) {
				return fail()
			}
			matched = ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, ChainID: bytes.Clone(expected.NetworkID), Owner: expected.Owner,
				Purpose: ynxauth.TransactionPurpose, PolicyRevision: "GENESIS:" + hex.EncodeToString(expected.GenesisSHA256), PKA: a, PKB: b, Enabled: true, ActiveFrom: enable}
		}
	}
	if !matched.Enabled {
		return fail()
	}
	return matched, nil
}

func prepareInitial(in initialInputs, capacity uint64) (initialPlan, resultCode) {
	if capacity != initialMemberCapacity {
		return initialPlan{}, resultCapacity
	}
	if len(in.message) == 0 || len(in.message) > initialMessageMaximum || len(in.genesis) == 0 || len(in.genesis) > initialGenesisMaximum {
		return initialPlan{}, resultBounds
	}
	e := in.expected
	height, ok := txPositiveDecimal(e.ExecutionHeight)
	if !ok || height >= math.MaxInt64 || len(e.GenesisSHA256) != 32 || len(e.NetworkID) != 32 || !accountaddress.IsCanonical(e.Owner) || e.NativeChainID == 0 || e.NativeChainID > math.MaxInt64 ||
		len(e.PKA) != ynxbatch.PublicKeyASize || len(e.PKB) != ynxbatch.PublicKeyBSize || initialMemberMaximum > initialMemberCapacity {
		return initialPlan{}, resultPublicBinding
	}
	trusted, err := initialGenesisRegistration(in.genesis, e, height)
	if err != nil {
		return initialPlan{}, resultPublicBinding
	}
	intent, err := ynxauth.DecodeRegistrationIntent(in.message)
	if err != nil {
		return initialPlan{}, resultPublicBinding
	}
	canonical, err := intent.SigningBytes()
	if err != nil || !bytes.Equal(canonical, in.message) || intent.PriorRevision != 0 || intent.NewRevision != 1 || intent.LedgerNonce != 1 || intent.ActivateAt <= height || intent.ActivateAt > math.MaxInt64 ||
		intent.Owner != e.Owner || !bytes.Equal(intent.ChainID, e.NetworkID) || !bytes.Equal(intent.PKA, e.PKA) || !bytes.Equal(intent.PKB, e.PKB) {
		return initialPlan{}, resultPublicBinding
	}
	e.GenesisSHA256 = bytes.Clone(e.GenesisSHA256)
	e.NetworkID = bytes.Clone(e.NetworkID)
	e.PKA = bytes.Clone(e.PKA)
	e.PKB = bytes.Clone(e.PKB)
	return initialPlan{message: bytes.Clone(in.message), expected: e, height: height, trusted: trusted}, resultOK
}

func inspectInitialMember(plan initialPlan, wire []byte) error {
	if len(wire) == 0 || len(wire) > initialMemberMaximum || len(wire) > ynxauth.MaxPQInitialRegistrationBytes {
		return errors.New("initial member bound")
	}
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return err
	}
	if m.Certificate.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || !bytes.Equal(m.Message, plan.message) {
		return errors.New("initial fixed N1 member binding")
	}
	_, err = ynxauth.VerifyPQInitialRegistrationPossession(wire, plan.trusted, plan.height)
	return err
}

func signInitialPrepared(plan initialPlan, borrowed ynxbatch.KeyMaterial) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize || len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var batch *ynxbatch.Batch
	var candidate []byte
	code, cleanup = resultInternal, cleanupUnknown
	defer func() {
		panicked := recover() != nil
		clean := runLogicalCleanup(func() { batch.Discard() }, func() { key.Destroy() }, func() { owned.Clear() })
		output, code, cleanup = finishPublication(candidate, code, panicked, clean)
	}()
	owned.PKCS8A = bytes.Clone(borrowed.PKCS8A)
	owned.PKCS8B = bytes.Clone(borrowed.PKCS8B)
	owned.PKA = bytes.Clone(borrowed.PKA)
	owned.PKB = bytes.Clone(borrowed.PKB)
	if !bytes.Equal(owned.PKA, plan.expected.PKA) || !bytes.Equal(owned.PKB, plan.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	var public ynxbatch.PublicKey
	var err error
	key, public, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil || !bytes.Equal(public.PKA, plan.expected.PKA) || !bytes.Equal(public.PKB, plan.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: plan.expected.NetworkID, Owner: plan.expected.Owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	m, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(m)
	if err != nil || inspectInitialMember(plan, candidate) != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	return candidate, resultOK, cleanupUnknown
}

//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	requestFormat        = "YNX-CONSENSUS-PQ-NEW-EPOCH/v1"
	maxRequestBytes      = 32 << 10
	maxGenesisBytes      = 64 << 20
	maxPublicRecordBytes = 256 << 10
)

// This is independently pinned public operator intent. It is not a committed
// registry or an authority signature. New-key fields must be absent/empty.
type epochRequest struct {
	Format           string                              `json:"format"`
	ChainID          string                              `json:"chainId"`
	ValidatorAddress []byte                              `json:"validatorAddress"`
	Epoch            uint64                              `json:"epoch"`
	ActivationHeight int64                               `json:"activationHeight"`
	Registration     ynxconsensusauth.RegistrationIntent `json:"registration"`
}

type options struct {
	newEpoch, inspect                                     bool
	request, requestHash, genesis, genesisHash, directory string
	credentialFD                                          int
}

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr, realCeremonyIO()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, output, diagnostics io.Writer, disk ceremonyIO) error {
	fs := flag.NewFlagSet("ynx-consensus-pq-key-init", flag.ContinueOnError)
	fs.SetOutput(diagnostics)
	var o options
	fs.BoolVar(&o.newEpoch, "new-epoch", false, "explicitly create a genuinely new validator key epoch; never recovery")
	fs.BoolVar(&o.inspect, "inspect", false, "read only original ceremony files; never generate, repair or reset")
	fs.StringVar(&o.request, "request", "", "canonical public new-epoch request JSON")
	fs.StringVar(&o.requestHash, "request-sha256", "", "independent lowercase SHA256 pin of exact request bytes")
	fs.StringVar(&o.genesis, "genesis", "", "exact original Comet genesis JSON")
	fs.StringVar(&o.genesisHash, "genesis-sha256", "", "independent lowercase SHA256 pin of exact original genesis")
	fs.StringVar(&o.directory, "out-dir", "", "existing canonical absolute private 0700 directory for this new epoch")
	fs.IntVar(&o.credentialFD, "recovery-fd", -1, "inherited descriptor >=3 containing exactly 32 raw credential bytes and EOF")
	if err := fs.Parse(args); err != nil {
		return err
	}
	var credentialFile *os.File
	if o.credentialFD >= 3 {
		credentialFile = os.NewFile(uintptr(o.credentialFD), "pq-new-epoch-credential")
		if credentialFile != nil {
			defer credentialFile.Close()
		}
	}
	if fs.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if o.inspect {
		if o.newEpoch || o.request != "" || o.requestHash != "" || o.genesis != "" || o.genesisHash != "" || o.credentialFD != -1 {
			return errors.New("inspect accepts only out-dir and never consumes a credential")
		}
		report, err := inspectCeremony(o.directory)
		if err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(report)
	}
	if !o.newEpoch || o.request == "" || o.requestHash == "" || o.genesis == "" || o.genesisHash == "" || o.credentialFD < 3 {
		return errors.New("new epoch requires explicit --new-epoch, pinned request and genesis, out-dir and private inherited recovery-fd >=3")
	}
	request, err := readPinnedRequest(o)
	if err != nil {
		return err
	}
	paths, err := newPaths(o.directory)
	if err != nil {
		return err
	}
	if err = paths.requireAbsent(); err != nil {
		return err
	}
	credential, err := readCredential(credentialFile)
	if err != nil {
		return err
	}
	defer clear(credential)
	result, err := createEpoch(request, o, paths, credential, disk)
	if err != nil {
		return err
	}
	if err = json.NewEncoder(output).Encode(result); err != nil {
		return errors.New("new epoch files were written but public result delivery failed; inspect the original out-dir, do not generate again")
	}
	return nil
}

func pinMatches(raw []byte, pin string) bool {
	h := sha256.Sum256(raw)
	return len(pin) == 64 && hex.EncodeToString(h[:]) == pin
}

func decodeCanonical(raw []byte, value any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing public JSON")
	}
	canonical, err := json.Marshal(value)
	if err != nil || !bytes.Equal(raw, canonical) {
		return errors.New("public JSON must match exact canonical encoding; duplicate or unknown fields are forbidden")
	}
	return nil
}

func readPinnedRequest(o options) (epochRequest, error) {
	var request epochRequest
	raw, err := readRegular(o.request, maxRequestBytes)
	if err != nil {
		return request, err
	}
	if !pinMatches(raw, o.requestHash) {
		return request, errors.New("request differs from independent operator pin")
	}
	if err = decodeCanonical(raw, &request); err != nil {
		return request, err
	}
	genesis, err := readRegular(o.genesis, maxGenesisBytes)
	if err != nil {
		return request, err
	}
	if !pinMatches(genesis, o.genesisHash) {
		return request, errors.New("genesis differs from independent operator pin")
	}
	genesisID := sha256.Sum256(genesis)
	i := request.Registration
	if request.Format != requestFormat || request.Epoch == 0 || request.ActivationHeight <= 0 || len(request.ValidatorAddress) != 20 || i.ChainID != request.ChainID || !bytes.Equal(i.GenesisID, genesisID[:]) || !bytes.Equal(i.ValidatorAddress, request.ValidatorAddress) || i.Epoch != request.Epoch || len(i.MLDSA87PublicKey) != 0 || len(i.SLHDSASHA2256fPublicKey) != 0 || (i.Kind != ynxconsensusauth.RegisterValidator && i.Kind != ynxconsensusauth.RotateValidator) {
		return request, errors.New("new-epoch request must bind complete original identity and registration/rotation with empty new-key fields")
	}
	// Check all non-key intent syntax before generating secrets. These temporary
	// fixed-size public placeholders grant no authority and are never signed.
	i.MLDSA87PublicKey = make([]byte, ynxconsensusauth.MLDSA87PublicKeySize)
	i.SLHDSASHA2256fPublicKey = make([]byte, ynxconsensusauth.SLHDSASHA2256fPublicKeySize)
	if err = i.Validate(); err != nil {
		return request, err
	}
	var doc cmttypes.GenesisDoc
	if err = cmtjson.Unmarshal(genesis, &doc); err != nil {
		return request, errors.New("invalid pinned Comet genesis")
	}
	if doc.ChainID != request.ChainID || doc.InitialHeight <= 0 || request.ActivationHeight < doc.InitialHeight || i.ApprovedAt < doc.InitialHeight || doc.GenesisTime.IsZero() || doc.ConsensusParams == nil || len(doc.Validators) == 0 || doc.ConsensusParams.ValidateBasic() != nil {
		return request, errors.New("pinned genesis has incomplete or different chain parameters")
	}
	if len(doc.ConsensusParams.Validator.PubKeyTypes) != 1 || doc.ConsensusParams.Validator.PubKeyTypes[0] != ed25519.KeyType {
		return request, errors.New("new epoch requires the original pinned Ed25519 genesis set")
	}
	found := false
	seen := make(map[string]bool, len(doc.Validators))
	for _, member := range doc.Validators {
		pub, ok := member.PubKey.(ed25519.PubKey)
		if !ok || len(pub) != ed25519.PubKeySize || member.Power <= 0 {
			return request, errors.New("invalid original genesis validator")
		}
		h := sha256.Sum256(pub)
		if !bytes.Equal(member.Address, h[:20]) || seen[string(member.Address)] {
			return request, errors.New("duplicate or mismatched original consensus address")
		}
		seen[string(member.Address)] = true
		if bytes.Equal(member.Address, request.ValidatorAddress) {
			found = true
			if i.Kind == ynxconsensusauth.RegisterValidator && !bytes.Equal(i.LegacyEd25519PublicKey, pub) {
				return request, errors.New("first registration names a different original public authority")
			}
		}
	}
	if !found {
		return request, errors.New("logical validator is absent from independently pinned original genesis")
	}
	return request, nil
}

func readCredential(f *os.File) ([]byte, error) {
	if f == nil {
		return nil, errors.New("missing inherited credential descriptor")
	}
	credential, err := io.ReadAll(io.LimitReader(f, 33))
	if err != nil || len(credential) != 32 {
		clear(credential)
		return nil, errors.New("credential descriptor must contain exactly 32 raw bytes and EOF")
	}
	return credential, nil
}

func newPaths(directory string) (ceremonyPaths, error) {
	var p ceremonyPaths
	if directory == "" || !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return p, errors.New("out-dir must be an existing canonical absolute private directory")
	}
	real, err := filepath.EvalSymlinks(directory)
	if err != nil || real != directory {
		return p, errors.New("out-dir or its parents must not alias another directory")
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return p, errors.New("out-dir must already exist with exact mode 0700")
	}
	return ceremonyPaths{Directory: directory, Marker: filepath.Join(directory, "new-epoch-intent.json"), Vault: filepath.Join(directory, "validator.encrypted"), Binding: filepath.Join(directory, "validator-binding.json"), State: filepath.Join(directory, "original-sign-state.json"), PublicRecord: filepath.Join(directory, "new-epoch-public.json")}, nil
}

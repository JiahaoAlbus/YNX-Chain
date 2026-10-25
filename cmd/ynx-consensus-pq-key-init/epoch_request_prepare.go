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
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

type prepareEpochRequestOptions struct {
	genesis, genesisHash, chainID, address, kind      string
	epoch, sequence, approvedAt, effectiveAt          string
	activationHeight, previousEvent, authorizingEpoch string
	authorityA, authorityB, output                    string
}

type preparedEpochRequestReceipt struct {
	Version                         string `json:"version"`
	Classification                  string `json:"classification"`
	RequestPath                     string `json:"requestPath"`
	RequestSHA256                   string `json:"requestSHA256"`
	RequestBytes                    int    `json:"requestBytes"`
	GenesisSHA256                   string `json:"genesisSHA256"`
	RegistrationAuthorized          bool   `json:"registrationAuthorized"`
	RequestPinIndependentlyApproved bool   `json:"requestPinIndependentlyApproved"`
	KeysGenerated                   bool   `json:"keysGenerated"`
	Signed                          bool   `json:"signed"`
	RuntimeStarted                  bool   `json:"runtimeStarted"`
}

// runPrepareEpochRequest produces only the existing canonical PUBLIC request.
// It neither creates keys nor approves the request's own correlation hash.
// The original ceremony must consume a separately selected independent pin.
func runPrepareEpochRequest(args []string, output, diagnostics io.Writer) error {
	var o prepareEpochRequestOptions
	values := map[string]*string{
		"genesis": &o.genesis, "genesis-sha256": &o.genesisHash,
		"chain-id": &o.chainID, "validator-address": &o.address, "kind": &o.kind,
		"epoch": &o.epoch, "sequence": &o.sequence, "approved-at": &o.approvedAt,
		"effective-at": &o.effectiveAt, "activation-height": &o.activationHeight,
		"previous-event-hash": &o.previousEvent, "output": &o.output,
		"authorizing-epoch":                      &o.authorizingEpoch,
		"authority-ml-dsa87-public-key":          &o.authorityA,
		"authority-slh-dsa-sha2-256f-public-key": &o.authorityB,
	}
	// Match Go flag's single/double-hyphen and option/value boundaries. Reject
	// duplicates before parsing, filesystem access or any output creation.
	seen := make(map[string]bool, len(values))
	for n := 0; n < len(args); n++ {
		arg := args[n]
		if len(arg) < 2 || arg[0] != '-' || arg == "--" {
			break
		}
		name := strings.TrimPrefix(arg, "-")
		name = strings.TrimPrefix(name, "-")
		name, _, assigned := strings.Cut(name, "=")
		if _, known := values[name]; !known {
			break // The normal parser rejects unknown options without any I/O.
		}
		if seen[name] {
			return fmt.Errorf("duplicate -%s", name)
		}
		seen[name] = true
		if !assigned {
			n++
		}
	}
	fs := flag.NewFlagSet("prepare-epoch-request", flag.ContinueOnError)
	fs.SetOutput(diagnostics)
	for name, value := range values {
		fs.StringVar(value, name, "", "explicit public original operator input")
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	supplied := make(map[string]bool, len(values))
	fs.Visit(func(f *flag.Flag) { supplied[f.Name] = true })
	required := []string{"genesis", "genesis-sha256", "chain-id", "validator-address", "kind", "epoch", "sequence", "approved-at", "effective-at", "activation-height", "previous-event-hash", "output"}
	for _, name := range required {
		if !supplied[name] || *values[name] == "" {
			return fmt.Errorf("prepare-epoch-request requires explicit -%s", name)
		}
	}
	rotation := []string{"authorizing-epoch", "authority-ml-dsa87-public-key", "authority-slh-dsa-sha2-256f-public-key"}
	switch o.kind {
	case "register":
		for _, name := range rotation {
			if supplied[name] {
				return errors.New("first registration cannot supply rotation authority fields")
			}
		}
	case "rotate":
		for _, name := range rotation {
			if !supplied[name] || *values[name] == "" {
				return fmt.Errorf("rotation preparation requires explicit -%s", name)
			}
		}
	default:
		return errors.New("kind must be exactly register or rotate")
	}
	if output == nil || !prepareEpochAbsolutePath(o.genesis) || !prepareEpochAbsolutePath(o.output) {
		return errors.New("public preparation requires output writer and canonical absolute original/output paths")
	}
	if _, err := prepareEpochHex(o.genesisHash, sha256.Size, true); err != nil || o.genesisHash == strings.Repeat("0", 64) {
		return errors.New("genesis requires a nonzero independent lowercase SHA256 pin")
	}
	address, err := prepareEpochHex(o.address, 20, false)
	if err != nil {
		return errors.New("validator-address requires exactly 20 original address bytes in hex")
	}
	previous, err := prepareEpochHex(o.previousEvent, sha256.Size, true)
	if err != nil {
		return errors.New("previous-event-hash requires exactly 32 lowercase hex bytes")
	}
	epoch, err := prepareEpochUint(o.epoch, 64)
	if err != nil {
		return fmt.Errorf("epoch: %w", err)
	}
	sequence, err := prepareEpochUint(o.sequence, 64)
	if err != nil {
		return fmt.Errorf("sequence: %w", err)
	}
	approved, err := prepareEpochUint(o.approvedAt, 63)
	if err != nil {
		return fmt.Errorf("approved-at: %w", err)
	}
	effective, err := prepareEpochUint(o.effectiveAt, 63)
	if err != nil {
		return fmt.Errorf("effective-at: %w", err)
	}
	activation, err := prepareEpochUint(o.activationHeight, 63)
	if err != nil {
		return fmt.Errorf("activation-height: %w", err)
	}
	intent := ynxconsensusauth.RegistrationIntent{GenesisID: nil, ChainID: o.chainID, ValidatorAddress: bytes.Clone(address), Sequence: sequence, Epoch: epoch, ApprovedAt: int64(approved), EffectiveAt: int64(effective), PreviousEventHash: previous}
	if o.kind == "register" {
		intent.Kind = ynxconsensusauth.RegisterValidator
	} else {
		intent.Kind = ynxconsensusauth.RotateValidator
		intent.AuthorizingEpoch, err = prepareEpochUint(o.authorizingEpoch, 64)
		if err != nil {
			return fmt.Errorf("authorizing-epoch: %w", err)
		}
		intent.AuthorityMLDSA87PublicKey, err = prepareEpochHex(o.authorityA, ynxconsensusauth.MLDSA87PublicKeySize, true)
		if err != nil {
			return errors.New("rotation requires the complete canonical current authority key A")
		}
		intent.AuthoritySLHDSASHA2256fPublicKey, err = prepareEpochHex(o.authorityB, ynxconsensusauth.SLHDSASHA2256fPublicKeySize, true)
		if err != nil {
			return errors.New("rotation requires the complete canonical current authority key B")
		}
	}
	// Reuse the original existing private-directory boundary, without creating
	// ceremony paths, an intent marker or any custody/HRS files.
	if _, err = newPaths(filepath.Dir(o.output)); err != nil {
		return err
	}
	genesis, err := readRegular(o.genesis, maxGenesisBytes)
	if err != nil {
		return err
	}
	if !pinMatches(genesis, o.genesisHash) {
		return errors.New("genesis differs from independent operator pin")
	}
	var doc cmttypes.GenesisDoc
	if cmtjson.Unmarshal(genesis, &doc) != nil {
		return errors.New("invalid pinned Comet genesis")
	}
	genesisID := sha256.Sum256(genesis)
	intent.GenesisID = bytes.Clone(genesisID[:])
	// Selection alone does not validate a membership claim. The shared complete
	// consumer validator below checks every Ed key/address/power and uniqueness.
	if intent.Kind == ynxconsensusauth.RegisterValidator {
		for _, member := range doc.Validators {
			if bytes.Equal(member.Address, address) {
				if pub, ok := member.PubKey.(ed25519.PubKey); ok {
					intent.LegacyEd25519PublicKey = bytes.Clone(pub)
				}
				break
			}
		}
	}
	request := epochRequest{Format: requestFormat, ChainID: o.chainID, ValidatorAddress: address, Epoch: epoch, ActivationHeight: int64(activation), Registration: intent}
	if err = validateEpochRequest(request, genesis); err != nil {
		return err
	}
	raw, err := json.Marshal(request)
	if err != nil || len(raw) > maxRequestBytes {
		return errors.New("invalid bounded public epoch request")
	}
	// Do not truncate, repair, remove or retry any existing/partial request.
	if err = writeExclusive(o.output, raw); err != nil {
		return err
	}
	info, err := os.Lstat(o.output)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() != int64(len(raw)) {
		return errors.New("public request may exist with uncertain metadata; preserve it and do not prepare again")
	}
	requestHash := sha256.Sum256(raw)
	receipt := preparedEpochRequestReceipt{Version: "YNX-CONSENSUS-PQ-EPOCH-REQUEST-PREPARED/v1", Classification: "data", RequestPath: o.output, RequestSHA256: hex.EncodeToString(requestHash[:]), RequestBytes: len(raw), GenesisSHA256: o.genesisHash}
	public, err := json.Marshal(receipt)
	if err != nil {
		return errors.New("public request was written but receipt encoding failed; preserve the original output")
	}
	public = append(public, '\n')
	if n, err := output.Write(public); err != nil || n != len(public) {
		return errors.New("public request was written but result delivery failed; preserve the original output and do not overwrite or prepare again")
	}
	return nil
}

func prepareEpochAbsolutePath(value string) bool {
	return value != "" && strings.TrimSpace(value) == value && !strings.ContainsAny(value, "\x00\r\n") && filepath.IsAbs(value) && filepath.Clean(value) == value
}

func prepareEpochHex(value string, size int, lower bool) ([]byte, error) {
	if len(value) != size*2 || lower && value != strings.ToLower(value) {
		return nil, errors.New("invalid canonical public hex field")
	}
	raw, err := hex.DecodeString(value)
	if err != nil || len(raw) != size {
		return nil, errors.New("invalid public hex field")
	}
	return raw, nil
}

func prepareEpochUint(value string, bits int) (uint64, error) {
	n, err := strconv.ParseUint(value, 10, bits)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != value {
		return 0, errors.New("requires a positive canonical decimal integer within the original protocol bound")
	}
	return n, nil
}

//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

// This fixture contains synthetic PUBLIC bytes only. It deliberately does not
// call fixture(t), generate a key, open a credential, or enter the ceremony.
type prepareEpochFixture struct {
	root, genesisPath, requestPath string
	genesis                        []byte
	doc                            cmttypes.GenesisDoc
	request                        epochRequest
	args                           []string
}

func prepareEpochPublicFixture(t *testing.T) *prepareEpochFixture {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(root, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"input", "output"} {
		if err = os.Mkdir(filepath.Join(root, name), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	pub := ed25519.PubKey(bytes.Repeat([]byte{0x42}, ed25519.PubKeySize))
	addressHash := sha256.Sum256(pub)
	address := bytes.Clone(addressHash[:20])
	doc := cmttypes.GenesisDoc{
		ChainID: "ynx-public-epoch-request-test", InitialHeight: 1,
		GenesisTime: time.Unix(1700000000, 0).UTC(), ConsensusParams: cmttypes.DefaultConsensusParams(),
		Validators: []cmttypes.GenesisValidator{{Address: address, PubKey: pub, Power: 10, Name: "synthetic-public-member"}},
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	genesisID := sha256.Sum256(raw)
	f := &prepareEpochFixture{root: root, genesisPath: filepath.Join(root, "input", "genesis.json"), requestPath: filepath.Join(root, "output", "request.json"), genesis: raw, doc: doc}
	if err = os.WriteFile(f.genesisPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	f.request = epochRequest{
		Format: requestFormat, ChainID: doc.ChainID, ValidatorAddress: bytes.Clone(address), Epoch: 1, ActivationHeight: 100,
		Registration: ynxconsensusauth.RegistrationIntent{
			Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(genesisID[:]), ChainID: doc.ChainID,
			ValidatorAddress: bytes.Clone(address), Sequence: 1, Epoch: 1, ApprovedAt: 10, EffectiveAt: 12,
			PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(pub),
		},
	}
	f.args = []string{
		"--genesis", f.genesisPath, "--genesis-sha256", prepareEpochSHA(raw),
		"--chain-id", doc.ChainID, "--validator-address", hex.EncodeToString(address),
		"--kind", "register", "--epoch", "1", "--sequence", "1", "--approved-at", "10",
		"--effective-at", "12", "--activation-height", "100", "--previous-event-hash", strings.Repeat("0", 64),
		"--output", f.requestPath,
	}
	return f
}

func prepareEpochSHA(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func prepareEpochSet(args []string, name, value string) []string {
	out := append([]string(nil), args...)
	for i := 0; i < len(out); i += 2 {
		if out[i] == "--"+name {
			out[i+1] = value
			return out
		}
	}
	return append(out, "--"+name, value)
}

func prepareEpochWithout(args []string, name string) []string {
	out := make([]string, 0, len(args))
	for i := 0; i < len(args); i += 2 {
		if args[i] != "--"+name {
			out = append(out, args[i:i+2]...)
		}
	}
	return out
}

func (f *prepareEpochFixture) rotate() {
	i := &f.request.Registration
	i.Kind, i.Sequence, i.AuthorizingEpoch, i.Epoch = ynxconsensusauth.RotateValidator, 2, 1, 2
	i.PreviousEventHash = bytes.Repeat([]byte{0x35}, 32)
	i.LegacyEd25519PublicKey = nil
	i.AuthorityMLDSA87PublicKey = bytes.Repeat([]byte{0x53}, ynxconsensusauth.MLDSA87PublicKeySize)
	i.AuthoritySLHDSASHA2256fPublicKey = bytes.Repeat([]byte{0x75}, ynxconsensusauth.SLHDSASHA2256fPublicKeySize)
	f.request.Epoch = 2
	for name, value := range map[string]string{
		"kind": "rotate", "sequence": "2", "epoch": "2", "authorizing-epoch": "1",
		"previous-event-hash":                    hex.EncodeToString(i.PreviousEventHash),
		"authority-ml-dsa87-public-key":          hex.EncodeToString(i.AuthorityMLDSA87PublicKey),
		"authority-slh-dsa-sha2-256f-public-key": hex.EncodeToString(i.AuthoritySLHDSASHA2256fPublicKey),
	} {
		f.args = prepareEpochSet(f.args, name, value)
	}
}

func (f *prepareEpochFixture) replaceGenesis(t *testing.T) {
	t.Helper()
	raw, err := cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	f.genesis = raw
	if err = os.WriteFile(f.genesisPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	f.args = prepareEpochSet(f.args, "genesis-sha256", prepareEpochSHA(raw))
}

type prepareEpochOriginal struct {
	info os.FileInfo
	raw  []byte
	link string
}

func prepareEpochSnapshot(t *testing.T, root string) map[string]prepareEpochOriginal {
	t.Helper()
	out := make(map[string]prepareEpochOriginal)
	if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		original := prepareEpochOriginal{info: info}
		switch {
		case info.Mode().IsRegular():
			original.raw, err = os.ReadFile(path)
		case info.Mode()&os.ModeSymlink != 0:
			original.link, err = os.Readlink(path)
		}
		if err == nil {
			out[path] = original
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return out
}

func prepareEpochAssertOriginals(t *testing.T, before, after map[string]prepareEpochOriginal) {
	t.Helper()
	if len(before) != len(after) {
		t.Fatal("rejected preparation changed the original file inventory")
	}
	for path, original := range before {
		current, ok := after[path]
		if !ok || !os.SameFile(original.info, current.info) || original.info.Mode() != current.info.Mode() ||
			original.info.Size() != current.info.Size() || !original.info.ModTime().Equal(current.info.ModTime()) ||
			!bytes.Equal(original.raw, current.raw) || original.link != current.link {
			t.Fatal("preparation changed a retained original", path)
		}
	}
}

func prepareEpochRequireRejected(t *testing.T, f *prepareEpochFixture, args []string) error {
	t.Helper()
	before := prepareEpochSnapshot(t, f.root)
	var output, diagnostics bytes.Buffer
	err := runPrepareEpochRequest(args, &output, &diagnostics)
	if err == nil || output.Len() != 0 {
		t.Fatalf("invalid preparation produced success or a public receipt: err=%v output=%q", err, output.String())
	}
	prepareEpochAssertOriginals(t, before, prepareEpochSnapshot(t, f.root))
	return err
}

func prepareEpochReadConsumer(t *testing.T, f *prepareEpochFixture) ([]byte, epochRequest) {
	t.Helper()
	raw, err := os.ReadFile(f.requestPath)
	if err != nil {
		t.Fatal(err)
	}
	var decoded epochRequest
	if err = json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	canonical, err := json.Marshal(decoded)
	if err != nil || !bytes.Equal(raw, canonical) || bytes.HasSuffix(raw, []byte("\n")) {
		t.Fatal("request is not the exact existing canonical epochRequest encoding", err)
	}
	info, err := os.Lstat(f.requestPath)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
		t.Fatal("request is not a private 0600 regular file", err)
	}
	read, err := readPinnedRequest(options{request: f.requestPath, requestHash: prepareEpochSHA(raw), genesis: f.genesisPath, genesisHash: prepareEpochSHA(f.genesis)})
	if err != nil || !reflect.DeepEqual(read, decoded) {
		t.Fatal("public producer output cannot enter the original pinned consumer", err)
	}
	if len(decoded.Registration.MLDSA87PublicKey) != 0 || len(decoded.Registration.SLHDSASHA2256fPublicKey) != 0 {
		t.Fatal("public request preparation generated or proposed a new pair")
	}
	return raw, decoded
}

func prepareEpochAssertReceipt(t *testing.T, f *prepareEpochFixture, raw, receipt []byte) {
	t.Helper()
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(receipt, &fields); err != nil {
		t.Fatal("invalid public receipt", err)
	}
	if len(fields) != 11 {
		t.Fatalf("receipt changed the frozen public field set: %s", receipt)
	}
	for name, expected := range map[string]string{
		"version": "YNX-CONSENSUS-PQ-EPOCH-REQUEST-PREPARED/v1", "classification": "data",
		"requestPath": f.requestPath, "requestSHA256": prepareEpochSHA(raw), "genesisSHA256": prepareEpochSHA(f.genesis),
	} {
		var actual string
		if err := json.Unmarshal(fields[name], &actual); err != nil || actual != expected {
			t.Fatalf("wrong receipt %s: %s (%v)", name, fields[name], err)
		}
	}
	if string(fields["requestBytes"]) != strconv.Itoa(len(raw)) {
		t.Fatal("receipt requestBytes is not the exact integer byte count")
	}
	for _, name := range []string{"registrationAuthorized", "requestPinIndependentlyApproved", "keysGenerated", "signed", "runtimeStarted"} {
		if string(fields[name]) != "false" {
			t.Fatal("public preparation invented authority or runtime activity", name)
		}
	}
}

func TestPrepareEpochRequestRegisterRoundTripAndReceipt(t *testing.T) {
	f := prepareEpochPublicFixture(t)
	// Go's ordinary single-hyphen spelling and uppercase address hex must keep
	// the same original logical member, never derive a new key or address.
	f.args = prepareEpochSet(f.args, "validator-address", strings.ToUpper(hex.EncodeToString(f.request.ValidatorAddress)))
	for i := 0; i < len(f.args); i += 2 {
		f.args[i] = strings.TrimPrefix(f.args[i], "-")
	}
	var output, diagnostics bytes.Buffer
	if err := runPrepareEpochRequest(f.args, &output, &diagnostics); err != nil {
		t.Fatal(err)
	}
	raw, actual := prepareEpochReadConsumer(t, f)
	if !reflect.DeepEqual(actual, f.request) {
		t.Fatalf("producer changed original register identity or intent: %#v", actual)
	}
	prepareEpochAssertReceipt(t, f, raw, output.Bytes())
	if diagnostics.Len() != 0 {
		t.Fatal("successful preparation wrote diagnostics", diagnostics.String())
	}
}

func TestPrepareEpochRequestRotateRoundTripAndReceipt(t *testing.T) {
	f := prepareEpochPublicFixture(t)
	f.rotate()
	var output bytes.Buffer
	// The normal subcommand must use only the public producer. An empty
	// ceremonyIO must never be consulted and no recovery descriptor is present.
	if err := run(append([]string{"prepare-epoch-request"}, f.args...), &output, io.Discard, ceremonyIO{}); err != nil {
		t.Fatal(err)
	}
	raw, actual := prepareEpochReadConsumer(t, f)
	if !reflect.DeepEqual(actual, f.request) || len(actual.Registration.LegacyEd25519PublicKey) != 0 {
		t.Fatal("rotation changed its full current-pair authority or retained a legacy authority")
	}
	prepareEpochAssertReceipt(t, f, raw, output.Bytes())
}

func TestPrepareEpochRequestHPlusTwoAndIntegerBoundaries(t *testing.T) {
	cases := []struct {
		name, approved, effective string
		valid                     bool
	}{
		{"H", "10", "10", false}, {"H-plus-one", "10", "11", false}, {"H-plus-two", "10", "12", true},
		{"max-H-plus-two", strconv.FormatInt(math.MaxInt64-2, 10), strconv.FormatInt(math.MaxInt64, 10), true},
		{"overflow-H-plus-two", strconv.FormatInt(math.MaxInt64-1, 10), strconv.FormatInt(math.MaxInt64, 10), false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			f := prepareEpochPublicFixture(t)
			args := prepareEpochSet(prepareEpochSet(f.args, "approved-at", test.approved), "effective-at", test.effective)
			if !test.valid {
				prepareEpochRequireRejected(t, f, args)
				return
			}
			if err := runPrepareEpochRequest(args, io.Discard, io.Discard); err != nil {
				t.Fatal("valid original H+2 boundary rejected", err)
			}
			_, actual := prepareEpochReadConsumer(t, f)
			approved, _ := strconv.ParseInt(test.approved, 10, 64)
			effective, _ := strconv.ParseInt(test.effective, 10, 64)
			if actual.Registration.ApprovedAt != approved || actual.Registration.EffectiveAt != effective {
				t.Fatal("height integer was rounded or changed")
			}
		})
	}
	t.Run("max-uint64-rotation", func(t *testing.T) {
		f := prepareEpochPublicFixture(t)
		f.rotate()
		args := prepareEpochSet(prepareEpochSet(prepareEpochSet(f.args, "sequence", strconv.FormatUint(math.MaxUint64, 10)), "authorizing-epoch", strconv.FormatUint(math.MaxUint64-1, 10)), "epoch", strconv.FormatUint(math.MaxUint64, 10))
		if err := runPrepareEpochRequest(args, io.Discard, io.Discard); err != nil {
			t.Fatal("valid maximum uint64 rotation was rejected", err)
		}
		_, actual := prepareEpochReadConsumer(t, f)
		if actual.Epoch != math.MaxUint64 || actual.Registration.Sequence != math.MaxUint64 || actual.Registration.AuthorizingEpoch != math.MaxUint64-1 {
			t.Fatal("uint64 values were truncated or rounded")
		}
	})
}

func TestPrepareEpochRequestCanonicalNumericInputs(t *testing.T) {
	for _, name := range []string{"epoch", "sequence", "authorizing-epoch", "approved-at", "effective-at", "activation-height"} {
		for _, value := range []string{"", "0", "-1", "+1", "01", " 1", "1 ", "1.0", "1e1", "18446744073709551616"} {
			t.Run(fmt.Sprintf("%s/%q", name, value), func(t *testing.T) {
				f := prepareEpochPublicFixture(t)
				if name == "authorizing-epoch" {
					f.rotate()
				}
				prepareEpochRequireRejected(t, f, prepareEpochSet(f.args, name, value))
			})
		}
	}
	for _, name := range []string{"approved-at", "effective-at", "activation-height"} {
		t.Run(name+"/int64-overflow", func(t *testing.T) {
			f := prepareEpochPublicFixture(t)
			prepareEpochRequireRejected(t, f, prepareEpochSet(f.args, name, "9223372036854775808"))
		})
	}
}

func TestPrepareEpochRequestRegistrationAndRotationRules(t *testing.T) {
	cases := []struct {
		name, flag, value string
		rotate            bool
	}{
		{"register-sequence", "sequence", "2", false}, {"register-epoch", "epoch", "2", false},
		{"register-previous", "previous-event-hash", strings.Repeat("35", 32), false},
		{"unknown-kind", "kind", "revoke", false}, {"kind-case", "kind", "Register", false},
		{"rotate-sequence", "sequence", "1", true}, {"rotate-same-epoch", "epoch", "1", true},
		{"rotate-skipped-epoch", "epoch", "3", true}, {"rotate-previous-zero", "previous-event-hash", strings.Repeat("0", 64), true},
		{"rotate-authority-overflow", "authorizing-epoch", strconv.FormatUint(math.MaxUint64, 10), true},
		{"rotate-short-A", "authority-ml-dsa87-public-key", strings.Repeat("53", ynxconsensusauth.MLDSA87PublicKeySize-1), true},
		{"rotate-long-A", "authority-ml-dsa87-public-key", strings.Repeat("53", ynxconsensusauth.MLDSA87PublicKeySize+1), true},
		{"rotate-short-B", "authority-slh-dsa-sha2-256f-public-key", strings.Repeat("75", ynxconsensusauth.SLHDSASHA2256fPublicKeySize-1), true},
		{"rotate-long-B", "authority-slh-dsa-sha2-256f-public-key", strings.Repeat("75", ynxconsensusauth.SLHDSASHA2256fPublicKeySize+1), true},
		{"rotate-uppercase-A", "authority-ml-dsa87-public-key", strings.Repeat("AB", ynxconsensusauth.MLDSA87PublicKeySize), true},
		{"rotate-uppercase-B", "authority-slh-dsa-sha2-256f-public-key", strings.Repeat("AB", ynxconsensusauth.SLHDSASHA2256fPublicKeySize), true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			f := prepareEpochPublicFixture(t)
			if test.rotate {
				f.rotate()
			}
			prepareEpochRequireRejected(t, f, prepareEpochSet(f.args, test.flag, test.value))
		})
	}
	for _, flag := range []string{"authorizing-epoch", "authority-ml-dsa87-public-key", "authority-slh-dsa-sha2-256f-public-key"} {
		for _, value := range []string{"", "0"} {
			t.Run("register-forbids-explicit/"+flag+"/"+value, func(t *testing.T) {
				f := prepareEpochPublicFixture(t)
				prepareEpochRequireRejected(t, f, prepareEpochSet(f.args, flag, value))
			})
		}
	}
}

func TestPrepareEpochRequestRequiredOptionsBeforeInputIO(t *testing.T) {
	for _, rotate := range []bool{false, true} {
		f := prepareEpochPublicFixture(t)
		if rotate {
			f.rotate()
		}
		for i := 0; i < len(f.args); i += 2 {
			name := strings.TrimPrefix(f.args[i], "--")
			t.Run(fmt.Sprintf("rotate-%t/%s", rotate, name), func(t *testing.T) {
				current := prepareEpochPublicFixture(t)
				if rotate {
					current.rotate()
				}
				missing := filepath.Join(current.root, "input-must-not-be-read")
				args := prepareEpochWithout(prepareEpochSet(current.args, "genesis", missing), name)
				err := prepareEpochRequireRejected(t, current, args)
				if errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), missing) {
					t.Fatal("missing required option was rejected after input I/O", err)
				}
			})
		}
	}
}

func TestPrepareEpochRequestDuplicateOptionsBeforeInputIO(t *testing.T) {
	f := prepareEpochPublicFixture(t)
	f.rotate()
	for i := 0; i < len(f.args); i += 2 {
		name, value := strings.TrimPrefix(f.args[i], "--"), f.args[i+1]
		for _, style := range []string{"double", "single", "assigned-double", "assigned-single"} {
			t.Run(name+"/"+style, func(t *testing.T) {
				current := prepareEpochPublicFixture(t)
				current.rotate()
				missing := filepath.Join(current.root, "input-must-not-be-read")
				args := prepareEpochSet(current.args, "genesis", missing)
				switch style {
				case "double":
					args = append(args, "--"+name, value)
				case "single":
					args = append(args, "-"+name, value)
				case "assigned-double":
					args = append(args, "--"+name+"="+value)
				case "assigned-single":
					args = append(args, "-"+name+"="+value)
				}
				err := prepareEpochRequireRejected(t, current, args)
				if errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), missing) {
					t.Fatal("duplicate option reached input I/O", err)
				}
			})
		}
	}
}

func TestPrepareEpochRequestRejectsMixedModesAndPositionalsBeforeInputIO(t *testing.T) {
	for _, extra := range [][]string{
		{"--new-epoch"}, {"--inspect"}, {"--recovery-fd", "3"}, {"--request", "original.json"},
		{"--request-sha256", strings.Repeat("0", 64)}, {"--out-dir", "/old-ceremony"}, {"--state-dir", "/original-HRS"},
		{"--unknown=value"}, {"unexpected-positional"}, {"--", "unexpected-positional"},
	} {
		t.Run(strings.Join(extra, "="), func(t *testing.T) {
			f := prepareEpochPublicFixture(t)
			missing := filepath.Join(f.root, "input-must-not-be-read")
			args := append(prepareEpochSet(f.args, "genesis", missing), extra...)
			err := prepareEpochRequireRejected(t, f, args)
			if errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), missing) {
				t.Fatal("mixed mode or positional reached input I/O", err)
			}
		})
	}
}

func TestPrepareEpochRequestPinnedGenesisAndOriginalMembership(t *testing.T) {
	for _, name := range []string{"wrong-pin", "uppercase-pin", "short-pin", "exact-byte-change", "chain-mismatch", "absent-member", "member-address-mismatch", "duplicate-member", "zero-power", "zero-initial-height", "approval-before-genesis", "activation-before-genesis", "missing-time", "missing-params", "non-original-key-type", "malformed-genesis", "symlink-genesis", "relative-genesis"} {
		t.Run(name, func(t *testing.T) {
			f := prepareEpochPublicFixture(t)
			args := append([]string(nil), f.args...)
			switch name {
			case "wrong-pin":
				args = prepareEpochSet(args, "genesis-sha256", strings.Repeat("0", 64))
			case "uppercase-pin":
				args = prepareEpochSet(args, "genesis-sha256", strings.ToUpper(prepareEpochSHA(f.genesis)))
			case "short-pin":
				args = prepareEpochSet(args, "genesis-sha256", strings.Repeat("0", 63))
			case "exact-byte-change":
				if err := os.WriteFile(f.genesisPath, append(bytes.Clone(f.genesis), '\n'), 0o600); err != nil {
					t.Fatal(err)
				}
			case "chain-mismatch":
				args = prepareEpochSet(args, "chain-id", "another-original-chain")
			case "absent-member":
				args = prepareEpochSet(args, "validator-address", strings.Repeat("12", 20))
			case "member-address-mismatch":
				f.doc.Validators[0].Address = bytes.Repeat([]byte{0x12}, 20)
				f.replaceGenesis(t)
				args = f.args
			case "duplicate-member":
				f.doc.Validators = append(f.doc.Validators, f.doc.Validators[0])
				f.replaceGenesis(t)
				args = f.args
			case "zero-power":
				f.doc.Validators[0].Power = 0
				f.replaceGenesis(t)
				args = f.args
			case "zero-initial-height":
				f.doc.InitialHeight = 0
				f.replaceGenesis(t)
				args = f.args
			case "approval-before-genesis", "activation-before-genesis":
				f.doc.InitialHeight = 20
				f.replaceGenesis(t)
				args = f.args
				if name == "activation-before-genesis" {
					args = prepareEpochSet(prepareEpochSet(prepareEpochSet(args, "approved-at", "20"), "effective-at", "22"), "activation-height", "19")
				}
			case "missing-time":
				f.doc.GenesisTime = time.Time{}
				f.replaceGenesis(t)
				args = f.args
			case "missing-params":
				f.doc.ConsensusParams = nil
				f.replaceGenesis(t)
				args = f.args
			case "non-original-key-type":
				f.doc.ConsensusParams.Validator.PubKeyTypes = []string{"secp256k1"}
				f.replaceGenesis(t)
				args = f.args
			case "malformed-genesis":
				f.genesis = []byte("{not-a-genesis}")
				if err := os.WriteFile(f.genesisPath, f.genesis, 0o600); err != nil {
					t.Fatal(err)
				}
				args = prepareEpochSet(args, "genesis-sha256", prepareEpochSHA(f.genesis))
			case "symlink-genesis":
				alias := filepath.Join(f.root, "input", "genesis-alias.json")
				if err := os.Symlink(f.genesisPath, alias); err != nil {
					t.Fatal(err)
				}
				args = prepareEpochSet(args, "genesis", alias)
			case "relative-genesis":
				args = prepareEpochSet(args, "genesis", "relative-genesis.json")
			}
			prepareEpochRequireRejected(t, f, args)
		})
	}
}

func TestPrepareEpochRequestCanonicalPublicHex(t *testing.T) {
	for _, test := range []struct{ name, flag, value string }{
		{"address-short", "validator-address", strings.Repeat("12", 19)},
		{"address-long", "validator-address", strings.Repeat("12", 21)},
		{"address-prefix", "validator-address", "0x" + strings.Repeat("12", 20)},
		{"address-nonhex", "validator-address", strings.Repeat("zz", 20)},
		{"previous-short", "previous-event-hash", strings.Repeat("12", 31)},
		{"previous-long", "previous-event-hash", strings.Repeat("12", 33)},
		{"previous-uppercase", "previous-event-hash", strings.Repeat("AB", 32)},
		{"previous-prefix", "previous-event-hash", "0x" + strings.Repeat("12", 32)},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := prepareEpochPublicFixture(t)
			if strings.HasPrefix(test.name, "previous-") {
				f.rotate()
			}
			prepareEpochRequireRejected(t, f, prepareEpochSet(f.args, test.flag, test.value))
		})
	}
}

func TestPrepareEpochRequestExistingPartialAndAliasedOutputPreserved(t *testing.T) {
	for _, name := range []string{"existing", "partial", "empty", "symlink", "broken-symlink", "directory", "parent-symlink", "noncanonical", "relative", "public-parent", "missing-parent", "parent-file", "genesis-as-output"} {
		t.Run(name, func(t *testing.T) {
			f := prepareEpochPublicFixture(t)
			args := append([]string(nil), f.args...)
			write := func(path string, raw []byte) {
				t.Helper()
				if err := os.WriteFile(path, raw, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			switch name {
			case "existing":
				write(f.requestPath, []byte("original independently approved request must remain exact"))
			case "partial":
				write(f.requestPath, []byte(`{"format":"YNX-CONSENSUS-PQ-NEW-EPOCH/v1",`))
			case "empty":
				write(f.requestPath, nil)
			case "symlink", "broken-symlink":
				target := filepath.Join(f.root, "original-UNKNOWN.json")
				if name == "symlink" {
					write(target, []byte("retain original UNKNOWN; do not replay or replace"))
				}
				if err := os.Symlink(target, f.requestPath); err != nil {
					t.Fatal(err)
				}
			case "directory":
				if err := os.Mkdir(f.requestPath, 0o700); err != nil {
					t.Fatal(err)
				}
			case "parent-symlink":
				alias := filepath.Join(f.root, "output-alias")
				if err := os.Symlink(filepath.Dir(f.requestPath), alias); err != nil {
					t.Fatal(err)
				}
				args = prepareEpochSet(args, "output", filepath.Join(alias, "request.json"))
			case "noncanonical":
				args = prepareEpochSet(args, "output", filepath.Dir(f.requestPath)+"/../output/request.json")
			case "relative":
				args = prepareEpochSet(args, "output", "relative-request.json")
			case "public-parent":
				if err := os.Chmod(filepath.Dir(f.requestPath), 0o755); err != nil {
					t.Fatal(err)
				}
			case "missing-parent":
				args = prepareEpochSet(args, "output", filepath.Join(f.root, "missing", "request.json"))
			case "parent-file":
				parent := filepath.Join(f.root, "not-a-directory")
				write(parent, []byte("original file"))
				args = prepareEpochSet(args, "output", parent+"/request.json")
			case "genesis-as-output":
				args = prepareEpochSet(args, "output", f.genesisPath)
			}
			prepareEpochRequireRejected(t, f, args)
		})
	}
}

type prepareEpochFailedReceipt struct{}

func (prepareEpochFailedReceipt) Write([]byte) (int, error) {
	return 0, errors.New("synthetic public receipt delivery failure")
}

type prepareEpochShortReceipt struct{}

func (prepareEpochShortReceipt) Write(raw []byte) (int, error) {
	return len(raw) / 2, nil
}

func TestPrepareEpochRequestLateReceiptFailureRetainsCompletedOriginal(t *testing.T) {
	for _, test := range []struct {
		name   string
		writer io.Writer
	}{{"write-error", prepareEpochFailedReceipt{}}, {"short-without-error", prepareEpochShortReceipt{}}} {
		t.Run(test.name, func(t *testing.T) {
			f := prepareEpochPublicFixture(t)
			if err := runPrepareEpochRequest(f.args, test.writer, io.Discard); err == nil {
				t.Fatal("lost public receipt was reported delivered")
			}
			raw, actual := prepareEpochReadConsumer(t, f)
			if !reflect.DeepEqual(actual, f.request) {
				t.Fatal("receipt failure lost or changed the completed original request")
			}
			before := prepareEpochSnapshot(t, f.root)
			var retryOutput bytes.Buffer
			if err := runPrepareEpochRequest(f.args, &retryOutput, io.Discard); err == nil || retryOutput.Len() != 0 {
				t.Fatal("late receipt failure permitted overwrite or an invented retry success")
			}
			prepareEpochAssertOriginals(t, before, prepareEpochSnapshot(t, f.root))
			again, err := os.ReadFile(f.requestPath)
			if err != nil || !bytes.Equal(raw, again) {
				t.Fatal("retry changed the exact original request", err)
			}
		})
	}
}

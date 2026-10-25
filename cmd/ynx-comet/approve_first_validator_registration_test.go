package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/privval"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/spf13/cobra"
)

type firstApprovalFixture struct {
	options   firstApprovalFlags
	record    firstApprovalRecord
	key       string
	originals map[string][]byte
}

func newFirstApprovalFixture(t *testing.T) firstApprovalFixture {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	legacy := ed25519.GenPrivKey()
	defer clear(legacy)
	public := legacy.PubKey().(ed25519.PubKey)
	doc := cmttypes.GenesisDoc{ChainID: "ynx-first-approval-isolated", InitialHeight: 1, GenesisTime: time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC), ConsensusParams: cmttypes.DefaultConsensusParams(), Validators: []cmttypes.GenesisValidator{{Address: public.Address(), PubKey: public, Power: 10, Name: "original"}}}
	genesis, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	genesisID, err := hex.DecodeString(firstApprovalSHA(genesis))
	if err != nil {
		t.Fatal(err)
	}
	candidate, a, b, err := ynxconsensusauth.GenerateCandidateKey()
	if err != nil {
		t.Fatal(err)
	}
	defer candidate.Destroy()
	i := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: genesisID, ChainID: doc.ChainID, ValidatorAddress: public.Address(), Sequence: 1, Epoch: 1, ApprovedAt: 10, EffectiveAt: 12, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: public, MLDSA87PublicKey: a, SLHDSASHA2256fPublicKey: b}
	intent, err := i.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	sa, sb, err := candidate.RegistrationPossession(i)
	if err != nil {
		t.Fatal(err)
	}
	// These public record paths must never be opened or provisioned by approval.
	state := filepath.Join(root, "unopened-custody", "original-sign-state.json")
	record := firstApprovalRecord{Format: "YNX-CONSENSUS-PQ-CEREMONY-PUBLIC/v1", Status: "new_epoch_files_durable_registration_not_authorized", Paths: firstApprovalPaths{State: state}, Binding: ynxconsensusauth.HostKeyBinding{Policy: ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: genesisID, ChainID: doc.ChainID, ActivationHeight: 100}, ValidatorAddress: public.Address(), Epoch: 1, MLDSA87PublicKey: a, SLHDSASHA2256fPublicKey: b, SignerStatePath: state}, IntentWire: intent, PossessionA: sa, PossessionB: sb, FileSHA256: map[string]string{}}
	rawRecord, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	rawKey, err := cmtjson.MarshalIndent(privval.FilePVKey{Address: public.Address(), PubKey: public, PrivKey: legacy}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	defer clear(rawKey)
	o := firstApprovalFlags{record: filepath.Join(root, "public-record.json"), recordHash: firstApprovalSHA(rawRecord), genesis: filepath.Join(root, "genesis.json"), genesisHash: firstApprovalSHA(genesis), directory: filepath.Join(root, "approval")}
	key := filepath.Join(root, "original-key.json")
	originals := map[string][]byte{o.record: rawRecord, o.genesis: genesis, key: bytes.Clone(rawKey), filepath.Join(root, "original-HRS.json"): []byte(`{"height":"9","round":2,"step":3,"unknown":"preserve"}`)}
	t.Cleanup(func() { clear(originals[key]) })
	for path, raw := range originals {
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return firstApprovalFixture{options: o, record: record, key: key, originals: originals}
}

func firstApprovalFD(t *testing.T, path string) string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	fd, err := syscall.Dup(int(f.Fd()))
	if closeErr := f.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	if err != nil {
		t.Fatal(err)
	}
	return strconv.Itoa(fd) // The command alone owns and closes this descriptor.
}

func firstApprovalArguments(o firstApprovalFlags) []string {
	return []string{"approve-first-validator-registration", "--public-record", o.record, "--public-record-sha256", o.recordHash, "--consensus-genesis", o.genesis, "--consensus-genesis-sha256", o.genesisHash, "--approval-directory", o.directory, "--legacy-key-fd", o.keyFD}
}

func executeFirstApproval(args []string, output io.Writer) error {
	root := &cobra.Command{Use: "ynx-comet", SilenceUsage: true, SilenceErrors: true, PersistentPreRunE: func(*cobra.Command, []string) error {
		return errors.New("approval entered runtime configuration/home creation")
	}}
	root.AddCommand(newApproveFirstValidatorRegistrationCommand())
	root.SetOut(output)
	root.SetErr(io.Discard)
	root.SetArgs(args)
	return root.Execute()
}

func assertFirstApprovalOriginals(t *testing.T, f firstApprovalFixture) {
	t.Helper()
	for path, raw := range f.originals {
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(got, raw) {
			t.Fatal("approval changed original key/HRS/genesis/public record", path, err)
		}
	}
	if _, err := os.Lstat(filepath.Dir(f.record.Paths.State)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("approval opened/provisioned public record custody path", err)
	}
}

func TestFirstValidatorApprovalNormalCommandRealSignaturesAndRetainedResult(t *testing.T) {
	f := newFirstApprovalFixture(t)
	o := f.options
	o.keyFD = firstApprovalFD(t, f.key)
	var output bytes.Buffer
	if err := executeFirstApproval(firstApprovalArguments(o), &output); err != nil {
		t.Fatal(err)
	}
	var result firstApprovalResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Version != "YNX-FIRST-VALIDATOR-APPROVAL/v1" || !result.AuthorizationSigned || result.Broadcast || result.Committed || result.PQActivated || result.ApprovedAt != "10" || result.EffectiveAt != "12" {
		t.Fatal("approval invented execution/activation", result)
	}
	wire, err := os.ReadFile(result.RegistrationFile)
	if err != nil {
		t.Fatal(err)
	}
	r, err := ynxconsensusauth.DecodeRegistration(wire)
	if err != nil {
		t.Fatal(err)
	}
	message, err := r.Intent.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.PubKey(r.Intent.LegacyEd25519PublicKey).VerifySignature(message, r.LegacyApproval) {
		t.Fatal("old key did not sign complete authority domain")
	}
	pop, err := r.Intent.PossessionSigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	p := ynxconsensusauth.CIRCLProvider{}
	if p.VerifyMLDSA87(r.Intent.MLDSA87PublicKey, pop, r.PossessionMLDSA87) != nil || p.VerifySLHDSASHA2256f(r.Intent.SLHDSASHA2256fPublicKey, pop, r.PossessionSLHDSASHA2256f) != nil {
		t.Fatal("approved wire lost real dual possession")
	}
	payload, err := consensus.EncodeValidatorRegistryTransaction(wire)
	if err != nil || "0x"+firstApprovalSHA(payload) != result.ABCIHash || firstApprovalSHA(wire) != result.RegistrationSHA256 {
		t.Fatal("actual canonical registration/ABCI hashes differ", err)
	}
	operation, err := ynxconsensusauth.RegistrationHash(wire)
	if err != nil || "0x"+hex.EncodeToString(operation[:]) != result.OperationHash {
		t.Fatal("operation identity differs", err)
	}
	before := map[string][]byte{}
	entries, err := os.ReadDir(o.directory)
	if err != nil || len(entries) != 3 {
		t.Fatal("incomplete durable approval", entries, err)
	}
	for _, entry := range entries {
		path := filepath.Join(o.directory, entry.Name())
		before[path], err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("approval output is not private", err)
		}
	}
	o.keyFD = firstApprovalFD(t, f.key)
	if err := executeFirstApproval(firstApprovalArguments(o), io.Discard); err == nil {
		t.Fatal("existing approval was overwritten/replayed")
	}
	for path, raw := range before {
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(got, raw) {
			t.Fatal("repeat changed retained approval", path, err)
		}
	}
	assertFirstApprovalOriginals(t, f)
}

func TestFirstValidatorApprovalRejectsMalformedPublicInputsBeforeIntent(t *testing.T) {
	f := newFirstApprovalFixture(t)
	for _, name := range []string{"wrong-pin", "bad-MLDSA", "bad-SLHDSA", "different-binding", "different-intent", "duplicate-json", "unknown-json", "symlink-output", "recovery-alias"} {
		t.Run(name, func(t *testing.T) {
			o := f.options
			o.directory = filepath.Join(filepath.Dir(o.directory), "approval-"+name)
			var record firstApprovalRecord
			raw := bytes.Clone(f.originals[f.options.record])
			if err := json.Unmarshal(raw, &record); err != nil {
				t.Fatal(err)
			}
			switch name {
			case "bad-MLDSA":
				record.PossessionA[0] ^= 1
			case "bad-SLHDSA":
				record.PossessionB[0] ^= 1
			case "different-binding":
				record.Binding.Epoch++
			case "different-intent":
				record.IntentWire[len(record.IntentWire)-1] ^= 1
			}
			if name != "wrong-pin" {
				var err error
				raw, err = json.Marshal(record)
				if err != nil {
					t.Fatal(err)
				}
			}
			if name == "duplicate-json" {
				raw = append([]byte(`{"format":"other",`), raw[1:]...)
			}
			if name == "unknown-json" {
				raw = append([]byte(`{"unknown":true,`), raw[1:]...)
			}
			if name == "symlink-output" {
				if err := os.Symlink(filepath.Join(filepath.Dir(o.directory), "missing"), o.directory); err != nil {
					t.Fatal(err)
				}
			}
			if name == "recovery-alias" {
				o.directory = filepath.Dir(f.record.Paths.State)
				if err := os.Mkdir(o.directory, 0700); err != nil {
					t.Fatal(err)
				}
			}
			o.record = filepath.Join(filepath.Dir(f.options.record), "record-"+name+".json")
			if err := os.WriteFile(o.record, raw, 0600); err != nil {
				t.Fatal(err)
			}
			o.recordHash = firstApprovalSHA(raw)
			if name == "wrong-pin" {
				o.recordHash = firstApprovalSHA([]byte("not original"))
			}
			o.keyFD = firstApprovalFD(t, f.key)
			if err := executeFirstApproval(firstApprovalArguments(o), io.Discard); err == nil {
				t.Fatal("malformed public input approved", name)
			}
			if name != "symlink-output" && name != "recovery-alias" {
				if _, err := os.Lstat(o.directory); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("invalid input created approval intent", err)
				}
			}
		})
	}
	// The recovery-alias rejection retained the preexisting original directory.
	if entries, err := os.ReadDir(filepath.Dir(f.record.Paths.State)); err != nil || len(entries) != 0 {
		t.Fatal("existing custody directory mutated", err)
	}
	for path, raw := range f.originals {
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(got, raw) {
			t.Fatal("invalid input changed original", path, err)
		}
	}
}

type firstApprovalBrokenOutput struct{}

func (firstApprovalBrokenOutput) Write([]byte) (int, error) {
	return 0, errors.New("isolated result delivery failure")
}

func TestFirstValidatorApprovalFailureRetainsIntentAndOriginalKey(t *testing.T) {
	f := newFirstApprovalFixture(t)
	for _, name := range []string{"different-key", "key-public-half", "world-readable-key", "delivery-failure"} {
		t.Run(name, func(t *testing.T) {
			o := f.options
			o.directory = filepath.Join(filepath.Dir(o.directory), "attempt-"+name)
			path := f.key
			if name != "delivery-failure" {
				path = filepath.Join(filepath.Dir(f.key), "bad-key-"+name)
				raw := bytes.Clone(f.originals[f.key])
				defer clear(raw)
				if name != "world-readable-key" {
					var k privval.FilePVKey
					if err := cmtjson.Unmarshal(raw, &k); err != nil {
						t.Fatal(err)
					}
					private := k.PrivKey.(ed25519.PrivKey)
					defer clear(private)
					if name == "different-key" {
						private[0] ^= 1
					} else {
						clear(private[32:])
					}
					var err error
					raw, err = cmtjson.Marshal(k)
					if err != nil {
						t.Fatal(err)
					}
				}
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
				if name == "world-readable-key" {
					if err := os.Chmod(path, 0644); err != nil {
						t.Fatal(err)
					}
				}
			}
			o.keyFD = firstApprovalFD(t, path)
			var output io.Writer = io.Discard
			if name == "delivery-failure" {
				output = firstApprovalBrokenOutput{}
			}
			if err := executeFirstApproval(firstApprovalArguments(o), output); err == nil {
				t.Fatal("uncertain/invalid approval reported success")
			}
			intent, err := os.ReadFile(filepath.Join(o.directory, "intent.json"))
			if err != nil || len(intent) == 0 {
				t.Fatal("original attempt was not retained", err)
			}
			_, wireErr := os.Stat(filepath.Join(o.directory, "registration.wire"))
			_, resultErr := os.Stat(filepath.Join(o.directory, "result.json"))
			if name == "delivery-failure" {
				if wireErr != nil || resultErr != nil {
					t.Fatal("lost durable result on stdout failure")
				}
			} else if !errors.Is(wireErr, os.ErrNotExist) || !errors.Is(resultErr, os.ErrNotExist) {
				t.Fatal("invalid key produced an approval", wireErr, resultErr)
			}
		})
	}
	assertFirstApprovalOriginals(t, f)
}

func TestFirstValidatorApprovalClosedNormalFlags(t *testing.T) {
	o := firstApprovalFlags{record: "/public-record", recordHash: "pin", genesis: "/genesis", genesisHash: "pin", directory: "/approval", keyFD: "3"}
	for _, extra := range [][]string{{"--legacy-key-fd", "4"}, {"--public-record-sha256", "other"}, {"--recovery-fd", "3"}, {"--private-key", "secret-not-accepted"}, {"unexpected"}} {
		if err := executeFirstApproval(append(firstApprovalArguments(o), extra...), io.Discard); err == nil {
			t.Fatal("normal command accepted ambiguous/unrelated secret flags", extra[0])
		}
	}
}

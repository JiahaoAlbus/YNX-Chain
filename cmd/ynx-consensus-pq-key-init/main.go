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
	"strings"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
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
	stateDirectory                                        string
	credentialFD                                          int
}

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr, realCeremonyIO()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, output, diagnostics io.Writer, disk ceremonyIO) error {
	if len(args) > 0 {
		switch args[0] {
		case "prepare-epoch-request":
			return runPrepareEpochRequest(args[1:], output, diagnostics)
		case "provision-recovery-credential":
			return runProvisionRecoveryCredential(args[1:], output, diagnostics)
		}
	}
	if err := rejectDuplicateOptions(args); err != nil {
		return err
	}
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
	fs.StringVar(&o.stateDirectory, "state-dir", "", "optional separate existing signer-owned empty 0700 HRS directory; use the same path for read-only inspection")
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
			return errors.New("inspect accepts only out-dir and optional state-dir and never consumes a credential")
		}
		report, err := inspectCeremonyWithStateDirectory(o.directory, o.stateDirectory)
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
	paths, err := newPathsWithStateDirectory(o.directory, o.stateDirectory)
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

func rejectDuplicateOptions(args []string) error {
	// Follow Go flag's option/value boundaries without parsing values or opening
	// an inherited credential. Single/double hyphens name the same option.
	boolean := map[string]bool{"new-epoch": true, "inspect": true, "request": false,
		"request-sha256": false, "genesis": false, "genesis-sha256": false,
		"out-dir": false, "state-dir": false, "recovery-fd": false}
	seen := make(map[string]bool, len(boolean))
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if len(arg) < 2 || arg[0] != '-' || arg == "--" {
			break // FlagSet.Parse retains the original positional/help/error rules.
		}
		name := arg[1:]
		if name[0] == '-' {
			name = name[1:]
		}
		name, _, assigned := strings.Cut(name, "=")
		isBoolean, known := boolean[name]
		if !known {
			break // Let the original parser reject unknown or malformed options.
		}
		if seen[name] {
			return fmt.Errorf("duplicate -%s", name)
		}
		seen[name] = true
		if !isBoolean && !assigned {
			index++ // Go consumes the next string even when it begins with '-'.
		}
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
	return request, validateEpochRequest(request, genesis)
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

func newPathsWithStateDirectory(directory, stateDirectory string) (ceremonyPaths, error) {
	p, err := newPaths(directory)
	if err != nil || stateDirectory == "" {
		return p, err
	}
	state, err := newPaths(stateDirectory)
	if err != nil {
		return ceremonyPaths{}, fmt.Errorf("state-dir: %w", err)
	}
	contains := func(parent, child string) bool {
		return parent == child || strings.HasPrefix(child, parent+string(filepath.Separator))
	}
	if contains(directory, stateDirectory) || contains(stateDirectory, directory) {
		return ceremonyPaths{}, errors.New("state-dir and out-dir must be separate directories without containment")
	}
	for _, path := range []string{directory, stateDirectory} {
		info, err := os.Lstat(path)
		if err != nil {
			return ceremonyPaths{}, err
		}
		owner, ok := info.Sys().(*syscall.Stat_t)
		if !ok || owner.Uid != uint32(os.Geteuid()) {
			return ceremonyPaths{}, errors.New("separate custody and HRS directories must belong to the executing signer UID")
		}
	}
	p.State = state.State
	return p, nil
}

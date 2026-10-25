package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Each option may occur once. In particular, an explicitly empty validator
// path is still an attempted local-custody option in node-only mode.
type keycheckOption struct {
	value         string
	seen, boolean bool
}

func (o *keycheckOption) String() string   { return o.value }
func (o *keycheckOption) IsBoolFlag() bool { return o.boolean }
func (o *keycheckOption) Set(value string) error {
	if o.seen {
		return errors.New("repeated keycheck option")
	}
	o.seen = true
	if o.boolean && value != "true" {
		return errors.New("keycheck mode is an explicit true-only mode")
	}
	o.value = value
	return nil
}

func runKeyCheck(args []string, output, diagnostics io.Writer) int {
	options := flag.NewFlagSet("ynx-consensus-keycheck", flag.ContinueOnError)
	options.SetOutput(io.Discard)
	var roleManifest, privateValidatorKey, nodeKey, role, keyDir keycheckOption
	nodeOnly := keycheckOption{boolean: true}
	inspect := keycheckOption{boolean: true}
	options.Var(&roleManifest, "role-manifest", "approved public production role manifest")
	options.Var(&privateValidatorKey, "private-validator-key", "host-local CometBFT private validator key file")
	options.Var(&nodeKey, "node-key", "host-local CometBFT node key file")
	options.Var(&nodeOnly, "node-only", "check only the existing local P2P identity; no consensus signing authority")
	options.Var(&inspect, "inspect-public-identity", "read existing host-local public identities only; no manifest match or signing authority")
	options.Var(&role, "role", "existing custody role for public identity inspection only")
	options.Var(&keyDir, "key-dir", "existing private custody directory for public identity inspection only")
	if err := options.Parse(args); err != nil || options.NArg() != 0 {
		fmt.Fprintln(diagnostics, "invalid, repeated or positional keycheck option")
		return 1
	}
	if inspect.seen {
		if nodeOnly.seen || roleManifest.seen || privateValidatorKey.seen || nodeKey.seen {
			fmt.Fprintln(diagnostics, "public identity inspection forbids all manifest, explicit key-path and node-only options")
			return 1
		}
		if !validKeycheckInspectionRole(role.value) || !role.seen || !keyDir.seen || !validKeycheckCustodyPath(keyDir.value) {
			fmt.Fprintln(diagnostics, "public identity inspection requires an exact supported -role and canonical absolute -key-dir")
			return 1
		}
		receipt, err := inspectKeycheckPublicIdentity(role.value, keyDir.value)
		if err != nil {
			// Do not print a key decoder error or any original private payload.
			fmt.Fprintln(diagnostics, "existing private custody could not be inspected read-only")
			return 1
		}
		if err = json.NewEncoder(output).Encode(receipt); err != nil {
			fmt.Fprintln(diagnostics, "public identity output was not confirmed; no custody file was changed")
			return 1
		}
		return 0
	}
	if role.seen || keyDir.seen {
		fmt.Fprintln(diagnostics, "-role and -key-dir require explicit -inspect-public-identity")
		return 1
	}
	if nodeOnly.seen && privateValidatorKey.seen {
		fmt.Fprintln(diagnostics, "-node-only forbids -private-validator-key, including an empty value")
		return 1
	}
	for label, value := range map[string]string{"-role-manifest": roleManifest.value, "-node-key": nodeKey.value} {
		if strings.TrimSpace(value) == "" {
			fmt.Fprintf(diagnostics, "%s is required\n", label)
			return 1
		}
	}
	if nodeOnly.seen {
		if err := consensus.VerifyProductionNodeKeyFile(roleManifest.value, nodeKey.value); err != nil {
			fmt.Fprintln(diagnostics, err)
			return 1
		}
		fmt.Fprintln(output, "production node key matches the approved public role manifest (P2P identity only)")
		return 0
	}
	if strings.TrimSpace(privateValidatorKey.value) == "" {
		fmt.Fprintln(diagnostics, "-private-validator-key is required")
		return 1
	}
	if err := consensus.VerifyProductionKeyFiles(roleManifest.value, privateValidatorKey.value, nodeKey.value); err != nil {
		fmt.Fprintln(diagnostics, err)
		return 1
	}
	fmt.Fprintln(output, "production validator and node keys match the approved public role manifest")
	return 0
}

const keycheckPublicIdentityVersion = "YNX-CONSENSUS-KEYCHECK-PUBLIC-IDENTITY/v1"

type keycheckPublicIdentityReceipt struct {
	Version            string                                `json:"version"`
	PublicRecord       consensus.ProductionKeyCeremonyRecord `json:"publicRecord"`
	PublicDataOnly     bool                                  `json:"publicDataOnly"`
	SourceReadOnly     bool                                  `json:"sourceReadOnly"`
	ManifestMatched    bool                                  `json:"manifestMatched"`
	AuthorityGranted   bool                                  `json:"authorityGranted"`
	HRSUnchanged       bool                                  `json:"hrsUnchanged"`
	HRSHistoryVerified bool                                  `json:"hrsHistoryVerified"`
	SigningPerformed   bool                                  `json:"signingPerformed"`
	FilesCreated       bool                                  `json:"filesCreated"`
}

func validKeycheckInspectionRole(role string) bool {
	switch role {
	case "primary", "singapore", "silicon-valley", "seoul":
		return true
	}
	return false
}

func validKeycheckCustodyPath(path string) bool {
	return path != "" && len(path) <= 4096 && !strings.ContainsRune(path, '\x00') && filepath.IsAbs(path) && filepath.Clean(path) == path && filepath.Dir(path) != path
}

// Require the actual custody owner, not root's ability to bypass another UID's
// permissions. The unchanged core reader supplies the public record; this
// wrapper first holds and bounds all original files, then rechecks their bytes
// and identity before permitting any public stdout. No H/R/S interpretation or
// independent manifest qualification is implied by this inspection.
func inspectKeycheckPublicIdentity(role, keyDir string) (receipt keycheckPublicIdentityReceipt, resultErr error) {
	if !validKeycheckInspectionRole(role) || !validKeycheckCustodyPath(keyDir) || os.Getuid() != os.Geteuid() {
		return receipt, errors.New("explicit original custody owner and role required")
	}
	resolved, err := filepath.EvalSymlinks(keyDir)
	if err != nil || resolved != keyDir {
		return receipt, errors.New("original canonical custody directory required")
	}
	directory, err := openKeycheckCustody(keyDir, true)
	if err != nil {
		return receipt, err
	}
	inputs := []*keycheckCustodyInput{directory}
	defer func() {
		for _, input := range inputs {
			resultErr = errors.Join(resultErr, input.file.Close())
		}
	}()
	for _, name := range []string{"priv_validator_key.json", "node_key.json", "priv_validator_state.json"} {
		input, err := openKeycheckCustody(filepath.Join(keyDir, name), false)
		if err != nil {
			return receipt, err
		}
		inputs = append(inputs, input)
	}
	for _, input := range inputs {
		if err := input.unchanged(); err != nil {
			return receipt, err
		}
	}
	record, err := consensus.ReadProductionKeyRecord(role, keyDir)
	if err != nil {
		return receipt, errors.New("existing public identity record could not be derived")
	}
	for _, input := range inputs {
		if err := input.unchanged(); err != nil {
			return receipt, err
		}
	}
	resolved, err = filepath.EvalSymlinks(keyDir)
	if err != nil || resolved != keyDir {
		return receipt, errors.New("original custody directory path changed")
	}
	return keycheckPublicIdentityReceipt{Version: keycheckPublicIdentityVersion, PublicRecord: record, PublicDataOnly: true, SourceReadOnly: true, HRSUnchanged: true}, nil
}

type keycheckCustodyInput struct {
	path      string
	file      *os.File
	info      os.FileInfo
	identity  string
	digest    [sha256.Size]byte
	directory bool
}

// Sys metadata field names differ between Linux and Darwin. Retain nanosecond
// mtime AND ctime on both; absent/unknown metadata fails closed. atime is omitted
// deliberately because a normal first read may update it.
func keycheckCustodyIdentity(info os.FileInfo, directory bool) (string, error) {
	if info == nil || directory && info.Mode() != os.ModeDir|0700 || !directory && (info.Mode() != 0600 || info.Size() <= 0 || info.Size() > 64<<10) {
		return "", errors.New("original private custody protection or bound differs")
	}
	v := reflect.ValueOf(info.Sys())
	if v.Kind() != reflect.Pointer || v.IsNil() {
		return "", errors.New("original custody metadata unavailable")
	}
	v = v.Elem()
	if v.Kind() != reflect.Struct {
		return "", errors.New("original custody metadata unavailable")
	}
	fields := make([]uint64, 0, 5)
	for _, name := range []string{"Dev", "Ino", "Uid", "Gid", "Nlink"} {
		field := v.FieldByName(name)
		if field.IsValid() && field.CanUint() {
			fields = append(fields, field.Uint())
		} else if field.IsValid() && field.CanInt() && field.Int() >= 0 {
			fields = append(fields, uint64(field.Int()))
		} else {
			return "", errors.New("original custody identity unavailable")
		}
	}
	if fields[2] != uint64(os.Geteuid()) || !directory && fields[4] != 1 {
		return "", errors.New("original custody owner or link count differs")
	}
	for _, name := range []string{"Ctim", "Ctimespec"} {
		stamp := v.FieldByName(name)
		if stamp.IsValid() && stamp.Kind() == reflect.Struct {
			sec, nsec := stamp.FieldByName("Sec"), stamp.FieldByName("Nsec")
			if sec.IsValid() && nsec.IsValid() && sec.CanInt() && nsec.CanInt() {
				return fmt.Sprintf("%v/%d/%d/%d/%d/%d", fields, info.Mode(), info.Size(), info.ModTime().UnixNano(), sec.Int(), nsec.Int()), nil
			}
		}
	}
	return "", errors.New("original custody nanosecond change identity unavailable")
}

func openKeycheckCustody(path string, directory bool) (_ *keycheckCustodyInput, resultErr error) {
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	identity, err := keycheckCustodyIdentity(before, directory)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	input := &keycheckCustodyInput{path: path, file: f, info: before, identity: identity, directory: directory}
	defer func() {
		if resultErr != nil {
			resultErr = errors.Join(resultErr, f.Close())
		}
	}()
	if err = input.checkIdentity(); err != nil {
		return nil, err
	}
	if !directory {
		input.digest, err = input.hash()
		if err != nil {
			return nil, err
		}
	}
	if err = input.checkIdentity(); err != nil {
		return nil, err
	}
	return input, nil
}

func (input *keycheckCustodyInput) checkIdentity() error {
	held, err := input.file.Stat()
	current, pathErr := os.Lstat(input.path)
	if err != nil || pathErr != nil || !os.SameFile(input.info, held) || !os.SameFile(input.info, current) {
		return errors.New("original custody file identity changed")
	}
	for _, info := range []os.FileInfo{held, current} {
		identity, err := keycheckCustodyIdentity(info, input.directory)
		if err != nil || identity != input.identity {
			return errors.New("original custody metadata changed")
		}
	}
	return nil
}

func (input *keycheckCustodyInput) hash() ([sha256.Size]byte, error) {
	var empty [sha256.Size]byte
	if _, err := input.file.Seek(0, io.SeekStart); err != nil {
		return empty, err
	}
	raw, err := io.ReadAll(io.LimitReader(input.file, (64<<10)+1))
	defer clear(raw)
	if err != nil || len(raw) != int(input.info.Size()) {
		return empty, errors.New("original custody bytes changed or exceed the bound")
	}
	return sha256.Sum256(raw), nil
}

func (input *keycheckCustodyInput) unchanged() error {
	if err := input.checkIdentity(); err != nil {
		return err
	}
	if !input.directory {
		digest, err := input.hash()
		if err != nil || digest != input.digest {
			return errors.New("original custody bytes changed")
		}
	}
	return input.checkIdentity()
}

func main() { os.Exit(runKeyCheck(os.Args[1:], os.Stdout, os.Stderr)) }

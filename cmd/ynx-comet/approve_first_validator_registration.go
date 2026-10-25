package main

import (
	"bytes"
	stded25519 "crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/privval"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/spf13/cobra"
)

// These fields are the original key-init public record. No vault, recovery
// credential, signer state or pathname supplied by this record is opened.
type firstApprovalPaths struct {
	Directory    string `json:"directory"`
	Marker       string `json:"marker"`
	Vault        string `json:"vault"`
	Binding      string `json:"binding"`
	State        string `json:"state"`
	PublicRecord string `json:"publicRecord"`
}

type firstApprovalRecord struct {
	Format      string                          `json:"format"`
	Status      string                          `json:"status"`
	Paths       firstApprovalPaths              `json:"paths"`
	Binding     ynxconsensusauth.HostKeyBinding `json:"binding"`
	IntentWire  []byte                          `json:"registrationIntentWire"`
	PossessionA []byte                          `json:"possessionMLDSA87"`
	PossessionB []byte                          `json:"possessionSLHDSASHA2256f"`
	FileSHA256  map[string]string               `json:"fileSha256"`
}

type firstApprovalFlags struct {
	record, recordHash, genesis, genesisHash, directory, keyFD string
}

type firstApprovalResult struct {
	Version             string `json:"version"`
	PublicRecordSHA256  string `json:"publicRecordSHA256"`
	GenesisSHA256       string `json:"genesisSHA256"`
	ChainID             string `json:"chainId"`
	ValidatorAddress    string `json:"validatorAddress"`
	ApprovedAt          string `json:"approvedAt"`
	EffectiveAt         string `json:"effectiveAt"`
	RegistrationFile    string `json:"registrationFile"`
	RegistrationSHA256  string `json:"registrationSHA256"`
	OperationHash       string `json:"operationHash"`
	ABCIHash            string `json:"abciHash"`
	AuthorizationSigned bool   `json:"authorizationSigned"`
	Broadcast           bool   `json:"broadcast"`
	Committed           bool   `json:"committed"`
	PQActivated         bool   `json:"pqActivated"`
}

// This signs only the fixed FIRST-registration authority domain, after both
// possession proofs and the original genesis member have been checked. It is
// deliberately separate from the consensus H/R/S signer and never loads or
// resets its state. The old key is accepted only through an inherited FD.
func newApproveFirstValidatorRegistrationCommand() *cobra.Command {
	var options firstApprovalFlags
	command := &cobra.Command{
		Use: "approve-first-validator-registration", Short: "Approve one pinned first PQ validator registration with the original validator key",
		Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(command *cobra.Command, _ []string) error {
			return runApproveFirstValidatorRegistration(command.OutOrStdout(), options)
		},
	}
	for _, flag := range []struct {
		name, help string
		target     *string
	}{
		{"public-record", "original key-init public record, never private material", &options.record},
		{"public-record-sha256", "independent exact public record SHA256", &options.recordHash},
		{"consensus-genesis", "exact original Comet genesis JSON", &options.genesis},
		{"consensus-genesis-sha256", "independent exact original genesis SHA256", &options.genesisHash},
		{"approval-directory", "new exclusive directory under an existing private parent", &options.directory},
		{"legacy-key-fd", "inherited descriptor >=3 of the existing private FilePVKey; never a key argument", &options.keyFD},
	} {
		command.Flags().Var(&initializationStringFlag{target: flag.target}, flag.name, flag.help)
		if err := command.MarkFlagRequired(flag.name); err != nil {
			panic(err)
		}
	}
	return command
}

func firstApprovalSHA(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func firstApprovalInput(path, pin string, maximum int64) ([]byte, error) {
	raw, err := readInitializationInput(path, maximum)
	if err != nil {
		return nil, err
	}
	if len(pin) != 64 || firstApprovalSHA(raw) != pin {
		return nil, errors.New("first-registration input differs from independent exact SHA256")
	}
	return raw, nil
}

func validateFirstApprovalRecord(record firstApprovalRecord, genesis []byte) (ynxconsensusauth.RegistrationIntent, error) {
	var zero ynxconsensusauth.RegistrationIntent
	i, err := ynxconsensusauth.DecodeRegistrationIntent(record.IntentWire)
	if err != nil {
		return zero, err
	}
	if record.Format != "YNX-CONSENSUS-PQ-CEREMONY-PUBLIC/v1" || record.Status != "new_epoch_files_durable_registration_not_authorized" || i.Kind != ynxconsensusauth.RegisterValidator {
		return zero, errors.New("only the original new-epoch FIRST-registration public record can be approved")
	}
	if err := record.Binding.Validate(); err != nil {
		return zero, err
	}
	b := record.Binding
	hash := sha256.Sum256(genesis)
	if !bytes.Equal(i.GenesisID, hash[:]) || !bytes.Equal(b.Policy.GenesisID, i.GenesisID) || b.Policy.ChainID != i.ChainID || !bytes.Equal(b.ValidatorAddress, i.ValidatorAddress) || b.Epoch != i.Epoch || b.Policy.ActivationHeight < i.EffectiveAt || b.SignerStatePath != record.Paths.State || !bytes.Equal(b.MLDSA87PublicKey, i.MLDSA87PublicKey) || !bytes.Equal(b.SLHDSASHA2256fPublicKey, i.SLHDSASHA2256fPublicKey) {
		return zero, errors.New("public record has different complete genesis, epoch, new pair or host binding")
	}
	var doc cmttypes.GenesisDoc
	if cmtjson.Unmarshal(genesis, &doc) != nil || doc.ChainID != i.ChainID || doc.InitialHeight <= 0 || i.ApprovedAt < doc.InitialHeight || doc.GenesisTime.IsZero() || doc.ConsensusParams == nil || doc.ConsensusParams.ValidateBasic() != nil || len(doc.Validators) == 0 || len(doc.ConsensusParams.Validator.PubKeyTypes) != 1 || doc.ConsensusParams.Validator.PubKeyTypes[0] != ed25519.KeyType {
		return zero, errors.New("original genesis has different or incomplete Ed25519 chain parameters")
	}
	found := false
	seen := make(map[string]bool, len(doc.Validators))
	for _, member := range doc.Validators {
		pub, ok := member.PubKey.(ed25519.PubKey)
		if !ok || len(pub) != ed25519.PubKeySize || member.Power <= 0 || !bytes.Equal(member.Address, pub.Address()) || seen[string(member.Address)] {
			return zero, errors.New("original genesis has invalid or duplicate validator identity")
		}
		seen[string(member.Address)] = true
		if bytes.Equal(member.Address, i.ValidatorAddress) {
			found = bytes.Equal(pub, i.LegacyEd25519PublicKey)
		}
	}
	if !found {
		return zero, errors.New("first-registration authority is absent from pinned original genesis")
	}
	if len(record.PossessionA) != ynxconsensusauth.MLDSA87SignatureSize || len(record.PossessionB) != ynxconsensusauth.SLHDSASHA2256fSignatureSize {
		return zero, errors.New("new pair requires both complete possession signatures")
	}
	message, err := i.PossessionSigningBytes()
	if err != nil {
		return zero, err
	}
	provider := ynxconsensusauth.CIRCLProvider{}
	errA := provider.VerifyMLDSA87(bytes.Clone(i.MLDSA87PublicKey), bytes.Clone(message), bytes.Clone(record.PossessionA))
	errB := provider.VerifySLHDSASHA2256f(bytes.Clone(i.SLHDSASHA2256fPublicKey), bytes.Clone(message), bytes.Clone(record.PossessionB))
	if errors.Join(errA, errB) != nil {
		return zero, errors.New("new validator pair possession verification failed")
	}
	return i, nil
}

func reserveFirstApprovalDirectory(path string) error {
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("approval directory must be canonical and absolute")
	}
	parent := filepath.Dir(path)
	real, err := filepath.EvalSymlinks(parent)
	if err != nil || real != parent {
		return errors.New("approval parent must not alias another path")
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return errors.New("approval requires an existing private 0700 parent")
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		return errors.New("approval attempt already exists or is uncertain; reconcile its original files")
	}
	if err := os.Mkdir(path, 0700); err != nil {
		return err
	}
	return syncFirstApprovalDirectory(parent)
}

func syncFirstApprovalDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(f.Sync(), f.Close())
}

func writeFirstApprovalExclusive(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	n, writeErr := f.Write(raw)
	if n != len(raw) && writeErr == nil {
		writeErr = io.ErrShortWrite
	}
	err = errors.Join(writeErr, f.Sync(), f.Close())
	if err != nil {
		return err
	}
	return syncFirstApprovalDirectory(filepath.Dir(path))
}

func readFirstApprovalLegacyKey(file *os.File, expected ynxconsensusauth.RegistrationIntent) (ed25519.PrivKey, error) {
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() <= 0 || info.Size() > 8192 {
		return nil, errors.New("inherited original key must be an existing bounded private 0600 regular file")
	}
	raw, err := io.ReadAll(io.LimitReader(file, 8193))
	defer clear(raw)
	if err != nil || int64(len(raw)) != info.Size() {
		return nil, errors.New("cannot read exact original private key descriptor")
	}
	var key privval.FilePVKey
	if cmtjson.Unmarshal(raw, &key) != nil {
		return nil, errors.New("invalid original FilePVKey")
	}
	private, ok := key.PrivKey.(ed25519.PrivKey)
	if !ok {
		return nil, errors.New("first registration requires original Ed25519 private custody")
	}
	defer clear(private)
	public, ok := key.PubKey.(ed25519.PubKey)
	canonical, err := cmtjson.Marshal(key)
	defer clear(canonical)
	var compact bytes.Buffer
	defer func() { clear(compact.Bytes()) }()
	if err != nil || json.Compact(&compact, raw) != nil || !bytes.Equal(compact.Bytes(), canonical) || len(private) != ed25519.PrivateKeySize || !ok || len(public) != ed25519.PubKeySize || !bytes.Equal(public, expected.LegacyEd25519PublicKey) || !bytes.Equal(key.Address, expected.ValidatorAddress) || !bytes.Equal(public.Address(), expected.ValidatorAddress) {
		return nil, errors.New("original private key differs from exact pinned validator authority")
	}
	derived := stded25519.NewKeyFromSeed(private[:stded25519.SeedSize])
	defer clear(derived)
	if !bytes.Equal(private, derived) {
		return nil, errors.New("original private key seed and public half differ")
	}
	after, err := file.Stat()
	if err != nil || !os.SameFile(info, after) || info.Size() != after.Size() || !info.ModTime().Equal(after.ModTime()) {
		return nil, errors.New("original key changed while reading")
	}
	return bytes.Clone(private), nil
}

func runApproveFirstValidatorRegistration(output io.Writer, options firstApprovalFlags) error {
	fd, err := strconv.Atoi(options.keyFD)
	if err != nil || fd < 3 || strconv.Itoa(fd) != options.keyFD {
		return errors.New("legacy-key-fd must be one canonical inherited descriptor >=3")
	}
	keyFile := os.NewFile(uintptr(fd), "original-first-registration-authority")
	if keyFile == nil {
		return errors.New("original key descriptor unavailable")
	}
	defer keyFile.Close()
	rawRecord, err := firstApprovalInput(options.record, options.recordHash, 256<<10)
	if err != nil {
		return err
	}
	genesis, err := firstApprovalInput(options.genesis, options.genesisHash, 64<<20)
	if err != nil {
		return err
	}
	var record firstApprovalRecord
	if err := decodeStrict(rawRecord, &record); err != nil {
		return err
	}
	i, err := validateFirstApprovalRecord(record, genesis)
	if err != nil {
		return err
	}
	if err := reserveFirstApprovalDirectory(options.directory); err != nil {
		return err
	}
	retained := func(err error) error {
		return fmt.Errorf("first-registration approval attempt retained; inspect original approval directory and do not automatically retry: %w", err)
	}
	intent, err := json.Marshal(struct {
		Version            string `json:"version"`
		PublicRecordSHA256 string `json:"publicRecordSHA256"`
		GenesisSHA256      string `json:"genesisSHA256"`
		IntentWire         []byte `json:"registrationIntentWire"`
	}{"YNX-FIRST-VALIDATOR-APPROVAL-INTENT/v1", options.recordHash, options.genesisHash, record.IntentWire})
	if err != nil {
		return retained(err)
	}
	if err := writeFirstApprovalExclusive(filepath.Join(options.directory, "intent.json"), intent); err != nil {
		return retained(err)
	}
	private, err := readFirstApprovalLegacyKey(keyFile, i)
	if err != nil {
		return retained(err)
	}
	defer clear(private)
	message, err := i.AuthoritySigningBytes()
	if err != nil {
		return retained(err)
	}
	signature, err := private.Sign(message)
	if err != nil || !ed25519.PubKey(i.LegacyEd25519PublicKey).VerifySignature(message, signature) {
		return retained(errors.New("original validator authority signature failed"))
	}
	wire, err := (ynxconsensusauth.Registration{Intent: i, LegacyApproval: signature, PossessionMLDSA87: record.PossessionA, PossessionSLHDSASHA2256f: record.PossessionB}).MarshalBinary()
	if err != nil {
		return retained(err)
	}
	// Use the actual ABCI encoder as the final closed-shape admission gate.
	payload, err := consensus.EncodeValidatorRegistryTransaction(wire)
	if err != nil {
		return retained(err)
	}
	operation, err := ynxconsensusauth.RegistrationHash(wire)
	if err != nil {
		return retained(err)
	}
	wirePath := filepath.Join(options.directory, "registration.wire")
	if err := writeFirstApprovalExclusive(wirePath, wire); err != nil {
		return retained(err)
	}
	result := firstApprovalResult{Version: "YNX-FIRST-VALIDATOR-APPROVAL/v1", PublicRecordSHA256: options.recordHash, GenesisSHA256: options.genesisHash, ChainID: i.ChainID, ValidatorAddress: hex.EncodeToString(i.ValidatorAddress), ApprovedAt: strconv.FormatInt(i.ApprovedAt, 10), EffectiveAt: strconv.FormatInt(i.EffectiveAt, 10), RegistrationFile: wirePath, RegistrationSHA256: firstApprovalSHA(wire), OperationHash: "0x" + hex.EncodeToString(operation[:]), ABCIHash: "0x" + firstApprovalSHA(payload), AuthorizationSigned: true}
	rawResult, err := json.Marshal(result)
	if err != nil {
		return retained(err)
	}
	if err := writeFirstApprovalExclusive(filepath.Join(options.directory, "result.json"), rawResult); err != nil {
		return retained(err)
	}
	response := append(rawResult, '\n')
	if n, err := output.Write(response); err != nil || n != len(response) {
		return retained(errors.New("approval result delivery failed"))
	}
	return nil
}

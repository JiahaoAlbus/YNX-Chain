package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/spf13/cobra"
)

func executeRegistrationEncoding(args []string) ([]byte, error) {
	var output bytes.Buffer
	root := &cobra.Command{Use: "ynx-comet", SilenceErrors: true, SilenceUsage: true, PersistentPreRunE: func(*cobra.Command, []string) error { return errors.New("encoder entered runtime configuration") }}
	root.AddCommand(newEncodeValidatorRegistrationCommand())
	root.SetArgs(args)
	root.SetOut(&output)
	root.SetErr(&output)
	err := root.Execute()
	return output.Bytes(), err
}

func TestEncodeValidatorRegistrationNormalApprovalWireCanonicalPayload(t *testing.T) {
	f := newFirstApprovalFixture(t)
	o := f.options
	o.keyFD = firstApprovalFD(t, f.key)
	var approved bytes.Buffer
	if err := executeFirstApproval(firstApprovalArguments(o), &approved); err != nil {
		t.Fatal(err)
	}
	var approval firstApprovalResult
	if err := json.Unmarshal(approved.Bytes(), &approval); err != nil {
		t.Fatal(err)
	}
	wire, err := os.ReadFile(approval.RegistrationFile)
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"encode-validator-registration", "--wire", approval.RegistrationFile, "--wire-sha256", approval.RegistrationSHA256}
	output, err := executeRegistrationEncoding(args)
	if err != nil {
		t.Fatal(string(output), err)
	}
	var result validatorRegistrationEncoding
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatal(err)
	}
	payload, err := base64.StdEncoding.DecodeString(result.PayloadBase64)
	if err != nil {
		t.Fatal(err)
	}
	want, err := consensus.EncodeValidatorRegistryTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	operation, err := ynxconsensusauth.RegistrationHash(wire)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(payload)
	if result.Version != "YNX-VALIDATOR-REGISTRATION-ENCODING/v1" || !result.Encoded || result.RegistrationAuthorized || result.ABCIHash != "0x"+hex.EncodeToString(digest[:]) || result.OperationHash != "0x"+hex.EncodeToString(operation[:]) || result.WireSHA256 != approval.RegistrationSHA256 || !bytes.Equal(payload, want) || result.ChainID != approval.ChainID || result.ValidatorAddress != approval.ValidatorAddress || result.ApprovedAt != 10 || result.EffectiveAt != 12 {
		t.Fatal("normal encoder changed complete approved wire or granted registration authority", result)
	}
	again, err := os.ReadFile(approval.RegistrationFile)
	if err != nil || !bytes.Equal(wire, again) {
		t.Fatal("read-only encoder changed approved source", err)
	}
	assertFirstApprovalOriginals(t, f)
	for _, kind := range []string{"wrong-pin", "duplicate-pin", "symlink", "trailing-wire", "missing-pin", "unknown-option"} {
		t.Run(kind, func(t *testing.T) {
			negative := append([]string(nil), args...)
			switch kind {
			case "wrong-pin":
				negative[4] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
			case "duplicate-pin":
				negative = append(negative, "--wire-sha256", approval.RegistrationSHA256)
			case "symlink":
				alias := filepath.Join(t.TempDir(), "wire")
				if err := os.Symlink(approval.RegistrationFile, alias); err != nil {
					t.Fatal(err)
				}
				negative[2] = alias
			case "trailing-wire":
				bad := filepath.Join(t.TempDir(), "wire")
				raw := append(bytes.Clone(wire), 0)
				if err := os.WriteFile(bad, raw, 0o600); err != nil {
					t.Fatal(err)
				}
				sum := sha256.Sum256(raw)
				negative[2], negative[4] = bad, hex.EncodeToString(sum[:])
			case "missing-pin":
				negative = negative[:3]
			case "unknown-option":
				negative = append(negative, "--authorize-registration", "true")
			}
			if output, err := executeRegistrationEncoding(negative); err == nil {
				t.Fatal("unsafe encoding input accepted", kind, string(output))
			}
			assertFirstApprovalOriginals(t, f)
		})
	}
}

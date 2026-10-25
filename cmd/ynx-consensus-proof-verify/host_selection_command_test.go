//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestProofHostSelectionCommandExactFlagsAndClosedRequest(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalog.json")
	pin := strings.Repeat("ab", 32)
	args := []string{"--host-source-catalog", path, "--host-source-catalog-sha256", pin}
	if _, err := parseHostSelectionOptions(args); err != nil {
		t.Fatal(err)
	}
	for _, bad := range [][]string{args[:2], append(append([]string{}, args...), "--host-source-catalog", path), append(append([]string{}, args...), "--host-trust-source", path), append(append([]string{}, args...), "--trust-context", path), append(append([]string{}, args...), "--current", "true"), append(append([]string{}, args...), "--rpc", "https://peer.invalid")} {
		input := &observedInput{}
		var out bytes.Buffer
		if run(bad, input, &out, time.Now) != 1 || input.reads != 0 {
			t.Fatal("untrusted/duplicate/mixed flags selected a source or read input")
		}
		assertProofFailure(t, out.Bytes(), "INVALID_ARGUMENTS")
	}
	request := consensus.ProofHostSourceSelectionRequest{Version: consensus.ProofHostSourceSelectionRequestVersion, OperationID: "original-operation", Account: "0x" + strings.Repeat("a", 40), NetworkID: strings.Repeat("b", 64), TransactionHash: strings.Repeat("c", 64), NativeWireHash: strings.Repeat("d", 64)}
	raw, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range [][]byte{append([]byte(`{"sourcePath":"/renderer",`), raw[1:]...), append([]byte(`{"current":true,`), raw[1:]...), bytes.Replace(raw, []byte(`"version":`), []byte(`"version":"other","version":`), 1), append(bytes.Clone(raw), []byte(`{}`)...), bytes.Repeat([]byte("x"), consensus.MaxProofHostSourceSelectionRequestBytes+1)} {
		var out bytes.Buffer
		if run(args, bytes.NewReader(bad), &out, time.Now) != 1 {
			t.Fatal("invalid selection request succeeded")
		}
		var got map[string]json.RawMessage
		if json.Unmarshal(out.Bytes(), &got) != nil || got["sourcePath"] != nil || got["sourceSha256"] != nil || got["sourceId"] != nil || got["epoch"] != nil {
			t.Fatal("failed selection emitted any success DATA")
		}
	}
	if isHostSourceSelectionInvocation([]string{"--host-trust-source", path, "--host-trust-source-sha256", pin}) || isHostSourceSelectionInvocation([]string{"--trust-context", path, "--trust-context-sha256", pin}) {
		t.Fatal("normal acquire/current or verifier dispatch was hijacked")
	}
}

func TestProofHostSelectionNormalCommandRetainedFixture(t *testing.T) {
	root := os.Getenv("YNX_PROOF_HOST_SOURCE_FIXTURE_OUT")
	if root == "" {
		t.Skip("requires preceding normal register CLI with original retained ledger; this skip is not selection evidence")
	}
	dir := filepath.Join(root, "source-selection")
	rawReceipt, err := os.ReadFile(filepath.Join(dir, "registration.json"))
	if err != nil {
		t.Fatal("normal SourceOwner registration must precede selection", err)
	}
	var receipt consensus.ProofHostSourceCatalogReceipt
	if err := strictJSON(rawReceipt, &receipt); err != nil {
		t.Fatal(err)
	}
	request, err := os.ReadFile(filepath.Join(dir, "request.json"))
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"--host-source-catalog", receipt.CatalogPath, "--host-source-catalog-sha256", receipt.CatalogSHA256}
	var out bytes.Buffer
	if run(args, bytes.NewReader(request), &out, func() time.Time {
		t.Fatal("selection must not qualify trust or invent a current clock")
		return time.Time{}
	}) != 0 {
		t.Fatal("normal registered original source selection failed", out.String())
	}
	var selected consensus.ProofHostSourceSelection
	var fields map[string]json.RawMessage
	if strictStringObject(out.Bytes(), &selected) != nil || json.Unmarshal(out.Bytes(), &fields) != nil || len(fields) != 4 || selected.SourcePath == "" || selected.SourceSHA256 == "" || selected.SourceID == "" || selected.Epoch == "" {
		t.Fatal("selector did not emit the exact four DATA strings")
	}
	var expected consensus.ProofHostSourceSelectionRequest
	if strictStringObject(request, &expected) != nil {
		t.Fatal("retained request lost exact transaction identity")
	}
	// Selection does not replace the normal Host. Reuse its real current check
	// and full transaction expectation before calling anything proof-related.
	ref, err := acquireProofHost(selected.SourcePath, selected.SourceSHA256, time.Now)
	if err != nil {
		t.Fatal("normal original acquire rejected selected DATA", err)
	}
	current, err := ref.Current()
	if err != nil || current.SourceID != selected.SourceID || current.Epoch != selected.Epoch || current.ExpectedTransaction == nil || current.ExpectedTransaction.TransactionHash != expected.TransactionHash || current.ExpectedTransaction.NativeWireHash != expected.NativeWireHash || current.NativeRootAuthorized || current.SourceDeploymentQualified || current.ProofVerified {
		t.Fatal("selection changed original Host expectation or conferred authority", err)
	}
	// Revoke only the normal opaque reference. Never rewrite shared original
	// source/lifecycle bytes, repair expired material, or update its epoch.
	ref.Revoke()
	if _, err := ref.Current(); err == nil {
		t.Fatal("normal opaque Host revocation stopped blocking current")
	}
	var later bytes.Buffer
	if run(args, bytes.NewReader(request), &later, time.Now) != 0 {
		t.Fatal("DATA selection unexpectedly impersonated lifecycle authority")
	}
	var selectedAgain consensus.ProofHostSourceSelection
	if strictStringObject(later.Bytes(), &selectedAgain) != nil || !reflect.DeepEqual(selectedAgain, selected) {
		t.Fatal("selector replaced revoked source or epoch with alternate DATA")
	}
	if _, err := ref.Current(); err == nil {
		t.Fatal("selecting DATA revived an already revoked normal opaque Host")
	}
	if err := ref.Close(); err != nil {
		t.Fatal(err)
	}
	t.Log("PROOF_HOST_SOURCE_SELECTED_DATA_ONLY exact4=true normalAcquireCurrent=true revocationUnchanged=true RootGrant=false")
}

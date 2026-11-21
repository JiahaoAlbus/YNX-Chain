//go:build unix

package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestPQLabEnrollmentOriginalCommandColdRecoveryAndRefusals(t *testing.T) {
	created, pin, height, appHash := pqLabSenderCommandFixture(t, true)
	root := created.Plan.RootDir
	fd, err := os.Open(filepath.Join(root, "workload", "private-senders", "recovery.raw"))
	if err != nil {
		t.Fatal(err)
	}
	defer fd.Close()
	credential, err := os.ReadFile(fd.Name())
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	sender, err := consensus.OpenPQLabSender(filepath.Join(root, "workload"), pin, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint, err := consensus.LoadPQLabSenderCheckpoint(root, created.PlanSHA256, "", height, appHash)
	if err != nil {
		t.Fatal(err)
	}
	classic, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	defer classic.Zero()
	owner, err := consensus.NativeAddress(classic.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	key, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	request := consensus.PQLabEnrollmentRequest{Version: "YNX-PQ-LAB-ENROLLMENT-REQUEST/v1", FundingOperationID: strings.Repeat("a", 64), MigrationOperationID: strings.Repeat("b", 64), OwnerIndex: 0, FundingNonce: 2, TargetOwner: owner, FundingAmount: 3, ActivationHeight: uint64(height + 2), PKA: pub.PKA, PKB: pub.PKB}
	original, err := sender.SignPQLabEnrollmentOriginals(request, checkpoint, classic, key)
	if err != nil {
		t.Fatal(err)
	}
	if err = sender.Close(); err != nil {
		t.Fatal(err)
	}
	args := []string{"--synthetic", "--root", root, "--plan-sha256", created.PlanSHA256, "--workload-sha256", pin, "--owner", "0", "--credential-fd", strconv.Itoa(int(fd.Fd()))}
	requestRaw, _ := json.Marshal(request)
	requestDigest := sha256.Sum256(requestRaw)
	command := pqLabEnrollmentOriginalCommand{Version: "YNX-PQ-LAB-ENROLLMENT-COMMAND/v1", Operation: "recover", Request: request, RequestSHA256: hex.EncodeToString(requestDigest[:])}
	raw, _ := json.Marshal(command)
	var out bytes.Buffer
	readEnd, writeEnd, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	priorStdin := os.Stdin
	defer func() { os.Stdin = priorStdin }()
	os.Stdin = readEnd
	writerDone := make(chan error, 1)
	go func() { _, e := writeEnd.Write(raw); writerDone <- errors.Join(e, writeEnd.Close()) }()
	err = run(append([]string{"enrollment-original"}, args...), &out)
	os.Stdin = priorStdin
	if closeErr := readEnd.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	if writeErr := <-writerDone; writeErr != nil {
		t.Fatal(writeErr)
	}
	if err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Version, Code, CurrentEligibility, RequestSHA256, FundingOperationID, MigrationOperationID string
		SyntheticOnly, AuthorityGranted                                                            bool
		Result                                                                                     consensus.PQLabEnrollmentOriginalResult
	}
	if err = json.Unmarshal(out.Bytes(), &reply); err != nil || reply.Code != "ORIGINAL_RECOVERED" || reply.CurrentEligibility != "UNKNOWN" || reply.RequestSHA256 != command.RequestSHA256 || reply.FundingOperationID != request.FundingOperationID || reply.MigrationOperationID != request.MigrationOperationID || !reply.SyntheticOnly || reply.AuthorityGranted || !reflect.DeepEqual(reply.Result, original) {
		t.Fatal("original recovery changed", err, out.String())
	}
	if err = runPQLabEnrollmentOriginal(args, bytes.NewReader(raw), pqLabBrokenWorkloadOutput{}); err == nil {
		t.Fatal("broken stdout reported delivery success")
	}
	// No branch may regenerate keys, sign, or replace either UNKNOWN operation.
	for _, mode := range []string{"changed nonce", "unknown id", "repinned wrong migration id", "missing request hash", "sign unavailable", "extra recover material", "confirm without materials", "external proof path"} {
		t.Run(mode, func(t *testing.T) {
			bad := command
			switch mode {
			case "changed nonce":
				bad.Request.FundingNonce++
			case "unknown id":
				bad.Request.FundingOperationID = strings.Repeat("c", 64)
			case "repinned wrong migration id":
				bad.Request.MigrationOperationID = strings.Repeat("c", 64)
				changed, _ := json.Marshal(bad.Request)
				digest := sha256.Sum256(changed)
				bad.RequestSHA256 = hex.EncodeToString(digest[:])
			case "missing request hash":
				bad.RequestSHA256 = ""
			case "sign unavailable":
				bad.Operation = "sign"
			case "extra recover material":
				bad.FundingProofFile = filepath.Join(root, "fake")
			case "confirm without materials":
				bad.Operation = "confirm"
			case "external proof path":
				bad.Operation = "confirm"
				bad.FundingMaterialsFile = "/outside/lab"
				bad.FundingProofFile = "/outside/lab"
				bad.FundingMaterialsSHA256 = strings.Repeat("1", 64)
			}
			b, _ := json.Marshal(bad)
			var result bytes.Buffer
			err := runPQLabEnrollmentOriginal(args, bytes.NewReader(b), &result)
			if mode == "sign unavailable" || mode == "extra recover material" {
				if err == nil || result.Len() != 0 {
					t.Fatal("unsupported command accepted", err, result.String())
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var r pqLabEnrollmentOriginalReply
			if json.Unmarshal(result.Bytes(), &r) != nil || r.Result != nil || r.AuthorityGranted || r.CurrentEligibility != "UNKNOWN" || r.FundingOperationID != "" || r.MigrationOperationID != "" {
				t.Fatal("invalid input produced authority", result.String())
			}
			if mode == "changed nonce" || mode == "unknown id" || mode == "repinned wrong migration id" || mode == "missing request hash" || mode == "confirm without materials" || mode == "external proof path" {
				if r.Code != "UNKNOWN" {
					t.Fatal("original unknown lost", result.String())
				}
				if strings.HasPrefix(mode, "confirm") || mode == "external proof path" {
					if r.FailureStage != "funding-proof-input" {
						t.Fatal("first failing stage not retained", result.String())
					}
				}
			} else if r.Code != "REJECTED" {
				t.Fatal("invalid proof accepted", result.String())
			}
		})
	}
	wrong := append([]string(nil), args...)
	wrong[4] = strings.Repeat("1", 64)
	out.Reset()
	if err = runPQLabEnrollmentOriginal(wrong, bytes.NewReader(raw), &out); err == nil || out.Len() != 0 {
		t.Fatal("wrong plan pin accepted", err, out.String())
	}
	beforePath := filepath.Join(root, "workload", "sender-public", "0000", request.FundingOperationID, "transaction.abci")
	before, err := os.ReadFile(beforePath)
	if err != nil {
		t.Fatal(err)
	}
	out.Reset()
	if err = runPQLabEnrollmentOriginal(args, bytes.NewReader(raw), &out); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(beforePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("read-only recovery changed original", err)
	}
}

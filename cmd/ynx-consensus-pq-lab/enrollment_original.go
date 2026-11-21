//go:build unix

package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// This is deliberately not a signing or broadcasting interface: the original
// target-account custody/FD source does not exist in the current workload.
type pqLabEnrollmentOriginalCommand struct {
	Version                  string                           `json:"version"`
	Operation                string                           `json:"operation"`
	Request                  consensus.PQLabEnrollmentRequest `json:"request"`
	RequestSHA256            string                           `json:"requestSHA256"`
	FundingMaterialsFile     string                           `json:"fundingMaterialsFile"`
	FundingMaterialsSHA256   string                           `json:"fundingMaterialsSHA256"`
	FundingProofFile         string                           `json:"fundingProofFile"`
	MigrationMaterialsFile   string                           `json:"migrationMaterialsFile"`
	MigrationMaterialsSHA256 string                           `json:"migrationMaterialsSHA256"`
	MigrationProofFile       string                           `json:"migrationProofFile"`
}

type pqLabEnrollmentOriginalReply struct {
	Version              string `json:"version"`
	Code                 string `json:"code"`
	Result               any    `json:"result"`
	SyntheticOnly        bool   `json:"syntheticOnly"`
	AuthorityGranted     bool   `json:"authorityGranted"`
	CurrentEligibility   string `json:"currentEligibility"`
	RequestSHA256        string `json:"requestSHA256"`
	FundingOperationID   string `json:"fundingOperationId,omitempty"`
	MigrationOperationID string `json:"migrationOperationId,omitempty"`
	FailureStage         string `json:"failureStage,omitempty"`
	ProofFailureCode     string `json:"proofFailureCode,omitempty"`
}

// Reads only original authenticated operation records, or verifies and retains
// the two original proofs. Neither branch signs, broadcasts, picks a new nonce,
// creates a target key, or turns UNKNOWN into a successful recovery.
// The caller must select requestSHA256 from its independently retained original
// reservation; accepting a digest echoed by an untrusted peer establishes no
// provenance and does not authorize the caller to release a pending nonce.
func runPQLabEnrollmentOriginal(args []string, input io.Reader, out io.Writer) (resultErr error) {
	f := flag.NewFlagSet("ynx-consensus-pq-lab enrollment-original", flag.ContinueOnError)
	f.SetOutput(io.Discard)
	synthetic := f.Bool("synthetic", false, "explicit synthetic original only")
	root := f.String("root", "", "original lab root")
	plan := f.String("plan-sha256", "", "independently pinned original network plan")
	workload := f.String("workload-sha256", "", "independently pinned original workload")
	owner := f.Int("owner", -1, "original sender owner index")
	fd := f.Int("credential-fd", -1, "inherited original credential fd")
	if err := parsePQLabFlags(f, args); err != nil {
		return err
	}
	if !*synthetic || *root == "" || *plan == "" || *workload == "" || *owner < 0 || *fd < 3 || *fd > 4096 {
		return errors.New("original synthetic plan, workload, owner and inherited credential required")
	}
	directory := filepath.Join(*root, "workload")
	planRaw, err := readPQLabWorkloadFile(filepath.Join(*root, "network-plan.json"), 1<<20)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(planRaw)
	var originalPlan consensus.PQLabNetworkPlan
	if hex.EncodeToString(digest[:]) != *plan || json.Unmarshal(planRaw, &originalPlan) != nil {
		return errors.New("independent original lab plan pin required")
	}
	canonical, err := json.Marshal(originalPlan)
	if err != nil || !bytes.Equal(planRaw, canonical) || originalPlan.RootDir != *root || !originalPlan.SyntheticOnly || originalPlan.PublicNetwork || originalPlan.NativeChainID != consensus.PQLabNativeChainID {
		return errors.New("different original synthetic lab scope")
	}
	manifestRaw, err := readPQLabWorkloadFile(filepath.Join(directory, "PUBLIC-WORKLOAD.json"), 8<<20)
	if err != nil {
		return err
	}
	manifestDigest := sha256.Sum256(manifestRaw)
	var manifest consensus.PQLabWorkloadManifest
	if hex.EncodeToString(manifestDigest[:]) != *workload || json.Unmarshal(manifestRaw, &manifest) != nil || manifest.MigrationStateHash != originalPlan.MigrationStateHash || manifest.OriginalGenesisHash != originalPlan.OriginalGenesisHash {
		return errors.New("workload does not belong to original pinned lab")
	}
	credential, err := readPQLabSenderCredential(*fd, filepath.Join(directory, "private-senders", "recovery.raw"))
	if err != nil {
		return err
	}
	defer clear(credential)
	sender, err := consensus.OpenPQLabSender(directory, *workload, *owner, credential)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, sender.Close()) }()
	clear(credential)
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 32<<10)
	count := 0
	for scanner.Scan() {
		count++
		if count > 4*consensus.MaxPQLabTransfers+16 {
			return errors.New("bounded original command budget exhausted")
		}
		raw := scanner.Bytes()
		var cmd pqLabEnrollmentOriginalCommand
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&cmd) != nil {
			return errors.New("invalid original enrollment command")
		}
		exact, e := json.Marshal(cmd)
		if e != nil || !bytes.Equal(raw, exact) || cmd.Version != "YNX-PQ-LAB-ENROLLMENT-COMMAND/v1" || cmd.Request.OwnerIndex != *owner {
			return errors.New("exact canonical original enrollment command required")
		}
		requestRaw, e := json.Marshal(cmd.Request)
		requestDigest := sha256.Sum256(requestRaw)
		if e != nil || hex.EncodeToString(requestDigest[:]) != cmd.RequestSHA256 {
			reply := pqLabEnrollmentOriginalReply{Version: "YNX-PQ-LAB-ENROLLMENT-REPLY/v1", Code: "UNKNOWN", SyntheticOnly: true, CurrentEligibility: "UNKNOWN", FailureStage: "request-identity"}
			if e = json.NewEncoder(out).Encode(reply); e != nil {
				return e
			}
			continue
		}
		var result any
		failureStage := ""
		switch cmd.Operation {
		case "recover":
			if cmd.FundingMaterialsFile != "" || cmd.FundingMaterialsSHA256 != "" || cmd.FundingProofFile != "" || cmd.MigrationMaterialsFile != "" || cmd.MigrationMaterialsSHA256 != "" || cmd.MigrationProofFile != "" {
				return errors.New("recovery accepts only the original request")
			}
			failureStage = "original-recovery"
			result, err = sender.RecoverPQLabEnrollmentOriginals(cmd.Request)
		case "confirm":
			var fm, mm consensus.PQLabProofMaterials
			var fp, mp consensus.PQTransactionProofRequest
			failureStage = "funding-proof-input"
			fm, fp, err = readPQLabEnrollmentProof(*root, cmd.FundingMaterialsFile, cmd.FundingMaterialsSHA256, cmd.FundingProofFile)
			if err == nil {
				failureStage = "migration-proof-input"
				mm, mp, err = readPQLabEnrollmentProof(*root, cmd.MigrationMaterialsFile, cmd.MigrationMaterialsSHA256, cmd.MigrationProofFile)
			}
			if err == nil {
				failureStage = "confirmation"
				result, err = sender.ConfirmPQLabEnrollmentOriginals(cmd.Request, fm, mm, fp, mp, time.Now().UTC())
			}
		default:
			return errors.New("only original recovery or confirmation is supported")
		}
		reply := pqLabEnrollmentOriginalReply{Version: "YNX-PQ-LAB-ENROLLMENT-REPLY/v1", Code: "ORIGINAL_RECOVERED", Result: result, SyntheticOnly: true, CurrentEligibility: "UNKNOWN", RequestSHA256: cmd.RequestSHA256}
		if err != nil {
			reply.Result = nil
			reply.FailureStage = failureStage
			var proofErr *consensus.PQLightProofError
			if errors.As(err, &proofErr) {
				reply.ProofFailureCode = proofErr.Code
			}
			// Missing originals or partial confirmation must not become a
			// terminal operation or a retry/signing authorization.
			reply.Code = "UNKNOWN"
		} else if cmd.Operation == "confirm" {
			reply.Code = "PROOF_CONFIRMED_DATA"
		}
		if err == nil {
			reply.FundingOperationID = cmd.Request.FundingOperationID
			reply.MigrationOperationID = cmd.Request.MigrationOperationID
		}
		if err = json.NewEncoder(out).Encode(reply); err != nil {
			return err
		}
	}
	if err = scanner.Err(); err != nil {
		return err
	}
	if count == 0 {
		return errors.New("at least one original command required")
	}
	return nil
}

func readPQLabEnrollmentProof(root, materialPath, materialPin, proofPath string) (consensus.PQLabProofMaterials, consensus.PQTransactionProofRequest, error) {
	var m consensus.PQLabProofMaterials
	var proof consensus.PQTransactionProofRequest
	for _, path := range []string{materialPath, proofPath} {
		relative, err := filepath.Rel(root, path)
		if err != nil || !filepath.IsAbs(path) || filepath.Clean(path) != path || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return m, proof, errors.New("original public proof file must remain under lab root")
		}
		for _, part := range strings.Split(relative, string(filepath.Separator)) {
			if part == "private-senders" || part == "custody" {
				return m, proof, errors.New("private source cannot be proof input")
			}
		}
	}
	raw, err := readPQLabWorkloadFile(materialPath, consensus.MaxPQLabProofMaterialsBytes)
	if err != nil {
		return m, proof, err
	}
	m, err = consensus.DecodePQLabProofMaterials(raw, materialPin)
	if err != nil {
		return m, proof, err
	}
	raw, err = readPQLabWorkloadFile(proofPath, consensus.MaxPQTransactionProofRequestBytes)
	if err != nil {
		return m, proof, err
	}
	proof, err = consensus.DecodePQTransactionProofRequest(raw)
	return m, proof, err
}

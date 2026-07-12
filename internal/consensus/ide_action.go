package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

var (
	ideContractNamePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{2,63}$`)
	ideCalldataPattern     = regexp.MustCompile(`^0x[0-9a-f]+$`)
	ideWordPattern         = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
	ideDataPattern         = regexp.MustCompile(`^0x(?:[0-9a-f]{2})*$`)
)

type IDEContractDeployPayload struct {
	Name             string   `json:"name"`
	Source           string   `json:"source"`
	DeployedBytecode string   `json:"deployedBytecode"`
	ConstructorArgs  []string `json:"constructorArgs,omitempty"`
	IdempotencyKey   string   `json:"idempotencyKey"`
	RequestHash      string   `json:"requestHash"`
}

type IDEContractCallPayload struct {
	Address        string `json:"address"`
	Calldata       string `json:"calldata"`
	IdempotencyKey string `json:"idempotencyKey"`
	RequestHash    string `json:"requestHash"`
}

type BFTContract struct {
	Address              string            `json:"address"`
	Name                 string            `json:"name"`
	Deployer             string            `json:"deployer"`
	SourceHash           string            `json:"sourceHash"`
	DeployedBytecodeHash string            `json:"deployedBytecodeHash"`
	DeployedBytecode     string            `json:"deployedBytecode"`
	ConstructorArgs      []string          `json:"constructorArgs,omitempty"`
	RuntimeStorage       map[string]string `json:"runtimeStorage"`
	RuntimeMode          string            `json:"runtimeMode"`
	BlockHeight          int64             `json:"blockHeight"`
	TxHash               string            `json:"txHash"`
	LastUpdatedHeight    int64             `json:"lastUpdatedHeight"`
	LastCallTxHash       string            `json:"lastCallTxHash,omitempty"`
	AuditHash            string            `json:"auditHash"`
}

type BFTEVMLog struct {
	Address     string   `json:"address"`
	Topics      []string `json:"topics"`
	Data        string   `json:"data"`
	BlockHeight int64    `json:"blockHeight"`
	TxHash      string   `json:"transactionHash"`
	AuditHash   string   `json:"auditHash"`
}

type BFTEVMReceipt struct {
	TxHash          string               `json:"transactionHash"`
	From            string               `json:"from"`
	To              string               `json:"to,omitempty"`
	ContractAddress string               `json:"contractAddress,omitempty"`
	Action          string               `json:"action"`
	Status          string               `json:"status"`
	EncodedResult   string               `json:"encodedResult"`
	OpcodeStepCount int                  `json:"opcodeStepCount"`
	StorageWrites   []chain.StorageWrite `json:"storageWrites,omitempty"`
	Logs            []BFTEVMLog          `json:"logs"`
	BlockHeight     int64                `json:"blockHeight"`
	AuditHash       string               `json:"auditHash"`
}

type BFTIDEIdempotency struct {
	ID             string `json:"id"`
	Signer         string `json:"signer"`
	IdempotencyKey string `json:"idempotencyKey"`
	Action         string `json:"action"`
	RequestHash    string `json:"requestHash"`
	ObjectID       string `json:"objectId"`
	TxHash         string `json:"txHash"`
}

func isIDEAction(action string) bool {
	return action == ActionIDEContractDeploy || action == ActionIDEContractCall
}

func IDEDeployRequestHash(name, source, deployedBytecode string, constructorArgs []string, key string) string {
	doc := struct {
		Name             string   `json:"name"`
		Source           string   `json:"source"`
		DeployedBytecode string   `json:"deployedBytecode"`
		ConstructorArgs  []string `json:"constructorArgs,omitempty"`
		IdempotencyKey   string   `json:"idempotencyKey"`
	}{name, source, deployedBytecode, constructorArgs, key}
	return ideRequestHash(ActionIDEContractDeploy, doc)
}

func IDECallRequestHash(address, calldata, key string) string {
	doc := struct {
		Address        string `json:"address"`
		Calldata       string `json:"calldata"`
		IdempotencyKey string `json:"idempotencyKey"`
	}{address, calldata, key}
	return ideRequestHash(ActionIDEContractCall, doc)
}

func ideRequestHash(action string, value any) string {
	payload, _ := json.Marshal(struct {
		Domain string `json:"domain"`
		Action string `json:"action"`
		Value  any    `json:"value"`
	}{"YNX_IDE_REQUEST_V1", action, value})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func IDEIdempotencyID(signer, key string) string {
	sum := sha256.Sum256([]byte("YNX_IDE_IDEMPOTENCY_V1|" + signer + "|" + key))
	return hex.EncodeToString(sum[:])[:24]
}

func canonicalIDEActionPayload(action string, raw []byte) ([]byte, error) {
	switch action {
	case ActionIDEContractDeploy:
		var p IDEContractDeployPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Name, p.Source = strings.TrimSpace(p.Name), strings.TrimSpace(p.Source)
		p.DeployedBytecode = strings.ToLower(strings.TrimSpace(p.DeployedBytecode))
		p.IdempotencyKey, p.RequestHash = strings.TrimSpace(p.IdempotencyKey), strings.ToLower(strings.TrimSpace(p.RequestHash))
		for i := range p.ConstructorArgs {
			p.ConstructorArgs[i] = strings.TrimSpace(p.ConstructorArgs[i])
		}
		if !ideContractNamePattern.MatchString(p.Name) || len(p.Source) == 0 || len(p.Source) > 4096 || len(p.DeployedBytecode) < 4 || len(p.DeployedBytecode) > 12*1024 || len(p.ConstructorArgs) > 16 || !validResourceIdempotencyKey(p.IdempotencyKey) {
			return nil, errors.New("invalid bounded IDE contract deployment payload")
		}
		for _, arg := range p.ConstructorArgs {
			if len(arg) > 256 {
				return nil, errors.New("IDE constructor argument exceeds limit")
			}
		}
		if _, _, err := chain.ValidateBoundedPinnedContract(p.Name, p.Source, p.DeployedBytecode); err != nil {
			return nil, err
		}
		if p.RequestHash != IDEDeployRequestHash(p.Name, p.Source, p.DeployedBytecode, p.ConstructorArgs, p.IdempotencyKey) {
			return nil, errors.New("IDE deployment request hash mismatch")
		}
		return json.Marshal(p)
	case ActionIDEContractCall:
		var p IDEContractCallPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Address, p.Calldata = strings.ToLower(strings.TrimSpace(p.Address)), strings.ToLower(strings.TrimSpace(p.Calldata))
		p.IdempotencyKey, p.RequestHash = strings.TrimSpace(p.IdempotencyKey), strings.ToLower(strings.TrimSpace(p.RequestHash))
		if !IsNativeAddress(p.Address) || !ideCalldataPattern.MatchString(p.Calldata) || len(p.Calldata) < 10 || len(p.Calldata) > 8194 || len(p.Calldata)%2 != 0 || !validResourceIdempotencyKey(p.IdempotencyKey) {
			return nil, errors.New("invalid bounded IDE contract call payload")
		}
		if p.RequestHash != IDECallRequestHash(p.Address, p.Calldata, p.IdempotencyKey) {
			return nil, errors.New("IDE contract call request hash mismatch")
		}
		return json.Marshal(p)
	default:
		return nil, fmt.Errorf("unsupported IDE action %q", action)
	}
}

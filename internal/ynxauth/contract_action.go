package ynxauth

import (
	"bytes"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	ActionContractDeploy  = "contract_deploy"
	ActionContractExecute = "contract_execute"
	ContractDeployFee     = uint64(10)
	ContractExecuteFee    = uint64(2)
	ContractCounterName   = "SampleEVMWriteCounter"
	ContractERC20Name     = "SampleYNXTCompatibleERC20"
)

// ContractDeployPayload identifies one of the two existing pinned contracts.
// Each Solidity constructor declares uint256, but the existing constructor-
// seed subset parses only uint64. That full supported range is retained without
// JSON-number or int64 narrowing; this is not arbitrary uint256 construction.
// Value is explicit and must be zero because the bounded executor does not
// implement native call-value accounting.
//
// Hashes are 64 lowercase hex characters without a prefix. CompilerConfigHash
// is a signed commitment, not trusted compiler evidence: the executor must
// compare it and both code hashes to its original, verified code material.
type ContractDeployPayload struct {
	Name, SourceHash, DeployedBytecodeHash, CompilerConfigHash string
	ConstructorArgs                                            []uint64
	Value                                                      uint64
}

// ContractExecutePayload authorizes only a bounded write on an exact contract
// identity and exact execution prestate. The executor must compare Target,
// Name, all hashes and ExpectedStorageCommitment against trusted state under
// its mutation lock, then execute Calldata with Action.Owner as the caller.
// Parsing this object or checking its hashes' spelling grants no authority.
type ContractExecutePayload struct {
	Name, Target, SourceHash, DeployedBytecodeHash, CompilerConfigHash string
	ExpectedStorageCommitment, Calldata                                string
	Value                                                              uint64
}

// Syntax deliberately contains no second copy of the execution code registry.
// Even correctly shaped hashes need comparison with trusted pinned code and
// original compiler material by the actual ledger executor.
func contractCodeIdentity(name, sourceHash, codeHash, compilerHash string) bool {
	return (name == ContractCounterName || name == ContractERC20Name) && actionHex(sourceHash, 64) && actionHex(codeHash, 64) && actionHex(compilerHash, 64)
}

func contractTarget(address string) bool {
	return len(address) == 42 && strings.HasPrefix(address, "0x") && actionHex(address[2:], 40) && address != "0x0000000000000000000000000000000000000000"
}

// Both pinned contracts expose one write method. Enforce its exact ABI shape:
// no unknown selector, dynamic offset, trailing word, nonzero address padding,
// abbreviated uint256, uppercase hex, whitespace or invalid UTF-8 can survive.
// Full 256-bit argument words are legal syntax; overflow/balance/revert checks
// remain the actual interpreter's job, never a uint64 truncation in the codec.
func contractCalldata(name, data string) bool {
	switch name {
	case ContractCounterName:
		return len(data) == 74 && strings.HasPrefix(data, "0x7cf5dab0") && actionHex(data[10:], 64)
	case ContractERC20Name:
		return len(data) == 138 && strings.HasPrefix(data, "0xa9059cbb") && actionHex(data[10:], 128) && data[10:34] == "000000000000000000000000"
	default:
		return false
	}
}

func encodeContractDeployPayload(kind string, p ContractDeployPayload) ([]byte, error) {
	if kind != ActionContractDeploy || !contractCodeIdentity(p.Name, p.SourceHash, p.DeployedBytecodeHash, p.CompilerConfigHash) || len(p.ConstructorArgs) != 1 || p.Value != 0 {
		return nil, ErrAction
	}
	f := [][]byte{[]byte(p.Name), []byte(p.SourceHash), []byte(p.DeployedBytecodeHash), []byte(p.CompilerConfigHash), ynxbatch.U32(1)}
	f = append(f, pair(p.ConstructorArgs[0])...)
	f = append(f, pair(p.Value)...)
	return ynxbatch.EncodeFields(f...)
}

func encodeContractExecutePayload(kind string, p ContractExecutePayload) ([]byte, error) {
	if kind != ActionContractExecute || !contractCodeIdentity(p.Name, p.SourceHash, p.DeployedBytecodeHash, p.CompilerConfigHash) || !contractTarget(p.Target) || !actionHex(p.ExpectedStorageCommitment, 64) || !contractCalldata(p.Name, p.Calldata) || p.Value != 0 {
		return nil, ErrAction
	}
	f := [][]byte{[]byte(p.Name), []byte(p.Target), []byte(p.SourceHash), []byte(p.DeployedBytecodeHash), []byte(p.CompilerConfigHash), []byte(p.ExpectedStorageCommitment), []byte(p.Calldata)}
	f = append(f, pair(p.Value)...)
	return ynxbatch.EncodeFields(f...)
}

func decodeContractActionPayload(kind string, wire []byte) (any, error) {
	f, err := frame(wire, 9, MaxActionPayloadBytes)
	if err != nil {
		return nil, ErrAction
	}
	r := actionReader{fields: f}
	var p any
	switch kind {
	case ActionContractDeploy:
		v := ContractDeployPayload{Name: r.text(), SourceHash: r.text(), DeployedBytecodeHash: r.text(), CompilerConfigHash: r.text()}
		if r.u32() != 1 {
			return nil, ErrAction
		}
		v.ConstructorArgs, v.Value = []uint64{r.u64()}, r.u64()
		p = v
	case ActionContractExecute:
		p = ContractExecutePayload{Name: r.text(), Target: r.text(), SourceHash: r.text(), DeployedBytecodeHash: r.text(), CompilerConfigHash: r.text(), ExpectedStorageCommitment: r.text(), Calldata: r.text(), Value: r.u64()}
	default:
		return nil, ErrAction
	}
	if r.err != nil || r.index != 9 {
		return nil, ErrAction
	}
	canonical, err := EncodeActionPayload(kind, p)
	if err != nil || !bytes.Equal(canonical, wire) {
		return nil, ErrAction
	}
	return p, nil
}

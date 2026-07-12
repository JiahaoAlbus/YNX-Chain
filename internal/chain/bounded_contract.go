package chain

import (
	"errors"
	"strings"
)

const BoundedContractRuntimeMode = "pinned-artifact-bounded-evm-subset"

type BoundedContractTransition struct {
	EncodedResult string            `json:"encodedResult"`
	StepCount     int               `json:"stepCount"`
	StorageWrites []StorageWrite    `json:"storageWrites,omitempty"`
	Logs          []ExecutionLog    `json:"logs,omitempty"`
	Storage       map[string]string `json:"storage"`
}

type boundedPinnedContractIdentity struct {
	SourceHash           string
	DeployedBytecodeHash string
}

var boundedPinnedContracts = map[string]boundedPinnedContractIdentity{
	"SampleEVMWriteCounter": {
		SourceHash:           "961d42cf02384dad28e18137d58f2b46c93dbd3a80ca078a3d96726d6d86191b",
		DeployedBytecodeHash: "bad6eaa7c1f17ed1e3073830127815b90b03ce1e0d15e113411f9ecdbb7d47a0",
	},
	"SampleYNXTCompatibleERC20": {
		SourceHash:           "344b1d80d8b2fec3d22a38aa98b28e2c6ab20429f26b6cef726da1e634cbb5c4",
		DeployedBytecodeHash: "b8604e8a14d38cff0b32d2bca4e768e7a7ea95eac231673e4ec9838c58aa7118",
	},
}

func ValidateBoundedPinnedContract(name, source, deployedBytecode string) (sourceHash, bytecodeHash string, err error) {
	name, source, deployedBytecode = strings.TrimSpace(name), strings.TrimSpace(source), normalizeHex(deployedBytecode)
	identity, ok := boundedPinnedContracts[name]
	if !ok {
		return "", "", errors.New("contract is not in the bounded pinned-artifact consensus registry")
	}
	if deployedBytecode == "0x" || len(deployedBytecode) > 12*1024 {
		return "", "", errors.New("bounded pinned deployed bytecode is missing or exceeds limit")
	}
	sourceHash = hashParts("source", source)
	bytecodeHash = hashParts("solc-deployed-bytecode", deployedBytecode)
	if sourceHash != identity.SourceHash || bytecodeHash != identity.DeployedBytecodeHash {
		return "", "", errors.New("contract source or deployed bytecode does not match the bounded pinned-artifact registry")
	}
	return sourceHash, bytecodeHash, nil
}

func ValidateBoundedPinnedIdentity(name, sourceHash, deployedBytecode string) (string, error) {
	name, sourceHash, deployedBytecode = strings.TrimSpace(name), strings.ToLower(strings.TrimSpace(sourceHash)), normalizeHex(deployedBytecode)
	identity, ok := boundedPinnedContracts[name]
	if !ok || sourceHash != identity.SourceHash {
		return "", errors.New("contract identity is not in the bounded pinned-artifact consensus registry")
	}
	bytecodeHash := hashParts("solc-deployed-bytecode", deployedBytecode)
	if bytecodeHash != identity.DeployedBytecodeHash {
		return "", errors.New("deployed bytecode does not match the bounded pinned-artifact consensus registry")
	}
	return bytecodeHash, nil
}

func BoundedContractInitialStorage(source, deployer string, constructorArgs []string) map[string]string {
	return copyRuntimeStorage(extractRuntimeStorage(strings.TrimSpace(source), evmAddressForLog(deployer), constructorArgs))
}

func ExecuteBoundedContract(deployedBytecode, calldata, caller string, storage map[string]string) (BoundedContractTransition, error) {
	transition, err := runStatefulEVMSubset(deployedBytecode, calldata, evmAddressForLog(caller), storage)
	if err != nil {
		return BoundedContractTransition{}, err
	}
	logs := append([]ExecutionLog(nil), transition.Logs...)
	return BoundedContractTransition{
		EncodedResult: transition.EncodedResult,
		StepCount:     transition.StepCount,
		StorageWrites: append([]StorageWrite(nil), transition.StorageWrites...),
		Logs:          logs,
		Storage:       copyRuntimeStorage(transition.Storage),
	}, nil
}

func CallBoundedContract(deployedBytecode, calldata string, storage map[string]string) (encoded string, steps int, err error) {
	result, err := runStaticEVMSubset(deployedBytecode, calldata, copyRuntimeStorage(storage))
	if err != nil {
		return "", 0, err
	}
	return result.EncodedResult, result.StepCount, nil
}

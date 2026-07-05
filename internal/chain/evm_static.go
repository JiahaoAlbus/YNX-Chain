package chain

import (
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

type evmStaticResult struct {
	EncodedResult string
	StepCount     int
}

func runStaticEVMSubset(deployedBytecode, callDataHex string, storage map[string]string) (evmStaticResult, error) {
	code, err := hex.DecodeString(strings.TrimPrefix(deployedBytecode, "0x"))
	if err != nil {
		return evmStaticResult{}, fmt.Errorf("decode deployed bytecode: %w", err)
	}
	callData, err := hex.DecodeString(strings.TrimPrefix(callDataHex, "0x"))
	if err != nil {
		return evmStaticResult{}, fmt.Errorf("decode calldata: %w", err)
	}
	if len(callData) < 4 {
		return evmStaticResult{}, errors.New("local EVM subset requires at least a 4-byte staticcall selector")
	}
	vm := evmSubsetVM{
		code:     code,
		calldata: callData,
		storage:  storage,
		memory:   make([]byte, 0, 256),
	}
	return vm.run()
}

type evmSubsetVM struct {
	code     []byte
	calldata []byte
	storage  map[string]string
	memory   []byte
	stack    []*big.Int
	pc       int
	steps    int
}

const maxEVMSubsetSteps = 2048

var uint256Mod = new(big.Int).Lsh(big.NewInt(1), 256)

func (vm *evmSubsetVM) run() (evmStaticResult, error) {
	for vm.pc < len(vm.code) {
		vm.steps++
		if vm.steps > maxEVMSubsetSteps {
			return evmStaticResult{}, errors.New("local EVM subset exceeded step limit")
		}
		op := vm.code[vm.pc]
		vm.pc++
		switch {
		case op == 0x00: // STOP
			return evmStaticResult{EncodedResult: "0x", StepCount: vm.steps}, nil
		case op == 0x01: // ADD
			a, b, err := vm.pop2()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.push(u256(new(big.Int).Add(a, b)))
		case op == 0x03: // SUB
			a, b, err := vm.pop2()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.push(u256(new(big.Int).Sub(a, b)))
		case op == 0x10: // LT
			a, b, err := vm.pop2()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.pushBool(a.Cmp(b) < 0)
		case op == 0x14: // EQ
			a, b, err := vm.pop2()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.pushBool(a.Cmp(b) == 0)
		case op == 0x15: // ISZERO
			value, err := vm.pop()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.pushBool(value.Sign() == 0)
		case op == 0x16: // AND
			a, b, err := vm.pop2()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.push(new(big.Int).And(a, b))
		case op == 0x1c: // SHR
			shift, value, err := vm.pop2()
			if err != nil {
				return evmStaticResult{}, err
			}
			if !shift.IsUint64() || shift.Uint64() >= 256 {
				vm.push(big.NewInt(0))
				continue
			}
			vm.push(new(big.Int).Rsh(value, uint(shift.Uint64())))
		case op == 0x34: // CALLVALUE
			vm.push(big.NewInt(0))
		case op == 0x35: // CALLDATALOAD
			offset, err := vm.pop()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.push(bytes32ToInt(vm.calldataSlice(offset, 32)))
		case op == 0x36: // CALLDATASIZE
			vm.push(big.NewInt(int64(len(vm.calldata))))
		case op == 0x50: // POP
			if _, err := vm.pop(); err != nil {
				return evmStaticResult{}, err
			}
		case op == 0x51: // MLOAD
			offset, err := vm.pop()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.push(bytes32ToInt(vm.memSlice(offset, 32)))
		case op == 0x52: // MSTORE
			offset, value, err := vm.pop2()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.storeMemory(offset, intToBytes32(value))
		case op == 0x54: // SLOAD
			slot, err := vm.pop()
			if err != nil {
				return evmStaticResult{}, err
			}
			vm.push(storageValue(vm.storage, slot))
		case op == 0x56: // JUMP
			dest, err := vm.pop()
			if err != nil {
				return evmStaticResult{}, err
			}
			if err := vm.jump(dest); err != nil {
				return evmStaticResult{}, err
			}
		case op == 0x57: // JUMPI
			dest, condition, err := vm.pop2()
			if err != nil {
				return evmStaticResult{}, err
			}
			if condition.Sign() != 0 {
				if err := vm.jump(dest); err != nil {
					return evmStaticResult{}, err
				}
			}
		case op == 0x5b: // JUMPDEST
		case op == 0x5f: // PUSH0
			vm.push(big.NewInt(0))
		case op >= 0x60 && op <= 0x7f:
			size := int(op - 0x5f)
			if vm.pc+size > len(vm.code) {
				return evmStaticResult{}, errors.New("truncated PUSH data in deployed bytecode")
			}
			vm.push(new(big.Int).SetBytes(vm.code[vm.pc : vm.pc+size]))
			vm.pc += size
		case op >= 0x80 && op <= 0x8f:
			depth := int(op - 0x7f)
			if len(vm.stack) < depth {
				return evmStaticResult{}, errors.New("stack underflow on DUP")
			}
			vm.push(new(big.Int).Set(vm.stack[len(vm.stack)-depth]))
		case op >= 0x90 && op <= 0x9f:
			depth := int(op - 0x8f)
			if len(vm.stack) < depth+1 {
				return evmStaticResult{}, errors.New("stack underflow on SWAP")
			}
			top := len(vm.stack) - 1
			other := top - depth
			vm.stack[top], vm.stack[other] = vm.stack[other], vm.stack[top]
		case op == 0xf3: // RETURN
			offset, size, err := vm.pop2()
			if err != nil {
				return evmStaticResult{}, err
			}
			return evmStaticResult{EncodedResult: "0x" + hex.EncodeToString(vm.memSlice(offset, intFromBig(size))), StepCount: vm.steps}, nil
		case op == 0xfd:
			return evmStaticResult{}, errors.New("local EVM subset execution reverted")
		default:
			return evmStaticResult{}, fmt.Errorf("unsupported opcode 0x%02x in local EVM subset", op)
		}
	}
	return evmStaticResult{}, errors.New("local EVM subset reached end of bytecode without RETURN")
}

func (vm *evmSubsetVM) push(value *big.Int) {
	vm.stack = append(vm.stack, u256(value))
}

func (vm *evmSubsetVM) pushBool(value bool) {
	if value {
		vm.push(big.NewInt(1))
		return
	}
	vm.push(big.NewInt(0))
}

func (vm *evmSubsetVM) pop() (*big.Int, error) {
	if len(vm.stack) == 0 {
		return nil, errors.New("stack underflow")
	}
	value := vm.stack[len(vm.stack)-1]
	vm.stack = vm.stack[:len(vm.stack)-1]
	return value, nil
}

func (vm *evmSubsetVM) pop2() (*big.Int, *big.Int, error) {
	a, err := vm.pop()
	if err != nil {
		return nil, nil, err
	}
	b, err := vm.pop()
	if err != nil {
		return nil, nil, err
	}
	return a, b, nil
}

func (vm *evmSubsetVM) jump(dest *big.Int) error {
	if !dest.IsUint64() {
		return errors.New("jump destination exceeds local EVM subset bounds")
	}
	next := int(dest.Uint64())
	if next < 0 || next >= len(vm.code) || vm.code[next] != 0x5b {
		return fmt.Errorf("invalid jump destination %d", next)
	}
	vm.pc = next
	return nil
}

func (vm *evmSubsetVM) calldataSlice(offset *big.Int, size int) []byte {
	start := intFromBig(offset)
	out := make([]byte, size)
	if start >= len(vm.calldata) {
		return out
	}
	copy(out, vm.calldata[start:min(start+size, len(vm.calldata))])
	return out
}

func (vm *evmSubsetVM) memSlice(offset *big.Int, size int) []byte {
	start := intFromBig(offset)
	out := make([]byte, size)
	if start >= len(vm.memory) {
		return out
	}
	copy(out, vm.memory[start:min(start+size, len(vm.memory))])
	return out
}

func (vm *evmSubsetVM) storeMemory(offset *big.Int, value []byte) {
	start := intFromBig(offset)
	end := start + len(value)
	if end > len(vm.memory) {
		grown := make([]byte, end)
		copy(grown, vm.memory)
		vm.memory = grown
	}
	copy(vm.memory[start:end], value)
}

func u256(value *big.Int) *big.Int {
	out := new(big.Int).Mod(value, uint256Mod)
	if out.Sign() < 0 {
		out.Add(out, uint256Mod)
	}
	return out
}

func bytes32ToInt(value []byte) *big.Int {
	if len(value) < 32 {
		padded := make([]byte, 32)
		copy(padded[32-len(value):], value)
		value = padded
	}
	return new(big.Int).SetBytes(value[:32])
}

func intToBytes32(value *big.Int) []byte {
	out := make([]byte, 32)
	raw := u256(value).Bytes()
	copy(out[32-len(raw):], raw)
	return out
}

func storageValue(storage map[string]string, slot *big.Int) *big.Int {
	if storage == nil {
		return big.NewInt(0)
	}
	raw, ok := storage[slot.Text(10)]
	if !ok {
		raw, ok = storage["0x"+slot.Text(16)]
	}
	decoded, err := hex.DecodeString(strings.TrimPrefix(raw, "0x"))
	if !ok || err != nil {
		return big.NewInt(0)
	}
	return bytes32ToInt(decoded)
}

func intFromBig(value *big.Int) int {
	if value == nil || !value.IsUint64() {
		return 0
	}
	raw := value.Uint64()
	if raw > uint64(^uint(0)>>1) {
		return 0
	}
	return int(raw)
}

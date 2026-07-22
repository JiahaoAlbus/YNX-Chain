package streambft

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"sync"
)

type State map[string][]byte

func (s State) Clone() State {
	clone := make(State, len(s))
	for key, value := range s {
		clone[key] = append([]byte(nil), value...)
	}
	return clone
}

func StateRoot(state State) string {
	keys := make([]string, 0, len(state))
	for key := range state {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	hash := sha256.New()
	for _, key := range keys {
		_ = binary.Write(hash, binary.BigEndian, uint64(len(key)))
		_, _ = hash.Write([]byte(key))
		_ = binary.Write(hash, binary.BigEndian, uint64(len(state[key])))
		_, _ = hash.Write(state[key])
	}
	return hex.EncodeToString(hash.Sum(nil))
}

type ExecutionMode string

const (
	ExecutionParallel   ExecutionMode = "deterministic_parallel"
	ExecutionSequential ExecutionMode = "sequential_fallback"
)

type ExecutionResult struct {
	StateRoot     string        `json:"stateRoot"`
	Mode          ExecutionMode `json:"mode"`
	ParallelWaves int           `json:"parallelWaves"`
	Applied       []string      `json:"applied"`
	Resources     Resources     `json:"resources"`
}

type Executor struct {
	Workers int
}

func (e Executor) Execute(initial State, transactions []Transaction) (State, ExecutionResult, error) {
	if e.Workers < 1 {
		return nil, ExecutionResult{}, errors.New("executor requires at least one worker")
	}
	ordered := append([]Transaction(nil), transactions...)
	SortTransactions(ordered)
	for _, transaction := range ordered {
		if err := transaction.Validate(); err != nil {
			return nil, ExecutionResult{}, fmt.Errorf("invalid transaction %s: %w", transaction.ID, err)
		}
	}
	waves := conflictWaves(ordered)
	state := initial.Clone()
	result := ExecutionResult{Mode: ExecutionParallel, ParallelWaves: len(waves), Applied: make([]string, 0, len(ordered))}
	for _, wave := range waves {
		snapshot := state.Clone()
		errorsByIndex := make([]error, len(wave))
		semaphore := make(chan struct{}, e.Workers)
		var wait sync.WaitGroup
		for index, transaction := range wave {
			wait.Add(1)
			go func(index int, transaction Transaction) {
				defer wait.Done()
				semaphore <- struct{}{}
				defer func() { <-semaphore }()
				errorsByIndex[index] = validateReads(snapshot, transaction)
			}(index, transaction)
		}
		wait.Wait()
		for index, err := range errorsByIndex {
			if err != nil {
				return e.executeSequential(initial, ordered, fmt.Errorf("parallel pre-execution %s: %w", wave[index].ID, err))
			}
		}
		for _, transaction := range wave {
			applyWrites(state, transaction)
			result.Applied = append(result.Applied, transaction.ID)
			result.Resources = result.Resources.Add(transaction.Resources)
		}
	}
	result.StateRoot = StateRoot(state)
	return state, result, nil
}

func (e Executor) ExecuteSequential(initial State, transactions []Transaction) (State, ExecutionResult, error) {
	ordered := append([]Transaction(nil), transactions...)
	SortTransactions(ordered)
	for _, transaction := range ordered {
		if err := transaction.Validate(); err != nil {
			return nil, ExecutionResult{}, fmt.Errorf("invalid transaction %s: %w", transaction.ID, err)
		}
	}
	return e.executeSequential(initial, ordered, errors.New("sequential mode selected"))
}

func (e Executor) executeSequential(initial State, ordered []Transaction, parallelCause error) (State, ExecutionResult, error) {
	state := initial.Clone()
	result := ExecutionResult{Mode: ExecutionSequential, Applied: make([]string, 0, len(ordered))}
	for _, transaction := range ordered {
		if err := validateReads(state, transaction); err != nil {
			return nil, ExecutionResult{}, fmt.Errorf("sequential fallback after %v failed at %s: %w", parallelCause, transaction.ID, err)
		}
		applyWrites(state, transaction)
		result.Applied = append(result.Applied, transaction.ID)
		result.Resources = result.Resources.Add(transaction.Resources)
	}
	result.StateRoot = StateRoot(state)
	return state, result, nil
}

func conflictWaves(transactions []Transaction) [][]Transaction {
	waves := make([][]Transaction, 0)
	for _, transaction := range transactions {
		minimumWave := 0
		for index := range waves {
			for _, member := range waves[index] {
				if transaction.Access.Conflicts(member.Access) {
					minimumWave = index + 1
				}
			}
		}
		if minimumWave == len(waves) {
			waves = append(waves, []Transaction{transaction})
		} else {
			waves[minimumWave] = append(waves[minimumWave], transaction)
		}
	}
	return waves
}

func validateReads(state State, transaction Transaction) error {
	for _, key := range transaction.Access.Reads {
		if _, ok := state[key]; !ok {
			return fmt.Errorf("declared read key %q does not exist", key)
		}
	}
	for key := range transaction.Writes {
		if !contains(transaction.Access.Writes, key) {
			return fmt.Errorf("undeclared write key %q", key)
		}
	}
	return nil
}

func applyWrites(state State, transaction Transaction) {
	keys := make([]string, 0, len(transaction.Writes))
	for key := range transaction.Writes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		state[key] = append([]byte(nil), transaction.Writes[key]...)
	}
}

func EqualState(left, right State) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if !bytes.Equal(value, right[key]) {
			return false
		}
	}
	return true
}

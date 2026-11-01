// ynx-network-task-worker runs one fixed no-import WebAssembly histogram.
// It is a controlled local worker, not a production task or economic proof.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

const (
	maxInputBytes     = 4 << 20
	memoryPages       = 129
	linearMemoryBytes = memoryPages * 65536
	maxMemoryBytes    = 24 << 20
	inputOffset       = 4096
	histogramBytes    = 256 * 4
	chunkBytes        = 4096
)

var (
	errArgs      = errors.New("ARGS")
	errInput     = errors.New("INPUT")
	errModule    = errors.New("MODULE")
	errExecution = errors.New("EXECUTION")
	errOutput    = errors.New("OUTPUT")
)

type limits struct {
	bytes, cpuMilli, memoryBytes, durationMS uint64
}

// Only the four canonical numeric flags are accepted. There is no path,
// manifest, module, command, environment, import or network option.
func parseLimits(args []string) (limits, error) {
	var l limits
	if len(args) != 8 {
		return l, errArgs
	}
	values := make(map[string]uint64, 4)
	for i := 0; i < len(args); i += 2 {
		name, raw := args[i], args[i+1]
		if name != "--bytes" && name != "--cpu-milli" && name != "--memory-bytes" && name != "--duration-ms" {
			return l, errArgs
		}
		if _, exists := values[name]; exists || len(raw) == 0 || len(raw) > 20 || raw[0] == '0' {
			return l, errArgs
		}
		for _, digit := range raw {
			if digit < '0' || digit > '9' {
				return l, errArgs
			}
		}
		n, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return l, errArgs
		}
		values[name] = n
	}
	l = limits{values["--bytes"], values["--cpu-milli"], values["--memory-bytes"], values["--duration-ms"]}
	if l.bytes < 1 || l.bytes > maxInputBytes || l.cpuMilli < 1 || l.cpuMilli > 1000 ||
		l.memoryBytes < linearMemoryBytes || l.memoryBytes > maxMemoryBytes || l.durationMS < 1 || l.durationMS > 5000 {
		return limits{}, errArgs
	}
	return l, nil
}

func runtimeConfig() wazero.RuntimeConfig {
	return wazero.NewRuntimeConfigInterpreter().
		WithCoreFeatures(api.CoreFeaturesV1).
		WithMemoryLimitPages(memoryPages).
		WithCloseOnContextDone(true).
		WithDebugInfoEnabled(false)
}

// A cooperative duty cycle accounts for elapsed interpreter-call wall time,
// then waits proportionally. It is not an OS CPU quota or verified CPU service.
// Each call processes <=4096 bytes; the complete fixed loop is <=4MiB.
func cooperativePause(ctx context.Context, elapsed time.Duration, cpuMilli uint64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if cpuMilli == 1000 {
		runtime.Gosched()
		return ctx.Err()
	}
	// elapsed is bounded by the enclosing <=5s deadline. Clamp before the
	// multiplication so even a pathological scheduler stall cannot overflow.
	if elapsed > 5*time.Second {
		elapsed = 5 * time.Second
	}
	delay := elapsed * time.Duration(1000-cpuMilli) / time.Duration(cpuMilli)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func execute(ctx context.Context, l limits, input io.Reader, output io.Writer) error {
	if !fixedModuleValid() {
		return errModule
	}
	r := wazero.NewRuntimeWithConfig(ctx, runtimeConfig())
	defer r.Close(context.Background())
	compiled, err := r.CompileModule(ctx, histogramWASM)
	if err != nil {
		return errModule
	}
	// No host module (including WASI) is ever instantiated. A task cannot
	// supply bytes; this check also fail-closes an accidental embed change.
	memDef := compiled.ExportedMemories()["memory"]
	runDef := compiled.ExportedFunctions()["run"]
	if len(compiled.ImportedFunctions()) != 0 || len(compiled.ImportedMemories()) != 0 ||
		len(compiled.ExportedFunctions()) != 1 || len(compiled.ExportedMemories()) != 1 ||
		memDef == nil || runDef == nil || memDef.Min() != memoryPages {
		return errModule
	}
	max, bounded := memDef.Max()
	if !bounded || max != memoryPages {
		return errModule
	}
	mod, err := r.InstantiateModule(ctx, compiled, wazero.NewModuleConfig().WithName("").WithStartFunctions())
	if err != nil {
		return errModule
	}
	defer mod.Close(context.Background())
	memory := mod.Memory()
	data, ok := memory.Read(inputOffset, uint32(l.bytes))
	if !ok {
		return errModule
	}
	// Read directly into the fixed linear memory. No N-byte Go copy or JSON
	// parse changes the original raw bytes. The caller supplies provenance.
	if _, err = io.ReadFull(input, data); err != nil {
		return errInput
	}
	var trailing [1]byte
	if n, err := io.ReadFull(input, trailing[:]); n != 0 || err != io.EOF {
		return errInput
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	run := mod.ExportedFunction("run")
	for offset := uint64(0); offset < l.bytes; offset += chunkBytes {
		count := l.bytes - offset
		if count > chunkBytes {
			count = chunkBytes
		}
		start := time.Now()
		if _, err := run.Call(ctx, inputOffset+offset, count); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return errExecution
		}
		if err := cooperativePause(ctx, time.Since(start), l.cpuMilli); err != nil {
			return err
		}
	}
	result, ok := memory.Read(0, histogramBytes)
	if !ok {
		return errModule
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	n, err := output.Write(result)
	if err != nil || n != histogramBytes {
		return errOutput
	}
	return nil
}

func main() {
	l, err := parseLimits(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "ARGS")
		os.Exit(2)
	}
	// This fixed worker has one interpreter thread. GOMAXPROCS is not an OS
	// CPU-service guarantee and does not make memoryBytes a Go RSS hard limit.
	runtime.GOMAXPROCS(1)
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(l.durationMS)*time.Millisecond)
	defer cancel()
	var report sync.Once
	printCode := func(code string) { report.Do(func() { fmt.Fprintln(os.Stderr, code) }) }
	// The hard process deadline also covers blocked stdin/stdout. Cancellation
	// inside wazero closes the guest; this watchdog prevents a stuck host pipe
	// from retaining the process after the advertised <=5s duration.
	watchdog := time.AfterFunc(time.Duration(l.durationMS)*time.Millisecond, func() {
		printCode("TIMEOUT")
		os.Exit(124)
	})
	err = execute(ctx, l, os.Stdin, os.Stdout)
	watchdog.Stop()
	if err == nil {
		return
	}
	if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		printCode("TIMEOUT")
		os.Exit(124)
	}
	switch {
	case errors.Is(err, errInput):
		printCode("INPUT")
		os.Exit(3)
	case errors.Is(err, errModule):
		printCode("MODULE")
		os.Exit(4)
	case errors.Is(err, errOutput):
		printCode("OUTPUT")
		os.Exit(6)
	default:
		printCode("EXECUTION")
		os.Exit(5)
	}
}

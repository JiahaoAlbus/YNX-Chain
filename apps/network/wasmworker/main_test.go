package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

func validArgs(n int) []string {
	return []string{"--bytes", decimal(n), "--cpu-milli", "1000", "--memory-bytes", "8454144", "--duration-ms", "5000"}
}
func decimal(n int) string {
	if n == 0 {
		return "0"
	}
	var b [24]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte(n%10) + '0'
		n /= 10
	}
	return string(b[i:])
}
func config(t *testing.T, n int) limits {
	t.Helper()
	l, err := parseLimits(validArgs(n))
	if err != nil {
		t.Fatal(err)
	}
	return l
}

// This independent Go recomputation is deliberately not used by the worker.
// Production verification belongs to the parent original receipt verifier.
func reference(input []byte) []byte {
	var counts [256]uint32
	for _, b := range input {
		counts[int(b)]++
	}
	out := make([]byte, histogramBytes)
	for i, count := range counts {
		binary.LittleEndian.PutUint32(out[i*4:], count)
	}
	return out
}

func TestWASMFixedModuleContract(t *testing.T) {
	sum := sha256.Sum256(histogramWASM)
	if got := hex.EncodeToString(sum[:]); got != fixedModuleSHA256 || !fixedModuleValid() {
		t.Fatalf("fixed module pin %s != %s", got, fixedModuleSHA256)
	}
	if len(histogramWASM) != 149 {
		t.Fatalf("unexpected fixed module size %d", len(histogramWASM))
	}
	// Inspect all binary sections, not just function imports. No import/start,
	// table/global/data/custom section may hide capabilities or dynamic code.
	if !bytes.Equal(histogramWASM[:8], []byte{0, 'a', 's', 'm', 1, 0, 0, 0}) {
		t.Fatal("not WebAssembly 1.0")
	}
	var sections []byte
	for rest := histogramWASM[8:]; len(rest) > 0; {
		sections = append(sections, rest[0])
		length, n := binary.Uvarint(rest[1:])
		if n <= 0 || uint64(len(rest[1+n:])) < length {
			t.Fatal("bad section")
		}
		rest = rest[1+n+int(length):]
	}
	if !reflect.DeepEqual(sections, []byte{1, 3, 5, 7, 10}) {
		t.Fatalf("sections %v", sections)
	}
	ctx := context.Background()
	r := wazero.NewRuntimeWithConfig(ctx, runtimeConfig())
	defer r.Close(ctx)
	compiled, err := r.CompileModule(ctx, histogramWASM)
	if err != nil {
		t.Fatal(err)
	}
	if len(compiled.ImportedFunctions()) != 0 || len(compiled.ImportedMemories()) != 0 {
		t.Fatal("module imports capabilities")
	}
	if len(compiled.ExportedFunctions()) != 1 || len(compiled.ExportedMemories()) != 1 {
		t.Fatal("unexpected exports")
	}
	mem := compiled.ExportedMemories()["memory"]
	max, bounded := mem.Max()
	if mem.Min() != memoryPages || !bounded || max != memoryPages {
		t.Fatalf("memory min=%d max=%d bounded=%v", mem.Min(), max, bounded)
	}
	run := compiled.ExportedFunctions()["run"]
	if !reflect.DeepEqual(run.ParamTypes(), []api.ValueType{api.ValueTypeI32, api.ValueTypeI32}) || len(run.ResultTypes()) != 0 {
		t.Fatal("unexpected run signature")
	}
}

func TestWASMHistogramEqualsIndependentGo(t *testing.T) {
	allBytes := make([]byte, 256)
	for i := range allBytes {
		allBytes[i] = byte(i)
	}
	tests := map[string][]byte{
		"one_byte":          {0},
		"all_bytes":         allBytes,
		"public_block_json": []byte("{\"height\":2060705,\"hash\":\"c9b6cdfebca7bea09b2dca37ddf9f2a05b9266aecbadde9bd265733d8e164056\",\"transactions\":[],\"note\":\"公开 Testnet\"}\n"),
		"chunk_boundary":    bytes.Repeat([]byte{'{'}, chunkBytes+1),
		"maximum":           bytes.Repeat(allBytes, maxInputBytes/len(allBytes)),
	}
	for name, input := range tests {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			var out bytes.Buffer
			if err := execute(ctx, config(t, len(input)), bytes.NewReader(input), &out); err != nil {
				t.Fatal(err)
			}
			if out.Len() != histogramBytes || !bytes.Equal(out.Bytes(), reference(input)) {
				t.Fatalf("histogram mismatch, bytes=%d", out.Len())
			}
		})
	}
}

func TestWASMRejectsLimitsAndOnlyNumericCLI(t *testing.T) {
	good := validArgs(1)
	badValues := map[string][]string{
		"--bytes":        {"0", "4194305", "18446744073709551616"},
		"--cpu-milli":    {"0", "1001"},
		"--memory-bytes": {"8454143", "25165825"},
		"--duration-ms":  {"0", "5001"},
	}
	for key, values := range badValues {
		for _, value := range values {
			args := append([]string(nil), good...)
			for i := 0; i < len(args); i += 2 {
				if args[i] == key {
					args[i+1] = value
				}
			}
			if _, err := parseLimits(args); !errors.Is(err, errArgs) {
				t.Fatalf("accepted %s %s", key, value)
			}
		}
	}
	for _, value := range []string{"", "-1", "+1", "01", " 1", "1 ", "1.0", "1e3", "0x10", "１", "1\n", strings.Repeat("9", 1000)} {
		args := append([]string(nil), good...)
		args[1] = value
		if _, err := parseLimits(args); err == nil {
			t.Fatalf("accepted numeric encoding %q", value)
		}
	}
	for _, args := range [][]string{nil, good[:6], append(append([]string(nil), good...), "--module", "other.wasm"),
		{"--bytes", "1", "--bytes", "1", "--memory-bytes", "8454144", "--duration-ms", "5"},
		{"--module", "1", "--cpu-milli", "1", "--memory-bytes", "8454144", "--duration-ms", "5"},
		{"--bytes=1", "1", "--cpu-milli", "1", "--memory-bytes", "8454144", "--duration-ms", "5"}} {
		if _, err := parseLimits(args); err == nil {
			t.Fatalf("accepted %q", args)
		}
	}
	for _, args := range [][]string{validArgs(maxInputBytes),
		{"--duration-ms", "1", "--memory-bytes", "25165824", "--bytes", "1", "--cpu-milli", "1"}} {
		if _, err := parseLimits(args); err != nil {
			t.Fatalf("valid limits rejected: %v", err)
		}
	}
}

func TestWASMExactInputAndNoPartialOutput(t *testing.T) {
	for name, input := range map[string][]byte{
		"empty": nil, "short": []byte("a"), "trailing": []byte("abc"), "large_trailing": bytes.Repeat([]byte("x"), 1<<20),
	} {
		t.Run(name, func(t *testing.T) {
			var out bytes.Buffer
			if err := execute(context.Background(), config(t, 2), bytes.NewReader(input), &out); !errors.Is(err, errInput) {
				t.Fatalf("input err=%v", err)
			}
			if out.Len() != 0 {
				t.Fatalf("partial stdout %d", out.Len())
			}
		})
	}
}

func TestWASMGuestCannotAccessCountOrBeyondInputWindow(t *testing.T) {
	for _, args := range [][2]uint64{{0, 1}, {inputOffset - 1, 1}, {inputOffset, maxInputBytes + 1},
		{inputOffset + maxInputBytes, 1}, {0xffffffff, 2}, {inputOffset, 0xffffffff}} {
		ctx := context.Background()
		r := wazero.NewRuntimeWithConfig(ctx, runtimeConfig())
		mod, err := r.InstantiateWithConfig(ctx, histogramWASM, wazero.NewModuleConfig().WithStartFunctions())
		if err != nil {
			t.Fatal(err)
		}
		_, err = mod.ExportedFunction("run").Call(ctx, args[0], args[1])
		if err == nil {
			t.Fatalf("accepted out-of-window ptr,len %v", args)
		}
		r.Close(ctx)
	}
}

// A test-only no-import fixture builder. It is not linked into the normal
// worker, and production execute never accepts module bytes as an argument.
func fixture(body []byte, maximum byte, returnsI32 bool) []byte {
	m := []byte{0, 'a', 's', 'm', 1, 0, 0, 0}
	section := func(id byte, payload []byte) {
		m = append(m, id, byte(len(payload)))
		m = append(m, payload...)
	}
	result := []byte{1, 0x60, 0, 0}
	if returnsI32 {
		result = []byte{1, 0x60, 0, 1, 0x7f}
	}
	section(1, result)
	section(3, []byte{1, 0})
	section(5, []byte{1, 1, 0x81, 1, maximum, 1})
	section(7, []byte{2, 6, 'm', 'e', 'm', 'o', 'r', 'y', 2, 0, 3, 'r', 'u', 'n', 0, 0})
	code := append([]byte{1, byte(len(body))}, body...)
	section(10, code)
	return m
}

func TestWASMActualInfiniteLoopDeadlineClosesGuest(t *testing.T) {
	background := context.Background()
	r := wazero.NewRuntimeWithConfig(background, runtimeConfig())
	defer r.Close(background)
	wasm := fixture([]byte{0, 0x03, 0x40, 0x0c, 0, 0x0b, 0x0b}, 0x81, false)
	mod, err := r.InstantiateWithConfig(background, wasm, wazero.NewModuleConfig().WithStartFunctions())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(background, 20*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = mod.ExportedFunction("run").Call(ctx)
	if !errors.Is(err, context.DeadlineExceeded) || !mod.IsClosed() {
		t.Fatalf("infinite fixture err=%v closed=%v", err, mod.IsClosed())
	}
	if time.Since(start) > time.Second {
		t.Fatal("deadline did not terminate actual WASM loop promptly")
	}
	if _, err = mod.ExportedFunction("run").Call(background); err == nil {
		t.Fatal("closed guest could be replayed")
	}
}

func TestWASMActualInfiniteLoopCancellationClosesGuest(t *testing.T) {
	background := context.Background()
	r := wazero.NewRuntimeWithConfig(background, runtimeConfig())
	defer r.Close(background)
	mod, err := r.InstantiateWithConfig(background,
		fixture([]byte{0, 0x03, 0x40, 0x0c, 0, 0x0b, 0x0b}, 0x81, false), wazero.NewModuleConfig().WithStartFunctions())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(background)
	done := make(chan error, 1)
	go func() {
		_, callErr := mod.ExportedFunction("run").Call(ctx)
		done <- callErr
	}()
	time.Sleep(10 * time.Millisecond) // Ensure the actual interpreter loop is in flight.
	cancel()
	select {
	case err = <-done:
		if !errors.Is(err, context.Canceled) || !mod.IsClosed() {
			t.Fatalf("cancel err=%v closed=%v", err, mod.IsClosed())
		}
	case <-time.After(time.Second):
		t.Fatal("cancel left the interpreter running")
	}
}

func TestWASMMemoryGrowthAndDeclaredMaxCannotExceed129Pages(t *testing.T) {
	ctx := context.Background()
	r := wazero.NewRuntimeWithConfig(ctx, runtimeConfig())
	defer r.Close(ctx)
	// This actual guest tries memory.grow(1), rather than just inspecting a max.
	grow := fixture([]byte{0, 0x41, 1, 0x40, 0, 0x0b}, 0x81, true)
	mod, err := r.InstantiateWithConfig(ctx, grow, wazero.NewModuleConfig().WithStartFunctions())
	if err != nil {
		t.Fatal(err)
	}
	values, err := mod.ExportedFunction("run").Call(ctx)
	if err != nil || len(values) != 1 || values[0] != 0xffffffff || mod.Memory().Size() != linearMemoryBytes {
		t.Fatalf("guest memory growth values=%v err=%v bytes=%d", values, err, mod.Memory().Size())
	}
	if _, ok := mod.Memory().Grow(1); ok || mod.Memory().Size() != linearMemoryBytes {
		t.Fatal("host memory growth exceeded module maximum")
	}
	// Wazero tightens a larger declared max to its runtime cap instead of
	// rejecting compilation. Test the effective max rather than assuming a
	// compile error. Production separately pins the original min=max129 bytes.
	compiled, err := r.CompileModule(ctx, fixture([]byte{0, 0x0b}, 0x82, false))
	if err != nil {
		t.Fatal(err)
	}
	max, bounded := compiled.ExportedMemories()["memory"].Max()
	if !bounded || max != memoryPages {
		t.Fatalf("runtime did not tighten max130: max=%d bounded=%v", max, bounded)
	}
	tooLarge := fixture([]byte{0, 0x0b}, 0x82, false)
	tooLarge = bytes.Replace(tooLarge, []byte{5, 6, 1, 1, 0x81, 1, 0x82, 1}, []byte{5, 6, 1, 1, 0x82, 1, 0x82, 1}, 1)
	if _, err := r.CompileModule(ctx, tooLarge); err == nil {
		t.Fatal("runtime accepted minimum130 beyond its cap")
	}
}

func TestWASMCooperativeBudgetIsCancelable(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(cooperativePause(ctx, time.Millisecond, 1), context.Canceled) {
		t.Fatal("cooperative pause lost cancellation")
	}
	// The real worker module executes before each pause; this verifies the
	// complete bounded execution also respects a deadline, with no output.
	ctx, cancel = context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	l := config(t, maxInputBytes)
	l.cpuMilli = 1
	var out bytes.Buffer
	if err := execute(ctx, l, bytes.NewReader(bytes.Repeat([]byte("a"), maxInputBytes)), &out); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("actual fixed worker timeout err=%v", err)
	}
	if out.Len() != 0 {
		t.Fatal("timed-out task emitted a result")
	}
}

func cliCommand(t *testing.T, args ...string) *exec.Cmd {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(exe, append([]string{"-test.run=^TestWASMCLISubprocess$", "--"}, args...)...)
	command.Env = append(os.Environ(), "WASM_WORKER_TEST_CHILD=1")
	return command
}
func TestWASMCLISubprocess(t *testing.T) {
	if os.Getenv("WASM_WORKER_TEST_CHILD") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			os.Args = append(os.Args[:1], os.Args[i+1:]...)
			main()
			os.Exit(0)
		}
	}
	os.Exit(111)
}
func TestWASMCLIProcessBinaryProtocol(t *testing.T) {
	input := []byte("{\"height\":\"9007199254740993\",\"transactions\":[]}\n")
	cmd := cliCommand(t, validArgs(len(input))...)
	cmd.Stdin = bytes.NewReader(input)
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	if err := cmd.Run(); err != nil || stderr.Len() != 0 || !bytes.Equal(out.Bytes(), reference(input)) {
		t.Fatalf("CLI err=%v stderr=%q outlen=%d", err, stderr.String(), out.Len())
	}
	for name, input := range map[string][]byte{"short": nil, "trailing": []byte("ab")} {
		cmd := cliCommand(t, validArgs(1)...)
		cmd.Stdin = bytes.NewReader(input)
		var out, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &stderr
		err := cmd.Run()
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 3 || out.Len() != 0 || stderr.String() != "INPUT\n" {
			t.Fatalf("%s err=%v stderr=%q outlen=%d", name, err, stderr.String(), out.Len())
		}
	}
	for _, args := range [][]string{
		{"--module", "caller.wasm"},
		validArgs(maxInputBytes + 1),
		{"--bytes", "1", "--cpu-milli", "1001", "--memory-bytes", "8454144", "--duration-ms", "5"},
		{"--bytes", "1", "--cpu-milli", "1000", "--memory-bytes", "8454143", "--duration-ms", "5"},
		{"--bytes", "1", "--cpu-milli", "1000", "--memory-bytes", "8454144", "--duration-ms", "5001"},
	} {
		cmd = cliCommand(t, args...)
		var outBad, errBad bytes.Buffer
		cmd.Stdout, cmd.Stderr = &outBad, &errBad
		if err := cmd.Run(); err == nil || outBad.Len() != 0 || errBad.String() != "ARGS\n" {
			t.Fatalf("untrusted/over-limit args %q err=%v stderr=%q", args, err, errBad.String())
		}
	}
}
func TestWASMCLIBlockedInputDeadlineExitsProcess(t *testing.T) {
	for name, input := range map[string][]byte{"before_bytes": nil, "before_eof": {'x'}} {
		t.Run(name, func(t *testing.T) { blockedInputDeadline(t, input) })
	}
}
func blockedInputDeadline(t *testing.T, input []byte) {
	t.Helper()
	args := validArgs(1)
	args[7] = "50"
	cmd := cliCommand(t, args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	start := time.Now()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if len(input) != 0 {
		if _, err := stdin.Write(input); err != nil {
			t.Fatal(err)
		}
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err = <-done:
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 124 || out.Len() != 0 || stderr.String() != "TIMEOUT\n" {
			t.Fatalf("blocked stdin err=%v out=%d stderr=%q", err, out.Len(), stderr.String())
		}
	case <-time.After(2 * time.Second):
		cmd.Process.Kill()
		<-done
		t.Fatal("deadline retained blocked stdin process")
	}
	if time.Since(start) > time.Second {
		t.Fatal("process timeout was not prompt")
	}
}

package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "YNX Quant Desktop could not start:", err)
		os.Exit(1)
	}
}

func run() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	binDir := filepath.Dir(executable)
	quantdPath, webPath, webRoot := layout(runtime.GOOS, binDir)
	for _, path := range []string{quantdPath, webPath} {
		if info, err := os.Stat(path); err != nil || info.IsDir() {
			return fmt.Errorf("required packaged binary unavailable: %s", filepath.Base(path))
		}
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	stateDir := filepath.Join(configDir, "YNX Quant Lab")
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		return err
	}
	statePath := filepath.Join(stateDir, "state.json")
	if configured := os.Getenv("YNX_QUANT_STATE_PATH"); configured != "" {
		statePath = configured
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	quantd := exec.CommandContext(ctx, quantdPath)
	quantd.Env = append(os.Environ(), "YNX_QUANT_HTTP_ADDR=127.0.0.1:16444", "YNX_QUANT_STATE_PATH="+statePath)
	quantd.Stdout, quantd.Stderr = os.Stdout, os.Stderr
	web := exec.CommandContext(ctx, webPath)
	web.Env = append(os.Environ(), "YNX_QUANT_WEB_ADDR=127.0.0.1:16447", "YNX_QUANT_API_URL=http://127.0.0.1:16444", "YNX_QUANT_WEB_ROOT="+webRoot)
	web.Stdout, web.Stderr = os.Stdout, os.Stderr
	if err := quantd.Start(); err != nil {
		return err
	}
	defer terminate(quantd)
	if err := waitHealth(ctx, "http://127.0.0.1:16444/health"); err != nil {
		return err
	}
	if err := web.Start(); err != nil {
		return err
	}
	defer terminate(web)
	if err := waitHealth(ctx, "http://127.0.0.1:16447/"); err != nil {
		return err
	}
	if os.Getenv("YNX_QUANT_DESKTOP_NO_OPEN") != "1" {
		if err := openBrowser(runtime.GOOS, "http://127.0.0.1:16447/"); err != nil {
			return err
		}
	}
	<-ctx.Done()
	return nil
}

func layout(platform, binDir string) (string, string, string) {
	extension := ""
	if platform == "windows" {
		extension = ".exe"
	}
	webRoot := filepath.Join(binDir, "web")
	if platform == "darwin" {
		webRoot = filepath.Clean(filepath.Join(binDir, "..", "Resources", "web"))
	}
	return filepath.Join(binDir, "ynx-quantd"+extension), filepath.Join(binDir, "ynx-quant-web"+extension), webRoot
}

func waitHealth(ctx context.Context, endpoint string) error {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if response, err := client.Do(request); err == nil {
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 400 {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
	return errors.New("packaged service health timeout")
}

func openBrowser(platform, target string) error {
	var command *exec.Cmd
	switch platform {
	case "darwin":
		command = exec.Command("open", target)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	default:
		command = exec.Command("xdg-open", target)
	}
	return command.Start()
}

func terminate(command *exec.Cmd) {
	if command == nil || command.Process == nil {
		return
	}
	_ = command.Process.Signal(os.Interrupt)
	done := make(chan struct{})
	go func() { _ = command.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		_ = command.Process.Kill()
		<-done
	}
}

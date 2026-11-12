package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Run this test executable as a deterministic offline stand-in for LazyGit.
func TestMain(m *testing.M) {
	if os.Getenv("CADENCR_LAZYGIT_HELPER") == "1" {
		if len(os.Args) > 1 && os.Args[1] == "-cd" {
			fmt.Println(os.Getenv("CADENCR_LAZYGIT_CONFIG"))
			return
		}
		cwd, _ := os.Getwd()
		ready, _ := json.Marshal(map[string]any{
			"cwd": cwd, "args": os.Args[1:], "pid": os.Getpid(),
			"term": os.Getenv("TERM"), "gitDir": os.Getenv("GIT_DIR"),
		})
		fmt.Printf("READY %s\n", ready)
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			if scanner.Text() == "exit" {
				return
			}
			fmt.Printf("INPUT %s\n", scanner.Text())
		}
		return
	}
	os.Exit(m.Run())
}

func fixtureSession(t *testing.T) (*session, startParams, string) {
	t.Helper()
	t.Setenv("CADENCR_LAZYGIT_HELPER", "1")
	t.Setenv("LG_CONFIG_FILE", "")
	config := t.TempDir()
	t.Setenv("CADENCR_LAZYGIT_CONFIG", config)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	s := &session{context: hello{Worktree: t.TempDir(), StateDir: t.TempDir()}}
	t.Cleanup(s.close)
	return s, startParams{LazyGitPath: executable, Cols: 80, Rows: 24}, config
}

func outputUntil(t *testing.T, s *session, check func(string, bool) bool) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		answer, err := s.read(0)
		if err != nil {
			t.Fatal(err)
		}
		result := answer.(map[string]any)
		raw, _ := base64.StdEncoding.DecodeString(result["data"].(string))
		output := string(raw)
		if check(output, result["exited"].(bool)) {
			return output
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for terminal output")
	return ""
}

func TestDirectTerminalWorktreeInputResizeReloadAndRestart(t *testing.T) {
	s, p, _ := fixtureSession(t)
	t.Setenv("GIT_DIR", "/wrong/repository")
	t.Setenv("GIT_WORK_TREE", "/wrong/worktree")
	if _, err := s.start(p); err != nil {
		t.Fatal(err)
	}
	output := outputUntil(t, s, func(out string, _ bool) bool { return strings.Contains(out, "READY ") })
	var ready struct {
		Cwd, Term, GitDir string
		Args              []string
	}
	start := strings.Index(output, "READY ") + len("READY ")
	if err := json.Unmarshal([]byte(strings.TrimSpace(output[start:])), &ready); err != nil {
		t.Fatal(err)
	}
	cwd, _ := filepath.EvalSymlinks(s.context.Worktree)
	if ready.Cwd != cwd || ready.Term != "xterm-256color" || ready.GitDir != "" || len(ready.Args) != 0 {
		t.Fatalf("wrong direct terminal context: %+v", ready)
	}
	process := s.cmd.Process.Pid
	if _, err := s.start(p); err != nil || s.cmd.Process.Pid != process {
		t.Fatalf("reattaching restarted the process: %v", err)
	}
	if _, err := s.handle("terminal.resize", json.RawMessage(`{"cols":100,"rows":30}`)); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"ordered first\n", "ordered second\n"} {
		if err := s.write([]byte(text)); err != nil {
			t.Fatal(err)
		}
	}
	output = outputUntil(t, s, func(out string, _ bool) bool {
		return strings.Contains(out, "INPUT ordered second")
	})
	if strings.Count(output, "INPUT ordered first") != 1 ||
		strings.Index(output, "INPUT ordered first") > strings.Index(output, "INPUT ordered second") {
		t.Fatalf("input was duplicated or reordered: %q", output)
	}
	if err := s.write([]byte("exit\n")); err != nil {
		t.Fatal(err)
	}
	outputUntil(t, s, func(_ string, exited bool) bool { return exited })
	if _, err := s.start(p); err != nil {
		t.Fatal(err)
	}
	if s.cmd.Process.Pid == process {
		t.Fatal("restart reused the exited process")
	}
	outputUntil(t, s, func(out string, _ bool) bool { return strings.Contains(out, "READY ") })
	s.close()
	if _, err := s.start(p); err == nil {
		t.Fatal("closed session accepted a start")
	}
}

func TestTerminalRejectsInvalidRequestsAndBoundsOutput(t *testing.T) {
	s, p, _ := fixtureSession(t)
	for _, request := range []struct{ method, params string }{
		{"terminal.start", `{"cols":1,"rows":24}`},
		{"terminal.input", `{"data":"invalid base64"}`},
		{"terminal.read", `{}`},
		{"terminal.resize", `{"cols":80,"rows":24}`},
	} {
		if _, err := s.handle(request.method, json.RawMessage(request.params)); err == nil {
			t.Fatalf("accepted %s before startup", request.method)
		}
	}
	p.LazyGitPath = filepath.Join(t.TempDir(), "missing-lazygit")
	if _, err := s.start(p); err == nil || err.(*fault).Code != "LAZYGIT_NOT_FOUND" {
		t.Fatalf("missing binary wasn't reported: %v", err)
	}
	// Simulate a stream whose older bytes were evicted, without sending
	// megabytes through a real terminal.
	s.cmd = nil
	s.base, s.output = 4096, []byte(strings.Repeat("x", chunkLimit+10))
	executable, _ := os.Executable()
	p.LazyGitPath = executable
	if _, err := s.start(p); err != nil {
		t.Fatal(err)
	}
	outputUntil(t, s, func(out string, _ bool) bool { return strings.Contains(out, "READY ") })
	s.mu.Lock()
	s.base, s.output = 4096, []byte(strings.Repeat("x", chunkLimit+10))
	s.mu.Unlock()
	answer, err := s.read(0)
	if err != nil {
		t.Fatal(err)
	}
	result := answer.(map[string]any)
	raw, _ := base64.StdEncoding.DecodeString(result["data"].(string))
	if !result["reset"].(bool) || len(raw) != chunkLimit || result["offset"].(int64) != 4096+chunkLimit {
		t.Fatalf("output window wasn't bounded: %v / %d", result["reset"], len(raw))
	}
	if _, err := s.read(-1); err == nil {
		t.Fatal("accepted a negative offset")
	}
	if _, err := s.read(4096 + chunkLimit + 11); err == nil {
		t.Fatal("accepted an offset beyond the stream")
	}
}

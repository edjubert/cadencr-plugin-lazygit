package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

const outputLimit = 2 * 1024 * 1024
const chunkLimit = 256 * 1024

type session struct {
	context hello
	mu      sync.Mutex
	inputMu sync.Mutex
	cmd     *exec.Cmd
	tty     *os.File
	output  []byte
	base    int64
	exited  bool
	status  string
	done    chan struct{}
	closed  bool
	run     uint64
}

type startParams struct {
	LazyGitPath string            `json:"lazygitPath"`
	Palette     map[string]string `json:"palette"`
	Cols        uint16            `json:"cols"`
	Rows        uint16            `json:"rows"`
}

func size(cols, rows uint16) (*pty.Winsize, error) {
	if cols < 2 || rows < 2 || cols > 1000 || rows > 1000 {
		return nil, fail("BAD_REQUEST", "Terminal dimensions must be between 2 and 1000.")
	}
	return &pty.Winsize{Cols: cols, Rows: rows}, nil
}

func params(raw json.RawMessage, value any) error {
	if len(raw) == 0 || string(raw) == "null" || json.Unmarshal(raw, value) != nil {
		return fail("BAD_REQUEST", "Invalid terminal request parameters.")
	}
	return nil
}

func (s *session) handle(method string, raw json.RawMessage) (any, error) {
	switch method {
	case "terminal.theme":
		var p struct {
			Palette map[string]string `json:"palette"`
		}
		if err := params(raw, &p); err != nil {
			return nil, err
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		_, err := writeTheme(themeDirectory(s.context), p.Palette)
		return nil, err
	case "terminal.appearance":
		home, _ := os.UserHomeDir()
		return terminalAppearance(s.context.StateDir, home), nil
	case "terminal.start":
		var p startParams
		if err := params(raw, &p); err != nil {
			return nil, err
		}
		return s.start(p)
	case "terminal.read":
		var p struct {
			Offset int64 `json:"offset"`
		}
		if err := params(raw, &p); err != nil {
			return nil, err
		}
		return s.read(p.Offset)
	case "terminal.input":
		var p struct {
			Data string `json:"data"`
		}
		if err := params(raw, &p); err != nil {
			return nil, err
		}
		data, err := base64.StdEncoding.DecodeString(p.Data)
		if err != nil || len(data) > 64*1024 {
			return nil, fail("BAD_REQUEST", "Terminal input must be base64 and at most 64 KiB.")
		}
		return nil, s.write(data)
	case "terminal.resize":
		var p startParams
		if err := params(raw, &p); err != nil {
			return nil, err
		}
		dimensions, err := size(p.Cols, p.Rows)
		if err != nil {
			return nil, err
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.tty == nil || s.exited {
			return nil, fail("TERMINAL_NOT_RUNNING", "Start LazyGit before resizing the terminal.")
		}
		if err := pty.Setsize(s.tty, dimensions); err != nil {
			return nil, err
		}
		// A newly attached terminal also needs a repaint at the same dimensions.
		return nil, s.cmd.Process.Signal(syscall.SIGWINCH)
	case "terminal.stop":
		return nil, s.stop()
	default:
		return nil, fail("METHOD_NOT_FOUND", "Unknown backend method: "+method)
	}
}

func (s *session) start(p startParams) (any, error) {
	dimensions, err := size(p.Cols, p.Rows)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, fail("TERMINAL_CLOSED", "The backend is shutting down.")
	}
	// Reloading or hiding the web tab must not restart LazyGit.
	if s.cmd != nil && !s.exited {
		if len(p.Palette) > 0 {
			if _, err := writeTheme(themeDirectory(s.context), p.Palette); err != nil {
				return nil, err
			}
		}
		return map[string]any{
			"exited": s.exited, "status": s.status, "offset": s.base + int64(len(s.output)),
		}, nil
	}
	cmd, err := lazygitCommand(s.context, p)
	if err != nil {
		return nil, err
	}
	tty, err := pty.StartWithSize(cmd, dimensions)
	if err != nil {
		return nil, fail("LAZYGIT_START_FAILED", "Unable to start LazyGit: "+err.Error())
	}
	if s.tty != nil {
		_ = s.tty.Close()
	}
	s.run++
	run := s.run
	s.output, s.base, s.exited, s.status = nil, 0, false, ""
	s.cmd, s.tty, s.done = cmd, tty, make(chan struct{})
	done, collected := s.done, make(chan struct{})
	go func() {
		s.collect(tty, run)
		close(collected)
	}()
	go func() {
		err := cmd.Wait()
		select {
		case <-collected:
		case <-time.After(100 * time.Millisecond):
			_ = tty.Close()
		}
		s.mu.Lock()
		s.exited = true
		s.status = "LazyGit exited."
		if err != nil {
			s.status = "LazyGit exited: " + err.Error()
		}
		s.mu.Unlock()
		close(done)
	}()
	return map[string]any{"exited": false, "status": "", "offset": int64(0)}, nil
}

// stop terminates the running LazyGit so that terminal.start launches a fresh one.
func (s *session) stop() error {
	s.mu.Lock()
	cmd, done, exited := s.cmd, s.done, s.exited
	s.mu.Unlock()
	if cmd == nil || exited {
		return nil
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	select {
	case <-done:
		return nil
	case <-time.After(500 * time.Millisecond):
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	select {
	case <-done:
		return nil
	case <-time.After(500 * time.Millisecond):
		return fail("LAZYGIT_STOP_FAILED", "LazyGit did not exit.")
	}
}

func terminalEnvironment(inherited []string) []string {
	env := make([]string, 0, len(inherited)+2)
	for _, value := range inherited {
		key := strings.ToUpper(strings.SplitN(value, "=", 2)[0])
		if key == "TERM" || key == "COLORTERM" || key == "GIT_DIR" ||
			key == "GIT_WORK_TREE" || key == "GIT_INDEX_FILE" || key == "GIT_COMMON_DIR" {
			continue
		}
		env = append(env, value)
	}
	return append(env, "TERM=xterm-256color", "COLORTERM=truecolor")
}

func (s *session) collect(tty *os.File, run uint64) {
	buffer := make([]byte, 32*1024)
	for {
		n, err := tty.Read(buffer)
		if n > 0 {
			s.mu.Lock()
			if run != s.run {
				s.mu.Unlock()
				return
			}
			s.output = append(s.output, buffer[:n]...)
			if excess := len(s.output) - outputLimit; excess > 0 {
				s.output = s.output[excess:]
				s.base += int64(excess)
			}
			s.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

func (s *session) read(offset int64) (any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd == nil {
		return nil, fail("TERMINAL_NOT_RUNNING", "Start LazyGit before reading the terminal.")
	}
	end := s.base + int64(len(s.output))
	if offset < 0 || offset > end {
		return nil, fail("BAD_REQUEST", "Terminal output offset is outside the available stream.")
	}
	reset := offset < s.base
	if reset {
		offset = s.base
	}
	first := int(offset - s.base)
	last := min(first+chunkLimit, len(s.output))
	return map[string]any{
		"data": base64.StdEncoding.EncodeToString(s.output[first:last]), "offset": s.base + int64(last),
		"reset": reset, "exited": s.exited && last == len(s.output), "status": s.status,
	}, nil
}

func (s *session) write(data []byte) error {
	s.inputMu.Lock()
	defer s.inputMu.Unlock()
	s.mu.Lock()
	tty, stopped := s.tty, s.exited || s.closed
	s.mu.Unlock()
	if tty == nil || stopped {
		return fail("TERMINAL_NOT_RUNNING", "LazyGit is not running.")
	}
	_, err := tty.Write(data)
	return err
}

func (s *session) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	cmd, tty, done, exited := s.cmd, s.tty, s.done, s.exited
	s.mu.Unlock()
	if cmd == nil {
		return
	}
	if !exited {
		// LazyGit starts in its own PTY session. Terminate its process group too.
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		select {
		case <-done:
		case <-time.After(500 * time.Millisecond):
		}
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	_ = tty.Close()
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		fmt.Fprintln(os.Stderr, "LazyGit did not exit before backend shutdown.")
	}
}

package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func lazygitCommand(cx hello, p startParams) (*exec.Cmd, error) {
	program := p.LazyGitPath
	if program == "" {
		program = "lazygit"
	}
	executable, err := exec.LookPath(program)
	if err != nil {
		return nil, fail("LAZYGIT_NOT_FOUND", "Install LazyGit or set its executable path in the tab settings: "+err.Error())
	}
	cmd := exec.Command(executable)
	cmd.Dir = cx.Worktree
	cmd.Env = terminalEnvironment(os.Environ())
	if len(p.Palette) == 0 {
		return cmd, nil
	}
	// A launcher may disable color for its own logs. This PTY supports true
	// color, and the user explicitly selected theme synchronization.
	colored := make([]string, 0, len(cmd.Env))
	for _, variable := range cmd.Env {
		if !strings.HasPrefix(variable, "NO_COLOR=") {
			colored = append(colored, variable)
		}
	}
	cmd.Env = colored
	theme, err := writeTheme(themeDirectory(cx), p.Palette)
	if err != nil {
		return nil, err
	}
	files := os.Getenv("LG_CONFIG_FILE")
	if files == "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		query := exec.CommandContext(ctx, executable, "-cd")
		query.Dir, query.Env = cmd.Dir, cmd.Env
		output, err := query.Output()
		if err != nil {
			return nil, fail("LAZYGIT_CONFIG_FAILED", "Unable to locate LazyGit's configuration: "+err.Error())
		}
		directory := strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0])
		if directory == "" {
			return nil, fail("LAZYGIT_CONFIG_FAILED", "LazyGit returned an empty configuration directory.")
		}
		config := filepath.Join(directory, "config.yml")
		if _, err := os.Stat(config); err == nil {
			if strings.Contains(config, ",") {
				return nil, fail("LAZYGIT_CONFIG_FAILED", "LazyGit config paths cannot contain commas.")
			}
			files = config
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}
	if files != "" {
		files += ","
	}
	cmd.Args = append(cmd.Args, "--use-config-file", files+theme)
	return cmd, nil
}

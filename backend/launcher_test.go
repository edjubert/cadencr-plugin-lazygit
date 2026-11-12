package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testPalette() map[string]string {
	return map[string]string{
		"background": "#101218", "foreground": "#e2e4e9", "muted": "#9297a5",
		"border": "#424655", "primary": "#23b5d3", "selection": "#343a49", "error": "#f38ba8",
	}
}

func TestThemeLayersAfterUserConfigWithoutRewritingIt(t *testing.T) {
	s, p, directory := fixtureSession(t)
	config := filepath.Join(directory, "config.yml")
	const userConfig = "gui:\n  mouseEvents: false\ncustomCommands: []\n"
	if err := os.WriteFile(config, []byte(userConfig), 0600); err != nil {
		t.Fatal(err)
	}
	p.Palette = testPalette()
	t.Setenv("NO_COLOR", "1")
	cmd, err := lazygitCommand(s.context, p)
	if err != nil {
		t.Fatal(err)
	}
	theme := filepath.Join(themeDirectory(s.context), "cadencr-theme.yml")
	if len(cmd.Args) != 3 || cmd.Args[1] != "--use-config-file" || cmd.Args[2] != config+","+theme {
		t.Fatalf("user config wasn't layered before the theme: %q", cmd.Args)
	}
	if strings.Contains(strings.Join(cmd.Env, "\n"), "NO_COLOR=") {
		t.Fatal("a logging environment flag disabled the requested terminal theme")
	}
	raw, err := os.ReadFile(config)
	if err != nil || string(raw) != userConfig {
		t.Fatalf("user config was changed: %v / %q", err, raw)
	}
	t.Setenv("LG_CONFIG_FILE", "/first.yml,/second.yml")
	cmd, err = lazygitCommand(s.context, p)
	if err != nil || cmd.Args[2] != "/first.yml,/second.yml,"+theme {
		t.Fatalf("explicit LazyGit config wasn't preserved: %v / %+v", err, cmd)
	}
	p.Palette = nil
	cmd, err = lazygitCommand(s.context, p)
	if err != nil || len(cmd.Args) != 1 || !strings.Contains(strings.Join(cmd.Env, "\n"), "NO_COLOR=1") {
		t.Fatalf("disabled synchronization must use LazyGit defaults: %v", err)
	}
}

func TestThemeWithNoExistingConfigAndInvalidColors(t *testing.T) {
	s, p, _ := fixtureSession(t)
	p.Palette = testPalette()
	cmd, err := lazygitCommand(s.context, p)
	if err != nil || cmd.Args[2] != filepath.Join(themeDirectory(s.context), "cadencr-theme.yml") {
		t.Fatalf("fresh LazyGit install can't start: %v / %+v", err, cmd)
	}
	raw, err := os.ReadFile(cmd.Args[2])
	if err != nil {
		t.Fatal(err)
	}
	for _, section := range []string{"theme:", "darkTheme:", "lightTheme:"} {
		if !strings.Contains(string(raw), section) {
			t.Fatalf("missing theme section %s", section)
		}
	}
	if _, err := s.start(p); err != nil {
		t.Fatal(err)
	}
	pid := s.cmd.Process.Pid
	p.Palette["primary"] = "#abcdef"
	if _, err := s.start(p); err != nil || s.cmd.Process.Pid != pid {
		t.Fatalf("theme changed the running process: %v", err)
	}
	raw, _ = os.ReadFile(cmd.Args[2])
	if !strings.Contains(string(raw), "#abcdef") {
		t.Fatal("reattaching didn't update the theme")
	}
	p.Palette["primary"] = "\"\ncustomCommands: malicious"
	if _, err := writeTheme(themeDirectory(s.context), p.Palette); err == nil {
		t.Fatal("accepted a non-color in the YAML theme")
	}
	after, _ := os.ReadFile(cmd.Args[2])
	if string(raw) != string(after) {
		t.Fatal("invalid theme changed the existing override")
	}
	if _, err := writeTheme(filepath.Join(t.TempDir(), "comma,path"), testPalette()); err == nil {
		t.Fatal("accepted a path LazyGit would split into multiple configs")
	}
}

func TestTerminalEnvironmentPreservesAuthButIgnoresRepositoryOverrides(t *testing.T) {
	got := strings.Join(terminalEnvironment([]string{
		"PATH=/bin", "SSH_AUTH_SOCK=/agent", "LG_CONFIG_FILE=/user.yml",
		"GIT_DIR=/elsewhere", "GIT_WORK_TREE=/elsewhere", "GIT_INDEX_FILE=/index",
		"GIT_COMMON_DIR=/common", "TERM=dumb", "COLORTERM=old",
	}), "\n")
	for _, required := range []string{"PATH=/bin", "SSH_AUTH_SOCK=/agent", "LG_CONFIG_FILE=/user.yml",
		"TERM=xterm-256color", "COLORTERM=truecolor"} {
		if !strings.Contains(got, required) {
			t.Fatalf("lost user environment %s", required)
		}
	}
	if strings.Contains(got, "GIT_") {
		t.Fatal("inherited Git environment could target the wrong repository")
	}
}

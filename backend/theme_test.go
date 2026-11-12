package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestConcurrentConversationThemesStayInTheirOwnStateDirectory(t *testing.T) {
	state := t.TempDir()
	first := &session{context: hello{StateDir: state, FeatureID: 11}}
	second := &session{context: hello{StateDir: state, FeatureID: 12}}
	var writes sync.WaitGroup
	for i, s := range []*session{first, second} {
		writes.Add(1)
		go func() {
			defer writes.Done()
			colors := testPalette()
			colors["primary"] = []string{"#112233", "#aabbcc"}[i]
			raw, _ := json.Marshal(map[string]any{"palette": colors})
			if _, err := s.handle("terminal.theme", raw); err != nil {
				t.Error(err)
			}
		}()
	}
	writes.Wait()
	for i, s := range []*session{first, second} {
		path := filepath.Join(themeDirectory(s.context), "cadencr-theme.yml")
		raw, err := os.ReadFile(path)
		if err != nil || !strings.Contains(string(raw), []string{"#112233", "#aabbcc"}[i]) {
			t.Fatalf("conversation theme was lost or overwritten: %s / %v", raw, err)
		}
	}
	if _, err := os.Stat(filepath.Join(state, "cadencr-theme.yml")); !os.IsNotExist(err) {
		t.Fatal("themes must not use the shared state directory directly")
	}
}

func TestThemeWritesMarkedBaseCommitColorsInEverySection(t *testing.T) {
	palette := testPalette()
	path, err := writeTheme(t.TempDir(), palette)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(string(raw), "markedBaseCommitFgColor"); got != 3 {
		t.Fatalf("markedBaseCommitFgColor appears %d times, want 3", got)
	}
	if got := strings.Count(string(raw), "markedBaseCommitBgColor"); got != 3 {
		t.Fatalf("markedBaseCommitBgColor appears %d times, want 3", got)
	}
	if !strings.Contains(string(raw), fmt.Sprintf("markedBaseCommitFgColor: [\"%s\"]", palette["background"])) {
		t.Fatal("marked base commit foreground must use the background color")
	}
	if !strings.Contains(string(raw), fmt.Sprintf("markedBaseCommitBgColor: [\"%s\"]", palette["warning"])) {
		t.Fatal("marked base commit background must use the warning color")
	}
}

func TestThemeRejectsInvalidWarningColor(t *testing.T) {
	palette := testPalette()
	palette["warning"] = "yellow"
	if _, err := writeTheme(t.TempDir(), palette); err == nil {
		t.Fatal("accepted a non-hex warning color")
	} else if fault, ok := err.(*fault); !ok || fault.Code != "BAD_REQUEST" {
		t.Fatalf("expected BAD_REQUEST, got %v", err)
	}
}

func TestThemeRequiresWarningColor(t *testing.T) {
	palette := testPalette()
	delete(palette, "warning")
	if _, err := writeTheme(t.TempDir(), palette); err == nil {
		t.Fatal("accepted a palette without warning")
	} else if fault, ok := err.(*fault); !ok || fault.Code != "BAD_REQUEST" {
		t.Fatalf("expected BAD_REQUEST, got %v", err)
	}
}

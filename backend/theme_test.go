package main

import (
	"encoding/json"
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

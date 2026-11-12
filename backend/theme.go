package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func themeDirectory(cx hello) string {
	// state_dir is shared by all of the plugin's conversation backends.
	return filepath.Join(cx.StateDir, fmt.Sprintf("feature-%d", cx.FeatureID))
}

func writeTheme(directory string, palette map[string]string) (string, error) {
	for _, name := range []string{"background", "foreground", "muted", "border", "primary", "selection", "error", "warning"} {
		if !hexColor.MatchString(palette[name]) {
			return "", fail("BAD_REQUEST", "Theme color "+name+" must be a six-digit hex color.")
		}
	}
	if strings.Contains(directory, ",") {
		return "", fail("BAD_REQUEST", "LazyGit theme paths cannot contain commas.")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	path := filepath.Join(directory, "cadencr-theme.yml")
	colors := fmt.Sprintf(`    activeBorderColor: ["%s", "bold"]
    inactiveBorderColor: ["%s"]
    optionsTextColor: ["%s"]
    selectedLineBgColor: ["%s"]
    inactiveViewSelectedLineBgColor: ["%s"]
    cherryPickedCommitBgColor: ["%s"]
    cherryPickedCommitFgColor: ["%s"]
    unstagedChangesColor: ["%s"]
    defaultFgColor: ["%s"]
    searchingActiveBorderColor: ["%s", "bold"]
    markedBaseCommitFgColor: ["%s"]
    markedBaseCommitBgColor: ["%s"]
`, palette["primary"], palette["border"], palette["primary"], palette["selection"],
		palette["selection"], palette["selection"], palette["foreground"], palette["error"],
		palette["foreground"], palette["primary"], palette["background"], palette["warning"])
	// Recent LazyGit versions layer darkTheme/lightTheme over theme. Override
	// all three so the host palette also wins over those user preferences.
	document := "gui:\n  theme:\n" + colors + "  darkTheme:\n" + colors + "  lightTheme:\n" + colors
	if previous, err := os.ReadFile(path); err == nil {
		if string(previous) == document {
			return path, nil
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	file, err := os.CreateTemp(directory, ".theme-*.yml")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	if _, err := file.WriteString(document); err != nil {
		file.Close()
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return "", err
	}
	return path, nil
}

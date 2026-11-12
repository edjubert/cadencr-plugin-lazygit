# Changelog

## 0.2.0

- The terminal now uses an opaque CadencR-derived xterm theme and a derived
  16-color ANSI palette, so LazyGit's own colors follow the active CadencR theme.
- The LazyGit theme override now also sets the marked-base-commit colors.
- When a theme change alters the colors LazyGit uses, a "Reload LazyGit
  (theme changed)" button offers a restart; the new process reads the
  latest palette.
- Added a `terminal.stop` backend method that terminates the running
  LazyGit so it can be started again.
- A backend that was restarted while the tab stayed open is now started again
  automatically (at most once every ten seconds) instead of showing an error.
- Reloading LazyGit against a backend older than the tab explains that
  CadencR or the tab must be restarted, and keeps LazyGit running.

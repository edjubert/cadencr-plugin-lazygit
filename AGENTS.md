# cadencr-plugin-lazygit

- Standalone CadencR custom tab launching the installed LazyGit directly in a PTY.
- Bind the process to the host's explicit conversation worktree.
- Use argument arrays; never interpolate paths or user input into shell commands.
- Generate theme overrides only in the host's plugin state directory.
- Keep user LazyGit configuration and authentication intact.
- Test Git interactions in disposable repositories; never commit, push or change a real repository during tests.
- Do not publish a repository, release or registry submission without an explicit request.
- Checks: `npm test`, `npm run test:backend`, `npm run build`, `npm run test:ui`.
- Do not create branches prefixed with `codex/`.

# Prompt de reprise — plugin LazyGit pour CadencR

Travaille dans `~/workspace/edjubert/cadencr-plugin-lazygit`.
Lis `AGENTS.md` et `README.md`, puis inspecte les fichiers et l'état Git.
Réponds en français.

## Objectif et décisions validées

Finaliser un plugin CadencR indépendant qui ouvre le **binaire `lazygit`
installé sur la machine directement dans un terminal PTY**, dans le worktree
de la conversation fourni par le host.

Le projet LazyGit de référence est **https://github.com/jesseduffield/lazygit**.
Utilise son binaire officiel comme programme terminal.

**Le plugin doit pouvoir remplacer l'onglet intégré `git` de CadencR.**
Le manifeste contient déjà :

```json
"tab": {
  "label": "LazyGit",
  "replaces": ["git"]
}
```

Ce mécanisme demande **CadencR 0.16.2 minimum**. Après installation et activation,
l'utilisateur sélectionne LazyGit dans **Settings → Custom tabs →
Replace built-in tabs → Git**. La déclaration seule ne sélectionne pas le
remplacement. Une action native qui ouvre une PR peut réafficher temporairement
l'onglet Git intégré ; le menu `+` permet de revenir à LazyGit.

Le plugin CadencR n'utilise ni Neovim, ni `lazygit.nvim`, ni `snacks.nvim`.
Snacks LazyGit a été configuré séparément dans le Neovim personnel de
l'utilisateur ; cette configuration n'est pas une dépendance du plugin.

## État du dépôt

- Dépôt public `https://github.com/edjubert/cadencr-plugin-lazygit`,
  branche `main`, remote `origin`.
- Version locale `0.1.0`, identifiant de tab `lazygit`.
- UI TypeScript/Vite avec `@cadencr/tab-sdk`, xterm.js et l'addon de redimensionnement.
- Backend Go, protocole stdio CadencR `1`, avec `github.com/creack/pty`.
- Backends déclarés et compilés : macOS arm64, macOS Intel, Linux x86-64.
- Seul macOS arm64 a été exécuté ici ; les autres binaires ont été cross-compilés.
- Icône SVG présente, dépendances npm verrouillées dans `package-lock.json`.
- Distribution locale préparée dans `staging/lazygit`.
- Distribution actualisée et validée le 12 novembre 2026 dans
  `staging/validated-20261112/lazygit` ; le paquet précédent est conservé.
- Les sources et le logo sont versionnés dans le dépôt public. Aucune release
  ni soumission de registry n'a été publiée ; l'installation locale décrite
  dans le README reste à vérifier dans l'application.

Le terminal conserve son processus lors d'un reload de la webview.
La reconnexion redimensionne le PTY et demande un rafraîchissement, même si
les dimensions n'ont pas changé. CadencR reste propriétaire du cycle de vie
du backend ; son arrêt termine la session.
Les requêtes `429` déclenchent un délai partagé sans perdre ou dupliquer les
saisies. Les autres erreurs ne rejouent pas les entrées.

## Thème et configuration

Paramètres du tab :

| Clé | Défaut | Rôle |
| --- | --- | --- |
| `lazygit_path` | `lazygit` | Nom ou chemin absolu du binaire installé |
| `sync_theme` | `true` | Synchronisation des couleurs CadencR |

Le frontend convertit les couleurs CSS en hexadécimal. Le backend écrit
`feature-<feature_id>/cadencr-theme.yml` dans le state directory fourni par
CadencR, puis le passe après la configuration utilisateur avec `--use-config-file`.

- Respecter `LG_CONFIG_FILE` s'il existe ; sinon chercher la configuration via `lazygit -cd`.
- Ne pas réécrire la configuration LazyGit de l'utilisateur.
- Écrire les sections `gui.theme`, `gui.darkTheme` et `gui.lightTheme`.
- Mettre à jour le fichier lors d'un changement de thème, sans redémarrer le processus.
- Isoler le fichier par conversation : `state_dir` est partagé par les backends
  du même tab, et deux conversations ne doivent pas écraser leurs thèmes.
- L'application immédiate dépend du rechargement de configuration de LazyGit ;
  une nouvelle session lit toujours les dernières couleurs.
- Retirer `NO_COLOR` du processus uniquement lorsque la synchronisation est activée.
- Le backend neutralise les variables Git qui pourraient rediriger le dépôt,
  tout en conservant l'environnement d'authentification.

## Vérifications déjà effectuées

Les commandes suivantes ont réussi après les corrections de cette session :

```sh
npm test
npm run test:backend
npm run build
npm run build:backend -- --all
go -C backend vet ./...
CADENCR_LAZYGIT_SMOKE=/opt/homebrew/bin/lazygit npm run test:ui
npm run stage -- staging/validated-20261112/lazygit
```

Les six tests Node vérifient les quotas, les erreurs, le manifeste et la
copie des notices, y compris la licence Go installée hors de `GOROOT` par
Homebrew. Les tests Go avec `-race` vérifient aussi l'isolation des thèmes
de deux conversations simultanées.

Les six tests navigateur vérifient le worktree, la reconnexion sans nouveau
processus, les saisies, le redimensionnement, les couleurs, les quotas,
les erreurs et un lancement du vrai LazyGit `0.66.2`.
Le test réel utilise un dépôt Git temporaire et vérifie la sortie ANSI
correspondant à la couleur primaire du thème, ainsi que l'affichage d'un
fichier propre à ce dépôt.

Le manifeste complet et le backend macOS arm64 ont réussi la validation
CLI CadencR : `starts`, `ready`, `unknown_method`, `malformed_line`,
`concurrent_requests`, `exit_on_stdin_close`, `stdout_clean`.
La CLI `0.15.8` a été compilée dans un répertoire temporaire depuis le tag
officiel CadencR `v0.16.2`, commit
`6fdc42cac06e6d327e04f509f7ec79733b5beb5f`.
La version de la CLI est indépendante de celle de l'application.
La CLI préexistante `0.15.7` ne connaît pas `tab.replaces`.
Le chemin de la CLI compilée pour cette session est :
`/var/folders/_2/c6vcb9s95mg7h3csscgf9s940000gp/T/cadencr-lazygit-validator-mfb9tace/target/debug/cadencr`
(répertoire temporaire, susceptible d'être nettoyé).

Valider le dossier préparé, dont le nom correspond à `id: "lazygit"` :

```sh
cadencr plugin validate staging/validated-20261112/lazygit --kind tab
```

La validation directe du dépôt nommé `cadencr-plugin-lazygit` échoue avec
`ID_MISMATCH`. Le script `stage` exige maintenant le bon nom de dossier
et refuse une destination existante avant toute copie.

Une capture du terminal réel est disponible à
`/tmp/cadencr-lazygit-terminal-validated.png` si elle existe encore.

## Distribution et notices

`scripts/notices.mjs` distribue les licences et notices de la partie frontend,
y compris le helper Vite et les dépendances transitives réellement compilées,
des modules Go, du runtime Go et des dépendances vendoriées de sa bibliothèque
standard. L'index est `dist/THIRD_PARTY_NOTICES.md` et les textes complets sont
dans `dist/LICENSES`. Le binaire officiel LazyGit est installé séparément,
sans être redistribué dans le plugin.

## Travail restant sur demande

1. Finaliser l'installation locale et le choix du remplacement de Git lorsque
   l'utilisateur le demande. Respecter les consentements du host pour le backend natif.
   Vérifier alors l'intégration dans l'application réelle : les tests actuels
   utilisent un navigateur avec le protocole SDK et un vrai backend, et la CLI
   compatible valide le paquet ; le nouveau plugin n'est pas encore installé.
2. Préparer une publication ultérieure seulement sur demande explicite :
   métadonnées de registry avec `min_app_version: "0.16.2"`, archives, preuves
   de tests natifs pour les plateformes annoncées et assets de présentation.

Ne publie pas de dépôt, release, PR, commentaire ou soumission de registry sans
demande explicite dans cette nouvelle session. Ne crée pas de branche `codex/`.
Conserve les fichiers existants et ne touche pas aux autres chantiers de l'utilisateur.

# Release checklist

## 1. Already prepared

- GitHub owner: `Yuyuyuu-21`.
- Package version: `0.1.0`.
- Repository metadata in `package.json` points at
  `https://github.com/Yuyuyuu-21/dsh-workspace-classifier`.
- Initial commit already exists locally.
- Doc screenshots use fictional data only.
- No local absolute paths or real workspace names in tracked text files.

## 2. Verify the tree

- [x] `package.json` version is `0.1.0`.
- [x] `npm run check` passes.
- [x] No local absolute paths (`C:\Users\...`, `D:\...`) in text files.
- [x] No real workspace names, session titles or screenshots in `docs/`.
- [x] `docs/` only contains files referenced by the READMEs.
- [x] `node_modules/`, logs and scratch directories are not tracked.

## 3. Create the GitHub repository

Recommended repository name:

```text
dsh-workspace-classifier
```

Suggested description:

> Add one category/date grouping layer above the native DeepSeek Harness workspace sidebar.

Suggested topics:

```text
deepseek-harness  dsh  dsh-plugin  sidebar  workspace  categories
```

## 4. Push

Initial commit is already created locally. Add the remote and push:

```bash
git remote add origin https://github.com/Yuyuyuu-21/dsh-workspace-classifier.git
git push -u origin main
```

If Git asks for credentials, use a **Personal Access Token** (or SSH).
Do not use an email password.

If the commit author needs to change before pushing:

```bash
git config user.name "your-name"
git config user.email "you@example.com"
git commit --amend --reset-author --no-edit
```

## 5. Create the release

```bash
git tag v0.1.0
git push origin v0.1.0
```

On GitHub:

1. Draft a release from tag `v0.1.0`.
2. Use the `CHANGELOG.md` 0.1.0 section as release notes.
3. Attach `docs/` screenshots if desired.

## 6. Optional npm publishing

The plugin is designed to be installed from Git with `dsh plugin add "link:<path>"`.
If you publish to npm, verify that the `files` list in `package.json` includes everything DSH needs (`lib`, `cordis.patch.yml`, README, LICENSE, NOTICE, docs).

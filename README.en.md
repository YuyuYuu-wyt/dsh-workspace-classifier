# dsh-workspace-classifier

English | [简体中文](README.md)

Adds one category layer above the native workspace list in the **DeepSeek Harness** sidebar, while keeping native session rows and interactions untouched. A small, simple feature that makes managing your Harness projects a little easier.

**0.1.1** · MIT · DSH `>= 0.2.0-rc.2`

> Screenshots use fictional workspace names and paths.

> Built with AI assistance.

## Features

- **Two modes**: Categories / Dates.
- **Two separator styles**: section band / group cards, selectable in the category manager.
- **Custom categories**: create, rename, delete, assign workspaces.
- **Date groups**: automatic year / month / day grouping; collapsed by default.
- **Manual ordering**: drag group headers, or use Move up / Move down.
- **Collapse state**: categories remember it; date groups start collapsed on every re-entry.
- **Inactive workspaces**: workspaces with no sessions or no updates for over a week are folded inside their original category/date group as “N inactive”; click to reveal them in place, without creating another category.
- **Special groups**: Uncategorized and the native ungrouped section are included.
- **Indicators**: pending reminders, running sessions (including subagents) and scheduled tasks.
- **Header toggle**: turn the layer off and restore the native list instantly.

## Screenshots

| View | Light | Dark |
| --- | --- | --- |
| Categories | ![Categories (light)](docs/sidebar-categories.png) | ![Categories (dark)](docs/sidebar-dark.png) |
| Category manager | ![Category manager (light)](docs/category-manager.png) | ![Category manager (dark)](docs/category-manager-dark.png) |
| Date groups | ![Date groups (light)](docs/date-groups.png) | ![Date groups (dark)](docs/date-groups-dark.png) |

## Install

Requires DSH `>= 0.2.0-rc.2` and the `dsh` CLI.

One-line install (Windows PowerShell):

```powershell
irm https://raw.githubusercontent.com/YuyuYuu-wyt/dsh-workspace-classifier/main/install.ps1 | iex
```

Or manually:

```powershell
git clone https://github.com/YuyuYuu-wyt/dsh-workspace-classifier.git
cd dsh-workspace-classifier
dsh plugin --profile desktop add "link:$PWD"
```

Refresh DSH (`Ctrl+Shift+R`). A grouping icon appears on the right of the **Workspace** header row.

Uninstall:

```bash
dsh plugin --profile desktop remove dsh-workspace-classifier
```

## Usage

1. Click the grouping icon in the Workspace header.
2. Switch between Categories and Dates; Dates adds year / month / day.
3. Open the gear menu to manage categories and assignments.
4. Click a group header to collapse or expand it.
5. Click the header icon again to restore the native list.

## Compatibility

Does not replace the native sidebar slot, patch official packages, or alter native session rows. It relies on DSH's native workspace-list DOM, so major DSH upgrades may require selector updates.

## License

MIT. See [LICENSE](LICENSE).

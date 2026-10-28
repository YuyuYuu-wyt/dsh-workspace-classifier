# Changelog

All notable changes to this project are documented here.

## 0.1.1 — 2026-10-28

本次更新集中在侧栏分组的识别方式、自动收纳和提示准确性

### 新增

- **两种分组分隔风格**：分区带 / 分组卡片，可在「分类管理 → 分组分隔」切换，选择会保存。
- **不活跃工作区就地折叠**：没有会话，或最近一次更新超过一周的工作区，会在原分类/日期分组内显示为「N 不活跃」；点击就地展开。
- **子智能体运行提示**：子智能体运行时也会点燃所属工作区/分组的运行提示点，不再只有主智能体工作才闪烁。

## 0.1.0 — 2026-10-28

First public release.

- Native sidebar overlay: one grouping layer above the untouched DSH workspace list.
- Custom categories with a master–detail manager (create / rename / delete / assign / search).
- Date grouping by workspace creation date: year / month / day.
- Categories remember collapse state; date groups always start collapsed on re-entry.
- Manual category ordering: group-header drag, manager up/down, manager row drag.
- Reverse assignment on uncheck (returns to the previous category, or Uncategorized).
- Native ungrouped sessions included as a collapsible group.
- Unified reminder, running and scheduled-task indicators.
- Native-style tooltips and an integrated header on/off toggle.
- Performance work: scoped sidebar observer, relevant-snapshot apply gating, animation pause when the sidebar is hidden.

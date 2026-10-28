/**
 * dsh-workspace-classifier — client half (native-list overlay).
 *
 * The official `ui-workspace` browser stays in charge of the sidebar: every
 * native session row keeps its status dot, schedule clock, hover card, menu,
 * drag and archive behaviour. This plugin only adds ONE level above the
 * workspace sections: it inserts collapsible category/date headers into the
 * native workspace list, reorders the native section nodes with CSS `order`,
 * and adds a small aggregate reminder/schedule marker on the native workspace
 * row. Turning the footer switch off removes every injected node.
 *
 * State (categories, assignments, collapse, acknowledged failed turns) stays in
 * localStorage. The host half serves the latest failed turn per Session as JSON.
 */

window.__ModuleLoader__.load({
	id: 'dsh-workspace-classifier',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const react = require('react')
		const h = react.createElement

		/* ------------------------------------------------------------------ *
		 * Persisted state
		 * ------------------------------------------------------------------ */

		const STORAGE_KEY = 'dsh.workspace-classifier.state.v2'
		const STYLE_ID = 'dsh-workspace-classifier/overlay-styles-v2'
		const DEFAULTS = {
			version: 1,
			overlay: true,
			mode: 'custom',
			granularity: 'month',
			categories: [],
			assign: {},
			unassignedCollapsed: false,
			dateCollapsed: {},
			ackedError: {},
			separator: 'band',
			inactiveOpen: {}
		}
		const MODES = ['custom', 'date']
		const SEPARATORS = ['band', 'card']
		const SEPARATOR_LABELS = { band: '分区带', card: '分组卡片' }
		const INACTIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000
		const GRANULARITIES = ['year', 'month', 'day']
		const GRANULARITY_LABELS = { year: '年', month: '月', day: '日' }

		function sanitize(raw) {
			const merged = Object.assign({}, DEFAULTS, raw || {})
			return {
				version: 1,
				overlay: merged.overlay !== false,
				mode: MODES.indexOf(merged.mode) === -1 ? 'custom' : merged.mode,
				granularity: GRANULARITIES.indexOf(merged.granularity) === -1 ? 'month' : merged.granularity,
				categories: Array.isArray(merged.categories)
					? merged.categories
							.filter((entry) => entry && typeof entry.id === 'string')
							.map((entry) => ({
								id: entry.id,
								name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : '未命名分类',
								collapsed: entry.collapsed === true
							}))
					: [],
				assign: merged.assign && typeof merged.assign === 'object' ? Object.assign({}, merged.assign) : {},
				unassignedCollapsed: merged.unassignedCollapsed === true,
				separator: SEPARATORS.indexOf(merged.separator) === -1 ? 'band' : merged.separator,
				inactiveOpen: merged.inactiveOpen && typeof merged.inactiveOpen === 'object' ? Object.assign({}, merged.inactiveOpen) : {},
				// 日期分组每次重新进入日期模式都从全部折叠开始，不恢复上次的展开状态。
				dateCollapsed: {},
				ackedError: merged.ackedError && typeof merged.ackedError === 'object' ? Object.assign({}, merged.ackedError) : {}
			}
		}

		function readState() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY)
				return sanitize(raw === null ? null : JSON.parse(raw))
			} catch (error) {
				console.warn('[workspace-classifier] could not read saved state', error)
				return sanitize(null)
			}
		}

		let viewState = readState()
		const stateListeners = new Set()

		function getViewState() {
			return viewState
		}

		function updateViewState(patch) {
			viewState = Object.assign({}, viewState, typeof patch === 'function' ? patch(viewState) : patch)
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(viewState))
			} catch (error) {
				console.warn('[workspace-classifier] could not persist state', error)
			}
			for (const listener of Array.from(stateListeners)) {
				try {
					listener()
				} catch (error) {
					console.error('[workspace-classifier] state listener failed', error)
				}
			}
		}

		function subscribeViewState(listener) {
			stateListeners.add(listener)
			return () => stateListeners.delete(listener)
		}

		function useViewState() {
			return react.useSyncExternalStore(subscribeViewState, getViewState, getViewState)
		}

		let idSeq = 0
		function newCategoryId() {
			idSeq += 1
			return 'cat_' + Date.now().toString(36) + '_' + idSeq.toString(36)
		}

		/* ------------------------------------------------------------------ *
		 * Derivations
		 * ------------------------------------------------------------------ */

		function timeOf(value) {
			if (typeof value === 'number' && Number.isFinite(value)) return value
			const parsed = Date.parse(typeof value === 'string' ? value : '')
			return Number.isNaN(parsed) ? 0 : parsed
		}

		function pad2(value) {
			return value < 10 ? '0' + value : String(value)
		}

		function dateGroupOf(workspace, granularity) {
			const time = timeOf(workspace.createdAt)
			if (time === 0) return { id: 'date:unknown', name: '未知日期', rank: Number.NEGATIVE_INFINITY }
			const date = new Date(time)
			const year = date.getFullYear()
			const month = date.getMonth() + 1
			const day = date.getDate()
			if (granularity === 'year') return { id: 'date:' + year, name: year + '年', rank: time }
			if (granularity === 'day') {
				const key = year + '-' + pad2(month) + '-' + pad2(day)
				return { id: 'date:' + key, name: key, rank: time }
			}
			return { id: 'date:' + year + '-' + pad2(month), name: year + '年' + month + '月', rank: time }
		}

		const REMINDER_RANK = { error: 3, question: 2, result: 1 }
		const REMINDER_LABELS = { error: '报错', question: '待处理', result: '已完成' }

		function errorViewOf(sessionId, turnErrors) {
			const value = turnErrors === undefined ? undefined : turnErrors[sessionId]
			if (value === null || typeof value !== 'object' || typeof value.turn !== 'number') return undefined
			if (value.kind !== 'error') return undefined
			return { turn: value.turn, message: typeof value.message === 'string' && value.message !== '' ? value.message : '上次回合报错' }
		}

		function reminderOf(summary, status, errorView, ackedError) {
			if (summary === undefined) return undefined
			if (errorView !== undefined) {
				const acked = ackedError[summary.idKey]
				if (acked === undefined || acked < errorView.turn) return 'error'
			}
			if (status !== undefined && status.pendingInteraction !== undefined) return 'question'
			if (status !== undefined && status.completionUnread === true) return 'result'
			return undefined
		}

		function stronger(left, right) {
			const a = left === undefined ? 0 : REMINDER_RANK[left]
			const b = right === undefined ? 0 : REMINDER_RANK[right]
			return b > a ? right : left
		}

		function normalizeSchedules(value) {
			const list = Array.isArray(value) ? value : []
			const map = new Map()
			for (const entry of list) {
				if (entry === null || typeof entry !== 'object') continue
				const record = entry.record !== null && typeof entry.record === 'object' ? entry.record : entry
				const sessionId = entry.sessionId !== undefined ? entry.sessionId : record.sessionId
				const status = entry.status !== undefined ? entry.status : record.status
				if (typeof sessionId !== 'string') continue
				if (typeof status === 'string' && status !== 'active') continue
				const rows = map.get(sessionId) || []
				rows.push(entry.id !== undefined ? entry.id : record.id)
				map.set(sessionId, rows)
			}
			return map
		}

		/* ------------------------------------------------------------------ *
		 * Styles
		 * ------------------------------------------------------------------ */

		const CSS = `
[data-wsc-toolbar]{display:flex;align-items:center;flex-wrap:nowrap;gap:4px;padding:5px 4px 4px;font-size:12.5px;color:inherit;order:-10000;width:100%;box-sizing:border-box}
[data-wsc-toolbar] .wsc-toolbar-groups{display:flex;align-items:center;flex-wrap:wrap;gap:2px;min-width:0;flex:1 1 auto}
[data-wsc-toolbar] .wsc-toolbar-gear{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);cursor:pointer;padding:0;opacity:.75;margin-left:2px}
[data-wsc-toolbar] .wsc-toolbar-gear:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent));opacity:1}
[data-wsc-toolbar] .wsc-toolbar-gear svg{width:16px;height:16px;display:block}
[data-wsc-toolbar] button{border:0;border-radius:5px;background:color-mix(in srgb,currentColor 8%,transparent);color:inherit;font:inherit;font-size:12.5px;line-height:1.5;padding:3px 6px;cursor:pointer;opacity:.72;white-space:nowrap}
[data-wsc-toolbar] button:hover{opacity:1;background:color-mix(in srgb,currentColor 14%,transparent)}
[data-wsc-toolbar] button[data-on="true"]{opacity:1;font-weight:600;background:color-mix(in srgb,currentColor 18%,transparent)}
[data-wsc-group]{display:flex;align-items:center;gap:5px;min-height:32px;padding:4px 8px 4px 10px;border-radius:6px;cursor:pointer;color:inherit;font-size:14px;font-weight:500;line-height:22px;user-select:none;width:100%;box-sizing:border-box}
[data-wsc-group]:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
[data-wsc-group] .wsc-chev{display:inline-flex;width:12px;justify-content:center;opacity:.55;transition:transform .15s var(--ds-ease-in-out,ease-in-out)}
[data-wsc-group][draggable="true"]{cursor:grab}
[data-wsc-group][data-dragging="true"]{opacity:.5}
[data-wsc-group][data-drop="true"]{box-shadow:inset 0 2px 0 var(--dsw-alias-brand-primary,#3b82f6)}
[data-wsc-group] .wsc-gmarkers{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto}
[data-wsc-group] .wsc-inactive-toggle{display:inline-flex;align-items:center;gap:2px;flex:none;border:0;border-radius:4px;background:color-mix(in srgb,currentColor 7%,transparent);color:inherit;font:inherit;font-size:10.5px;line-height:1.5;padding:1px 4px;opacity:.55;cursor:pointer;white-space:nowrap}
[data-wsc-group] .wsc-inactive-toggle:hover{opacity:.9;background:color-mix(in srgb,currentColor 13%,transparent)}
[data-wsc-group] .wsc-inactive-chev{display:inline-block;font-size:9px;line-height:1;transition:transform .15s var(--ds-ease-in-out,ease-in-out)}
[data-wsc-group] .wsc-inactive-toggle[data-open="true"] .wsc-inactive-chev{transform:rotate(90deg)}
.wsc-reveal{animation:wsc-reveal 1.5s ease}
@keyframes wsc-reveal{0%{box-shadow:inset 0 0 0 2px var(--dsw-alias-brand-primary,#3b82f6);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 10%,transparent)}100%{box-shadow:inset 0 0 0 2px transparent;background:transparent}}
[data-wsc-group][data-collapsed="true"] .wsc-chev{transform:rotate(-90deg)}

/* 分组分隔风格：由设置里的“分组分隔”切换，只影响注入的分组头/工作区容器。 */
[data-wsc-sep="band"] [data-wsc-group]{
  position:relative;
  margin-top:9px;
  padding:5px 8px 5px 11px;
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 12%,transparent);
  box-shadow:none;
}
[data-wsc-sep="band"] [data-wsc-group]:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3b82f6) 16%,transparent)}
[data-wsc-sep="band"] [data-wsc-group]::before{
  content:"";position:absolute;left:3px;top:50%;width:3px;height:17px;border-radius:2px;
  background:var(--dsw-alias-state-business-primary,#3b82f6);transform:translateY(-50%);
}
[data-wsc-sep="band"] [data-wsc-group] .wsc-gcount{opacity:.56}

[data-wsc-sep="card"]{row-gap:0!important}
[data-wsc-sep="card"] [data-wsc-group]{
  margin:8px 2px 0;
  padding:5px 8px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 92%,currentColor 8%);
  border:1px solid color-mix(in srgb,currentColor 16%,transparent);
  border-bottom:0;
  border-radius:8px 8px 0 0;
}
[data-wsc-sep="card"] [data-wsc-group][data-wsc-card-collapsed="true"]{
  border-bottom:1px solid color-mix(in srgb,currentColor 16%,transparent);
  border-radius:8px;
}
[data-wsc-sep="card"] [data-wsc-group]:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 84%,var(--dsw-alias-state-business-primary,#3b82f6) 8%)}
[data-wsc-sep="card"] [data-wsc-card="body"]{
  margin:0 2px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 92%,currentColor 8%);
  border-left:1px solid color-mix(in srgb,currentColor 16%,transparent);
  border-right:1px solid color-mix(in srgb,currentColor 16%,transparent);
  border-radius:0;
}
[data-wsc-sep="card"] [data-wsc-card="body"]:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 86%,var(--dsw-alias-state-business-primary,#3b82f6) 6%)}
[data-wsc-sep="card"] [data-wsc-card-last="true"]{
  border-bottom:1px solid color-mix(in srgb,currentColor 16%,transparent);
  border-radius:0 0 8px 8px;
  padding-bottom:2px;
}
[data-wsc-group] .wsc-gtext{display:flex;align-items:center;gap:4px;flex:1 1 auto;min-width:0}
[data-wsc-group] .wsc-glabel{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-wsc-group] .wsc-gcount{flex:none;font-size:12.5px;font-weight:400;opacity:.42;font-variant-numeric:tabular-nums}
[data-wsc-group] .wsc-count{opacity:.42;font-size:12px;font-weight:400;font-variant-numeric:tabular-nums}
.wsc-pulse{display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 auto;animation:wsc-pulse 1.7s ease-in-out infinite;margin-right:2px;vertical-align:middle}
@keyframes wsc-pulse{0%,100%{opacity:.25}50%{opacity:1}}
[data-wsc-anim-paused] .wsc-pulse{animation-play-state:paused}
.wsc-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.wsc-dot-error{background:var(--dsw-alias-state-error-primary,#ef4444)}
.wsc-dot-question{background:var(--dsw-alias-state-business-primary,#3b82f6)}
.wsc-dot-result{background:var(--dsw-alias-state-success-primary,#22c55e)}
.wsc-clock{display:inline-flex;align-items:center;gap:1px;opacity:.55;font-size:10px;font-variant-numeric:tabular-nums}
.wsc-ws-marker{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;margin:0 3px}
.wsc-ws-marker .wsc-count{opacity:.45;font-size:10px}
[data-wsc-modal]{position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.32);overflow:auto}
[data-wsc-modal] .wsc-panel{position:relative;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2,Canvas));color:var(--dsw-alias-label-primary,CanvasText);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.35);font-size:13px;overflow:hidden}
.wsc-m-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent))}
.wsc-m-heading h2{margin:0;font-size:16px;font-weight:600;line-height:22px}
.wsc-m-heading p{margin:2px 0 0;font-size:12.5px;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.75}
.wsc-m-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin-left:auto;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);cursor:pointer;flex:none}
.wsc-m-close:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent))}
.wsc-m-body{display:grid;grid-template-columns:228px minmax(0,1fr);flex:1 1 0;min-height:0;overflow:hidden}
.wsc-m-rail{display:flex;flex-direction:column;min-height:0;padding:10px 8px;border-right:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent))}
.wsc-m-rail-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 8px 8px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.72}
.wsc-m-addbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font-size:17px;line-height:1;cursor:pointer;flex:none}
.wsc-m-addbtn:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent))}
.wsc-m-rail-list{display:flex;flex-direction:column;gap:2px;overflow:auto;flex:1 1 auto;min-height:0}
.wsc-m-cat{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;font-size:14px;line-height:22px;text-align:left;padding:7px 8px;cursor:pointer;flex:none}
.wsc-m-cat svg{color:var(--dsw-alias-label-tertiary,currentColor);flex:none}
.wsc-m-cat:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent))}
.wsc-m-cat[data-on="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 11%,transparent);color:var(--dsw-alias-label-primary,currentColor)}
.wsc-m-cat[data-on="true"] svg{color:var(--dsw-alias-brand-primary,#3b82f6)}
.wsc-m-cat-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wsc-m-cat[data-on="true"] .wsc-m-cat-name{font-weight:600}
.wsc-m-count{flex:none;min-width:18px;text-align:right;font-size:12px;opacity:.5;font-variant-numeric:tabular-nums}
.wsc-m-rail-empty{padding:8px;font-size:13px;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.6}
.wsc-m-rail-tip{padding:8px 8px 2px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.5}
.wsc-m-rail-foot{display:flex;gap:6px;padding:8px 4px 2px;margin-top:6px;border-top:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent))}
.wsc-m-appearance{display:flex;flex-direction:column;gap:6px;padding:8px 8px 7px;margin-top:4px;border-top:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent))}
.wsc-m-appearance-label{font-size:11px;font-weight:600;letter-spacing:.03em;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.7}
.wsc-m-seg{display:flex;gap:2px;padding:2px;border-radius:7px;background:color-mix(in srgb,currentColor 6%,transparent)}
.wsc-m-seg button{flex:1 1 0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;font-size:12px;line-height:1.3;padding:5px 4px;cursor:pointer;white-space:nowrap}
.wsc-m-seg button:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent))}
.wsc-m-seg button[data-on="true"]{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2,Canvas));color:var(--dsw-alias-label-primary,CanvasText);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.wsc-m-newbtn{width:100%;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;font-size:13px;text-align:left;padding:7px 8px;cursor:pointer}
.wsc-m-newbtn:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent))}
.wsc-m-input{flex:1 1 auto;min-width:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 20%,transparent));border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;padding:6px 9px;outline:none}
.wsc-m-input:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 18%,transparent)}
.wsc-m-primary{border:0;border-radius:6px;background:var(--dsw-alias-brand-primary,#3b82f6);color:var(--dsw-alias-bg-layer-1,#fff);font:inherit;font-size:12.5px;font-weight:500;line-height:20px;padding:4px 11px;cursor:pointer;white-space:nowrap}
.wsc-m-primary:hover{filter:brightness(1.06)}
.wsc-m-detail{display:flex;flex-direction:column;position:relative;min-width:0;min-height:0;overflow:hidden}
.wsc-m-detail-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:14px 16px 4px}
.wsc-m-detail-title{flex:1 1 auto;min-width:0;font-size:16px;font-weight:600;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wsc-m-rename{flex:1 1 auto;font-size:15px}
.wsc-m-detail-count{flex:none;font-size:12.5px;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.7;font-variant-numeric:tabular-nums}
.wsc-m-actions{display:flex;align-items:center;gap:2px;margin-left:auto}
.wsc-m-act{display:inline-flex;align-items:center;gap:4px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;font-size:13px;line-height:20px;padding:2px 8px;cursor:pointer;white-space:nowrap}
.wsc-m-act:disabled{opacity:.35;cursor:default}
.wsc-m-cat[data-dragging="true"]{opacity:.5}
.wsc-m-cat[data-drop="true"]{box-shadow:inset 0 2px 0 var(--dsw-alias-brand-primary,#3b82f6)}
.wsc-m-cat[draggable="true"]{cursor:grab}
.wsc-m-act:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent));color:var(--dsw-alias-label-primary,currentColor)}
.wsc-m-search{padding:2px 16px 8px}
.wsc-m-search input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 20%,transparent));border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px;padding:7px 10px;outline:none}
.wsc-m-search input:focus{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 18%,transparent)}
.wsc-m-ws-list{flex:1 1 0;min-height:0;overflow:auto;padding:2px 10px 8px}
.wsc-m-ws{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer}
.wsc-m-ws:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent))}
.wsc-m-ws[data-assigned="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 8%,transparent)}
.wsc-m-ws input[type="checkbox"]{flex:none;width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary,#3b82f6);cursor:pointer}
.wsc-m-ws-icon{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;flex:none;color:var(--dsw-alias-label-tertiary,currentColor)}
.wsc-m-ws-text{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.wsc-m-ws-name{font-size:14px;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wsc-m-ws-path{font-size:12px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,currentColor);opacity:.7}
.wsc-m-badge{flex:none;margin-left:auto;font-size:11.5px;line-height:17px;padding:1px 6px;border-radius:4px;color:var(--dsw-alias-label-tertiary,currentColor);background:color-mix(in srgb,currentColor 7%,transparent);white-space:nowrap}
.wsc-m-foot{display:flex;align-items:center;gap:10px;padding:11px 16px;border-top:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));font-size:12.5px;color:var(--dsw-alias-label-tertiary,currentColor)}
.wsc-m-foot-count{margin-left:auto;flex:none;opacity:.7;font-variant-numeric:tabular-nums}
.wsc-m-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;flex:1 1 auto;padding:48px 24px;text-align:center}
.wsc-m-empty-icon{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9px;background:color-mix(in srgb,currentColor 7%,transparent);color:var(--dsw-alias-label-tertiary,currentColor);margin-bottom:2px}
.wsc-m-empty-title{font-size:15px;font-weight:600}
.wsc-m-empty .wsc-m-primary{margin-top:8px}
.wsc-m-empty-small{position:absolute;inset:auto 24px 52px;flex:none;padding:16px;font-size:12.5px;color:var(--dsw-alias-label-tertiary,currentColor);text-align:center}
[data-wsc-modal] .wsc-manager{display:flex;flex-direction:column;width:min(760px,94vw);max-width:min(760px,94vw);height:min(82vh,680px);max-height:min(82vh,720px);padding:0;overflow:hidden;font-size:14px}
@media (max-width:640px){[data-wsc-modal] .wsc-m-body{grid-template-columns:1fr}[data-wsc-modal] .wsc-m-rail{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 12%,transparent));max-height:190px}}
.wsc-header-toggle{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);cursor:pointer;padding:0;flex:none;margin:0;opacity:.85}
.wsc-header-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent));opacity:1}
.wsc-header-toggle[data-on="true"]{color:var(--dsw-alias-brand-primary,#3b82f6);opacity:1}
.wsc-header-toggle .wsc-toggle-top{fill:transparent;transition:fill .15s ease}
.wsc-header-toggle[data-on="true"] .wsc-toggle-top{fill:currentColor}
.wsc-header-toggle svg{width:16px;height:16px;display:block}
.wsc-tip{position:fixed;z-index:100;display:flex;align-items:center;gap:6px;background:#2c2c2e;color:#fff;font-size:13px;line-height:20px;padding:3px 5px 3px 7px;border-radius:8px;white-space:pre-line;pointer-events:none;visibility:hidden;opacity:0;transform:translateX(-50%);transition:opacity .12s ease,visibility .12s ease}
`

		function ensureStyles() {
			let style = document.getElementById(STYLE_ID)
			if (style === null) {
				for (const stale of document.querySelectorAll('style[id^="dsh-workspace-classifier/overlay-styles"]')) stale.remove()
				style = document.createElement('style')
				style.id = STYLE_ID
				document.head.appendChild(style)
			}
			if (style.textContent !== CSS) style.textContent = CSS
		}

		/* ------------------------------------------------------------------ *
		 * Overlay: one added level above the native workspace sections
		 * ------------------------------------------------------------------ */

		const LIST_SELECTOR = '[data-row-key^="workspace:"]'
		const UNGROUPED_ID = '__native_ungrouped__'
		const GROUP_ATTR = 'data-wsc-group'
		const TOOLBAR_ATTR = 'data-wsc-toolbar'
		const MARKER_ATTR = 'data-wsc-workspace-marker'

		function createOverlay(ctx) {
			const workspacesStore = ctx.get('workspaces').list
			const sessionsStore = ctx.get('sessions').list
			const uiSession = ctx.get('uiSession')
			const statusStore = uiSession === undefined ? undefined : uiSession.sessionStatus
			let turnErrors = {}
			let schedules = new Map()
			let timers = []
			let observer
			let observerRoot
			let frame
			let running = false
			let applying = false
			let lastApplyAt = 0
			let lastRelevantSignature
			const APPLY_MIN_INTERVAL = 80
			const disposers = []

			const queueApply = () => {
				if (!running || frame !== undefined) return
				const wait = Math.max(0, APPLY_MIN_INTERVAL - (performance.now() - lastApplyAt))
				frame = setTimeout(() => {
					frame = undefined
					lastApplyAt = performance.now()
					apply()
				}, wait)
			}

			// 只观察工作区列表所在的侧栏子树，绝不监听整个 document.body 的
			// 流式输出 DOM；否则聊天每个 token 都会触发一次全量 apply。
			const ensureNativeObserver = () => {
				const list = findList()
				if (list === undefined) return
				const root = list.parentElement === null ? list : list.parentElement
				if (observer === undefined) observer = new MutationObserver(() => queueApply())
				if (observerRoot === root) return
				observer.disconnect()
				observerRoot = root
				observer.observe(root, { childList: true, subtree: true })
			}

			const readScheduleCatalog = () => {
				try {
					const remote = ctx.remote
					if (remote === undefined || remote.schedule === undefined || typeof remote.schedule.catalog !== 'function') return Promise.resolve([])
					return Promise.resolve(remote.schedule.catalog()).then((result) => (result !== null && result !== undefined && result.ok ? result.value : []))
				} catch (error) {
					return Promise.resolve([])
				}
			}

			const readTurnErrors = () => {
				fetch('/workspace-classifier/turn-errors', { cache: 'no-store' })
					.then((response) => (response.ok ? response.json() : undefined))
					.then((value) => {
						if (!running) return
						if (value !== null && typeof value === 'object') {
							turnErrors = value
							notifyRelevantChange()
						}
					})
					.catch(() => {})
			}

			// 只有真正影响侧栏展示的 store 字段变化时才安排 apply。
			const relevantSignature = () => {
				const workspaces = workspacesStore.getSnapshot()
				const sessions = sessionsStore.getSnapshot()
				const statuses = statusStore === undefined ? undefined : statusStore.getSnapshot()
				const parts = []
				for (const workspace of workspaces.items || []) {
					parts.push(workspace.workspaceId, workspace.createdAt || '', (workspace.sessionIds || []).join(','))
				}
				parts.push('arch:' + (workspaces.archivedSessionIds || []).join(','))
				const ids = sessions.ids || Object.keys(sessions.byId || {})
				parts.push('sessions:' + ids.length + ':' + ids.join(','))
				if (statuses !== undefined) {
					parts.push('status:' + statuses.size)
					for (const [id, status] of statuses) {
						parts.push(id + (status.running ? 'r' : '') + (status.pendingInteraction !== undefined ? 'p' : '') + (status.completionUnread ? 'u' : ''))
					}
				}
				for (const id of ids) {
					if (sessions.byId?.[id]?.running === true) parts.push('run:' + id)
				}
				for (const [parentId, projection] of Object.entries(sessions.projectionsBySession || {})) {
					const catalog = projection?.values?.subagentCatalog
					if (!Array.isArray(catalog) || catalog.length === 0) continue
					parts.push('sub:' + parentId + ':' + catalog.map((child) => {
						const status = statuses === undefined ? undefined : statuses.get(child.id)
						const running = (status === undefined ? undefined : status.running) ?? sessions.byId?.[child.id]?.running === true
						return child.id + (running ? 'r' : '')
					}).join(','))
				}
				parts.push('view:' + JSON.stringify(getViewState()))
				parts.push('errors:' + JSON.stringify(turnErrors))
				parts.push('sched:' + Array.from(schedules, ([id, rows]) => id + ':' + rows.length).join(','))
				return parts.join('|')
			}

			const notifyRelevantChange = () => {
				const signature = relevantSignature()
				if (signature === lastRelevantSignature) return
				lastRelevantSignature = signature
				queueApply()
			}

			const findList = () => {
				const row = document.querySelector(LIST_SELECTOR)
				if (row === null) return undefined
				const group = row.parentElement === null ? null : row.parentElement.parentElement
				if (group === null) return undefined
				const list = group.parentElement
				if (list === null) return undefined
				return list
			}

			const nativeEntries = (list) => {
				const entries = []
				for (const child of Array.from(list.children)) {
					if (child.getAttribute(TOOLBAR_ATTR) !== null) continue
					if (child.getAttribute(GROUP_ATTR) !== null) continue
					const row = child.querySelector(LIST_SELECTOR)
					if (row === null) continue
					const rawId = row.getAttribute('data-row-key').slice('workspace:'.length)
					const workspaceId = rawId === '' ? '__native_ungrouped__' : rawId
					entries.push({ element: child, workspaceId })
				}
				return entries
			}

			const deriveGroups = (hasUngrouped) => {
				const snapshot = workspacesStore.getSnapshot()
				const items = snapshot.items || []
				const sessionSnapshot = sessionsStore.getSnapshot()
				const sessionById = sessionSnapshot.byId || {}
				const state = getViewState()
				if (state.mode === 'date') {
					const buckets = new Map()
					for (const workspace of items) {
							const group = dateGroupOf(workspace, state.granularity)
						const bucket = buckets.get(group.id) || { id: group.id, name: group.name, rank: group.rank, members: [] }
						bucket.members.push(workspace)
						buckets.set(group.id, bucket)
					}
					const groups = Array.from(buckets.values()).sort((left, right) => right.rank - left.rank)
					for (const group of groups) group.members.sort((left, right) => timeOf(right.createdAt) - timeOf(left.createdAt))
					const mapped = groups.map((group) => ({
						key: group.id,
						label: group.name,
						collapsed: state.dateCollapsed[group.id] !== false, // 日期分组默认折叠；false 表示用户上次展开
						members: group.members,
						kind: 'date'
					}))
					if (hasUngrouped) mapped.push({
						key: UNGROUPED_ID,
						label: '无固定工作区',
						collapsed: state.dateCollapsed[UNGROUPED_ID] !== false, // 日期模式默认折叠
						members: [{
	workspaceId: '__native_ungrouped__',
	title: '无固定工作区',
	path: '',
	createdAt: undefined,
	sessionIds: []
}],
						kind: 'date'
					})
					return mapped
				}
				// 分类按手动顺序（拖动或管理弹窗上移/下移）排列。
				const orderedCategories = state.categories.slice()
				const groups = orderedCategories.map((category) => ({
					key: category.id,
					label: category.name,
					collapsed: category.collapsed === true,
					members: [],
					kind: 'custom',
					categoryId: category.id
				}))
				const unassigned = { key: '__unassigned__', label: '未分类', collapsed: state.unassignedCollapsed === true, members: [], kind: 'custom', categoryId: undefined }
				for (const workspace of items) {
					const target = state.assign[workspace.workspaceId]
					const group = groups.find((entry) => entry.categoryId === target)
					if (group === undefined) unassigned.members.push(workspace)
					else group.members.push(workspace)
				}
				if (unassigned.members.length > 0 || groups.length === 0) groups.push(unassigned)
				if (hasUngrouped) {
					const target = state.assign[UNGROUPED_ID]
					const group = target === undefined ? undefined : groups.find((entry) => entry.categoryId === target)
					if (group === undefined) groups.push({
						key: UNGROUPED_ID,
						label: '无固定工作区',
						collapsed: state.dateCollapsed[UNGROUPED_ID] === true,
						members: [{
							workspaceId: UNGROUPED_ID,
							title: '无固定工作区',
							path: '',
							createdAt: undefined,
							sessionIds: []
						}],
						kind: 'custom',
						categoryId: undefined
					})
					else group.members.push({
						workspaceId: UNGROUPED_ID,
						title: '无固定工作区',
						path: '',
						createdAt: undefined,
						sessionIds: []
					})
				}
				return groups
			}

			// 没有会话，或最近一次会话更新已超过一周的工作区；仍在运行的不算不活跃。
			const isInactiveWorkspace = (workspace, sessionSnapshot, statuses, now) => {
				if (workspace.workspaceId === UNGROUPED_ID) return false
				const sessionIds = workspace.sessionIds || []
				if (sessionIds.length === 0) return true
				if (sessionIds.some((sessionId) => statuses !== undefined && statuses.get(sessionId)?.running === true)) return false
				const byId = sessionSnapshot.byId || {}
				let latest = timeOf(workspace.createdAt)
				for (const sessionId of sessionIds) {
					const summary = byId[sessionId]
					if (summary === undefined) continue
					latest = Math.max(latest, timeOf(summary.updatedAt), timeOf(summary.createdAt))
				}
				return latest > 0 && now - latest > INACTIVE_AFTER_MS
			}

			const sessionIsRunning = (sessionId, statuses, byId) => {
				const status = statuses === undefined ? undefined : statuses.get(sessionId)
				return (status === undefined ? undefined : status.running) ?? byId[sessionId]?.running === true
			}

			// 子智能体的运行状态不体现在父会话自身的 running 上；从原生 subagentCatalog 里把子会话汇总到父会话/工作区。
			const runningSubagentCount = (parentId, sessionSnapshot, statuses) => {
				const byId = sessionSnapshot.byId || {}
				const catalog = sessionSnapshot.projectionsBySession?.[parentId]?.values?.subagentCatalog
				let children = Array.isArray(catalog) && catalog.length > 0 ? catalog : undefined
				if (children === undefined) {
					children = []
					for (const id of sessionSnapshot.ids || Object.keys(byId)) {
						const summary = byId[id]
						if (summary !== undefined && summary.origin === 'subagent' && (summary.parentId === parentId || summary.parentSession === parentId)) children.push({ id })
					}
				}
				let count = 0
				for (const child of children) {
					if (child !== null && child !== undefined && sessionIsRunning(child.id, statuses, byId)) count += 1
				}
				return count
			}

			const aggregate = () => {
				const snapshot = workspacesStore.getSnapshot()
				const sessionSnapshot = sessionsStore.getSnapshot()
				const statuses = statusStore === undefined ? undefined : statusStore.getSnapshot()
				const state = getViewState()
				const archived = new Set(snapshot.archivedSessionIds || [])
				const byId = sessionSnapshot.byId || {}
				const result = new Map()
				for (const workspace of snapshot.items || []) {
					const counts = { error: 0, question: 0, result: 0 }
					let runningCount = 0
					let scheduleCount = 0
					for (const sessionId of workspace.sessionIds || []) {
						const summary = byId[sessionId]
						if (summary !== undefined && summary.origin !== 'subagent' && summary.blank !== true && !archived.has(sessionId)) {
							const status = statuses === undefined ? undefined : statuses.get(sessionId)
							if (status !== undefined && status.running === true) runningCount += 1
							runningCount += runningSubagentCount(sessionId, sessionSnapshot, statuses)
							const kind = reminderOf(
								Object.assign({ idKey: sessionId }, summary),
								status,
								errorViewOf(sessionId, turnErrors),
								state.ackedError
							)
							if (kind !== undefined) counts[kind] += 1
						}
						const tasks = schedules.get(sessionId)
						if (tasks !== undefined) scheduleCount += tasks.length
					}
					const kind = counts.error > 0 ? 'error' : counts.question > 0 ? 'question' : counts.result > 0 ? 'result' : undefined
					if (kind !== undefined || scheduleCount > 0 || runningCount > 0) result.set(workspace.workspaceId, { kind, count: kind === undefined ? 0 : counts[kind], counts, runningCount, scheduleCount })
				}
				// 「无固定工作区」是不属于任何 workspace 的会话，单独聚合提醒/运行/定时任务。
				const knownSessions = new Set()
				for (const workspace of snapshot.items || []) for (const sessionId of workspace.sessionIds || []) knownSessions.add(sessionId)
				const ungroupedCounts = { error: 0, question: 0, result: 0 }
				let ungroupedRunning = 0
				let ungroupedSchedule = 0
				for (const sessionId of Object.keys(byId)) {
					if (knownSessions.has(sessionId)) continue
					const summary = byId[sessionId]
					if (summary === undefined || summary.origin === 'subagent' || summary.blank === true || archived.has(sessionId)) continue
					const status = statuses === undefined ? undefined : statuses.get(sessionId)
					if (status !== undefined && status.running === true) ungroupedRunning += 1
					ungroupedRunning += runningSubagentCount(sessionId, sessionSnapshot, statuses)
					const kind = reminderOf(Object.assign({ idKey: sessionId }, summary), status, errorViewOf(sessionId, turnErrors), state.ackedError)
					if (kind !== undefined) ungroupedCounts[kind] += 1
					const tasks = schedules.get(sessionId)
					if (tasks !== undefined) ungroupedSchedule += tasks.length
				}
				const ungroupedKind = ungroupedCounts.error > 0 ? 'error' : ungroupedCounts.question > 0 ? 'question' : ungroupedCounts.result > 0 ? 'result' : undefined
				if (ungroupedKind !== undefined || ungroupedSchedule > 0 || ungroupedRunning > 0) {
					result.set(UNGROUPED_ID, { kind: ungroupedKind, count: ungroupedKind === undefined ? 0 : ungroupedCounts[ungroupedKind], counts: ungroupedCounts, runningCount: ungroupedRunning, scheduleCount: ungroupedSchedule })
				}
				return result
			}

			const aggregateGroup = (members, perWorkspace) => {
				const counts = { error: 0, question: 0, result: 0 }
				let runningCount = 0
				let scheduleCount = 0
				for (const workspace of members) {
					const entry = perWorkspace.get(workspace.workspaceId)
					if (entry === undefined) continue
					if (entry.kind !== undefined) counts[entry.kind] += entry.count
					runningCount += entry.runningCount || 0
					scheduleCount += entry.scheduleCount
				}
				const kind = counts.error > 0 ? 'error' : counts.question > 0 ? 'question' : counts.result > 0 ? 'result' : undefined
				return { kind, count: kind === undefined ? 0 : counts[kind], counts, runningCount, scheduleCount }
			}

			const REMINDER_KINDS = ['error', 'question', 'result']
			// 所有 .wsc-pulse 共用同一个 1.7s 周期，并用同一时间原点对齐相位，
			// 避免节点创建/展开时间不同导致看起来频率不一致。
			const PULSE_DURATION = 1.7
			const pulseOrigin = performance.now() / 1000
			const alignPulsePhase = (dot) => {
				const phase = ((performance.now() / 1000 - pulseOrigin) % PULSE_DURATION + PULSE_DURATION) % PULSE_DURATION
				dot.style.animationDelay = (-phase).toFixed(3) + 's'
			}

			// Keep a single dot node and only update its tooltip: replacing the node on every
			// apply would restart the opacity animation, which made it look like it only lit up.
			const syncPulse = (parent, counts, runningCount = 0) => {
				const parts = []
				let total = 0
				for (const kind of REMINDER_KINDS) {
					const count = counts === undefined ? 0 : counts[kind] || 0
					if (count === 0) continue
					total += count
					parts.push(REMINDER_LABELS[kind] + ' ' + count)
				}
				if (runningCount > 0) {
					total += runningCount
					parts.push('正在工作 ' + runningCount)
				}
				let dot = parent.querySelector('.wsc-pulse')
				if (total === 0) {
					if (dot !== null) dot.remove()
					return
				}
				if (dot === null) {
					dot = document.createElement('span')
					dot.className = 'wsc-pulse'
					alignPulsePhase(dot)
					parent.insertBefore(dot, parent.firstChild)
				}
				dot.setAttribute('data-wsc-tip', parts.join('，'))
			}

			const GEAR_BODY = 'M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0911 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z'
			const makeSettingsIcon = (size) => {
				const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
				svg.setAttribute('width', String(size))
				svg.setAttribute('height', String(size))
				svg.setAttribute('viewBox', '0 0 16 16')
				svg.setAttribute('fill', 'none')
				svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
				svg.setAttribute('aria-hidden', 'true')
				svg.setAttribute('stroke-width', '1')
				const circle = document.createElementNS('http://www.w3.org/2000/svg', 'path')
				circle.setAttribute('d', 'M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z')
				circle.setAttribute('stroke', 'currentColor')
				const body = document.createElementNS('http://www.w3.org/2000/svg', 'path')
				body.setAttribute('d', GEAR_BODY)
				body.setAttribute('stroke', 'currentColor')
				body.setAttribute('stroke-miterlimit', '10')
				svg.appendChild(circle)
				svg.appendChild(body)
				return svg
			}

			const syncClock = (parent, count) => {
				let span = parent.querySelector('.wsc-clock')
				if (count <= 0) {
					if (span !== null) span.remove()
					return
				}
				if (span === null) {
					span = document.createElement('span')
					span.className = 'wsc-clock'
					parent.appendChild(span)
				}
				span.setAttribute('data-wsc-tip', count === 1 ? '1 个自动化任务' : count + ' 个自动化任务')
				span.textContent = '⏱' + (count > 1 ? String(count) : '')
			}

			const fillMarker = (target, entry) => {
				if (entry === undefined) {
					target.textContent = ''
					return
				}
				syncPulse(target, entry.counts, entry.runningCount || 0)
				syncClock(target, entry.scheduleCount)
			}

			const toolbar = (list) => {
				let bar = list.querySelector('[' + TOOLBAR_ATTR + ']')
				if (bar === null) {
					bar = document.createElement('div')
					bar.setAttribute(TOOLBAR_ATTR, '')
					list.insertBefore(bar, list.firstChild)
				}
				const state = getViewState()
				// 只在模式/粒度真正变化时重建按钮，避免会话更新引发的 apply 反复
				// 重建工具栏，导致鼠标悬浮按钮时闪烁。
				const modeKey = state.mode === 'date' ? 'date:' + state.granularity : 'custom'
				if (bar.getAttribute('data-wsc-mode') !== modeKey) {
					bar.textContent = ''
					const makeButton = (label, active, kind, onClick) => {
						const button = document.createElement('button')
						button.type = 'button'
						button.textContent = label
						button.setAttribute('data-wsc-kind', kind)
						if (active) button.setAttribute('data-on', 'true')
						button.addEventListener('click', (event) => {
							event.stopPropagation()
							onClick()
						})
						return button
					}
					const groups = document.createElement('div')
					groups.className = 'wsc-toolbar-groups'
					groups.appendChild(makeButton('分类', state.mode === 'custom', 'mode:custom', () => updateViewState({ mode: 'custom' })))
					groups.appendChild(makeButton('日期', state.mode === 'date', 'mode:date', () => {
						if (getViewState().mode !== 'date') updateViewState({ mode: 'date', dateCollapsed: {} })
					}))
					if (state.mode === 'date') {
						for (const granularity of GRANULARITIES) {
							groups.appendChild(makeButton(GRANULARITY_LABELS[granularity], state.granularity === granularity, 'granularity:' + granularity, () => updateViewState({ granularity })))
						}
					}
					bar.appendChild(groups)
					const gear = document.createElement('button')
					gear.type = 'button'
					gear.className = 'wsc-toolbar-gear'
					gear.setAttribute('data-wsc-tip', '管理分类')
					gear.setAttribute('aria-label', '管理分类')
					gear.appendChild(makeSettingsIcon(16))
					gear.addEventListener('click', (event) => {
						event.stopPropagation()
						openManager()
					})
					bar.appendChild(gear)
					bar.setAttribute('data-wsc-mode', modeKey)
				} else {
					const active = new Set(['mode:' + state.mode])
					if (state.mode === 'date') active.add('granularity:' + state.granularity)
					for (const button of bar.querySelectorAll('button[data-wsc-kind]')) {
						if (active.has(button.getAttribute('data-wsc-kind'))) button.setAttribute('data-on', 'true')
						else button.removeAttribute('data-on')
					}
				}
				return bar
			}

			const alignSessionIndent = (entry) => {
				const sessions = Array.from(entry.element.querySelectorAll('[data-row-key^="session:"]'))
				if (sessions.length === 0) return
				const row = entry.element.querySelector(LIST_SELECTOR)
				if (row === null) return
				let folder
				for (const child of row.children) {
					if (child.getAttribute(MARKER_ATTR) !== null) continue
					if (child.getBoundingClientRect().width === 0) continue
					folder = child
					break
				}
				if (folder === undefined) return
				// 先批量读，再批量写，避免每个会话 read→write 触发强制重排。
				const folderLeft = folder.getBoundingClientRect().left
				const lefts = sessions.map((session) => session.getBoundingClientRect().left)
				for (let index = 0; index < sessions.length; index += 1) {
					const session = sessions[index]
					const desired = Math.max(0, Math.round(folderLeft - lefts[index]))
					const value = desired + 'px'
					if (session.style.paddingLeft !== value) session.style.paddingLeft = value
					if (session.getAttribute('data-wsc-session-indent') !== '') session.setAttribute('data-wsc-session-indent', '')
				}
			}

			const decorateWorkspace = (entry, aggregateEntry) => {
				let marker = entry.element.querySelector('[' + MARKER_ATTR + ']')
				if (marker === null) {
					marker = document.createElement('span')
					marker.setAttribute(MARKER_ATTR, '')
					marker.className = 'wsc-ws-marker'
					const row = entry.element.querySelector(LIST_SELECTOR)
					if (row !== null) row.insertBefore(marker, row.firstChild)
					else entry.element.insertBefore(marker, entry.element.firstChild)
				}
				fillMarker(marker, aggregateEntry)
				alignSessionIndent(entry)
			}

			let draggedCategoryId = undefined
			let suppressGroupClick = false

			const moveCategory = (sourceId, targetId) => {
				if (sourceId === targetId) return
				const state = getViewState()
				const categories = state.categories.slice()
				const from = categories.findIndex((category) => category.id === sourceId)
				const to = categories.findIndex((category) => category.id === targetId)
				if (from < 0 || to < 0 || from === to) return
				const [moved] = categories.splice(from, 1)
				categories.splice(to, 0, moved)
				updateViewState({ categories })
			}

			// DSH's native sidebar rows animate with a FLIP glide (200ms ease-out) and
			// 100ms fades for entering/leaving rows (AnimatedRows in dsh-client-ui-workspace).
			const ROW_GLIDE_MS = 200
			const ROW_FADE_MS = 100
			const ROW_EASING = 'ease-out'
			const sectionVisibility = new WeakMap()
			const rowAnimations = new WeakMap()
			let layoutReady = false
			let lastCollapseSignature

			const animatableRows = (list) => {
				return Array.from(list.children).filter((child) => {
					if (child.getAttribute(TOOLBAR_ATTR) !== null) return false
					if (child.getAttribute(GROUP_ATTR) !== null) return true
					return child.querySelector(LIST_SELECTOR) !== null
				})
			}

			const captureLayout = (list) => {
				const positions = new Map()
				for (const child of animatableRows(list)) {
					if (child.style.display === 'none') continue
					positions.set(child, child.getBoundingClientRect())
				}
				return positions
			}

			const fadeExit = (element, rect) => {
				const clone = element.cloneNode(true)
				clone.setAttribute('data-wsc-exit', '')
				clone.style.display = ''
				clone.style.transform = 'none'
				clone.style.position = 'fixed'
				clone.style.left = rect.left + 'px'
				clone.style.top = rect.top + 'px'
				clone.style.width = rect.width + 'px'
				clone.style.height = rect.height + 'px'
				clone.style.margin = '0'
				clone.style.boxSizing = 'border-box'
				clone.style.pointerEvents = 'none'
				clone.style.zIndex = '40'
				document.body.appendChild(clone)
				const animation = clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ROW_FADE_MS, easing: ROW_EASING, fill: 'forwards' })
				animation.onfinish = () => clone.remove()
			}

			const cancelRowAnimation = (element) => {
				const previous = rowAnimations.get(element)
				if (previous === undefined) return
				previous.onfinish = null
				previous.cancel()
				rowAnimations.delete(element)
			}

			const animateLayout = (list, before) => {
				if (before === undefined) return
				const reduceMotion = window.matchMedia !== undefined && window.matchMedia('(prefers-reduced-motion: reduce)').matches
				if (reduceMotion || typeof Element.prototype.animate !== 'function') return
				const after = animatableRows(list).filter((child) => child.style.display !== 'none')
				const afterSet = new Set(after)
				for (const [element, rect] of before) {
					if (afterSet.has(element)) continue
					if (!element.isConnected) fadeExit(element, rect)
					else if (element.style.display === 'none') fadeExit(element, rect)
				}
				for (const element of after) {
					const previousRect = before.get(element)
					if (previousRect === undefined) {
						const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ROW_FADE_MS, easing: ROW_EASING })
						animation.onfinish = () => animation.cancel()
						continue
					}
					const nextRect = element.getBoundingClientRect()
					const dy = previousRect.top - nextRect.top
					if (Math.abs(dy) < 0.5) continue
					cancelRowAnimation(element)
					const animation = element.animate(
						[{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0)' }],
						{ duration: ROW_GLIDE_MS, easing: ROW_EASING }
					)
					rowAnimations.set(element, animation)
					animation.onfinish = () => {
						rowAnimations.delete(element)
						animation.cancel()
					}
				}
			}

			const setSectionVisible = (element, visible) => {
				sectionVisibility.set(element, visible)
				element.style.display = visible ? '' : 'none'
			}

			const toggleInactiveGroup = (key) => {
				updateViewState((current) => {
					const next = Object.assign({}, current.inactiveOpen)
					if (next[key] === true) delete next[key]
					else next[key] = true
					return { inactiveOpen: next }
				})
			}

			const ensureGroupHeader = (list, group) => {
				let header = list.querySelector('[' + GROUP_ATTR + '="' + group.key + '"]')
				if (header !== null && header.querySelector('.wsc-gtext') === null) {
					header.remove()
					header = null
				}
				if (header === null) {
					header = document.createElement('div')
					header.setAttribute(GROUP_ATTR, group.key)
					header.setAttribute('role', 'button')
					header.tabIndex = 0
					const chev = document.createElement('span')
					chev.className = 'wsc-chev'
					chev.textContent = '▾'
					const textWrap = document.createElement('span')
					textWrap.className = 'wsc-gtext'
					const label = document.createElement('span')
					label.className = 'wsc-glabel'
					const count = document.createElement('span')
					count.className = 'wsc-gcount'
					textWrap.appendChild(label)
					textWrap.appendChild(count)
					const markers = document.createElement('span')
					markers.className = 'wsc-gmarkers'
					header.appendChild(chev)
					header.appendChild(textWrap)
					header.appendChild(markers)
					const inactiveToggle = document.createElement('button')
					inactiveToggle.type = 'button'
					inactiveToggle.className = 'wsc-inactive-toggle'
					inactiveToggle.style.display = 'none'
					inactiveToggle.setAttribute('data-wsc-tip', '没有会话，或超过一周未更新')
					const inactiveChev = document.createElement('span')
					inactiveChev.className = 'wsc-inactive-chev'
					inactiveChev.textContent = '▸'
					const inactiveLabel = document.createElement('span')
					inactiveLabel.className = 'wsc-inactive-label'
					inactiveToggle.appendChild(inactiveChev)
					inactiveToggle.appendChild(inactiveLabel)
					inactiveToggle.addEventListener('click', (event) => {
						event.preventDefault()
						event.stopPropagation()
						toggleInactiveGroup(group.key)
					})
					inactiveToggle.addEventListener('keydown', (event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault()
							event.stopPropagation()
							toggleInactiveGroup(group.key)
						}
					})
					header.appendChild(inactiveToggle)
					header.addEventListener('click', () => {
						if (suppressGroupClick) {
							suppressGroupClick = false
							return
						}
						toggleGroup(group)
					})
					header.addEventListener('keydown', (event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault()
							toggleGroup(group)
						}
					})
					header.addEventListener('dragstart', (event) => {
						const categoryId = header.getAttribute('data-category-id')
						if (categoryId === null || categoryId === '') {
							event.preventDefault()
							return
						}
						draggedCategoryId = categoryId
						event.dataTransfer.effectAllowed = 'move'
						event.dataTransfer.setData('text/plain', categoryId)
						header.setAttribute('data-dragging', 'true')
					})
					header.addEventListener('dragend', () => {
						draggedCategoryId = undefined
						header.removeAttribute('data-dragging')
						header.removeAttribute('data-drop')
					})
					header.addEventListener('dragover', (event) => {
						const categoryId = header.getAttribute('data-category-id')
						if (draggedCategoryId === undefined || categoryId === null || categoryId === '') return
						if (draggedCategoryId === categoryId) return
						event.preventDefault()
						event.dataTransfer.dropEffect = 'move'
						header.setAttribute('data-drop', 'true')
					})
					header.addEventListener('dragleave', () => header.removeAttribute('data-drop'))
					header.addEventListener('drop', (event) => {
						header.removeAttribute('data-drop')
						if (draggedCategoryId === undefined) return
						const targetId = header.getAttribute('data-category-id')
						if (targetId === null || targetId === '') return
						event.preventDefault()
						suppressGroupClick = true
						moveCategory(draggedCategoryId, targetId)
					})
					list.appendChild(header)
				}
				return header
			}

			const toggleGroup = (group) => {
				const state = getViewState()
				if (group.kind === 'date') {
					const next = Object.assign({}, state.dateCollapsed)
					// 缺省视为折叠；显式 false 表示用户上次展开。
					const collapsed = next[group.key] !== false
					next[group.key] = !collapsed
					updateViewState({ dateCollapsed: next })
					return
				}
				if (group.key === UNGROUPED_ID) {
					const next = Object.assign({}, state.dateCollapsed)
					const collapsed = group.kind === 'date' ? next[UNGROUPED_ID] !== false : next[UNGROUPED_ID] === true
					next[UNGROUPED_ID] = !collapsed
					updateViewState({ dateCollapsed: next })
					return
				}
				if (group.categoryId === undefined) {
					updateViewState({ unassignedCollapsed: !state.unassignedCollapsed })
					return
				}
				updateViewState({
					categories: state.categories.map((category) =>
						category.id === group.categoryId ? Object.assign({}, category, { collapsed: !category.collapsed }) : category
					)
				})
			}

			const openManager = () => {
				const existing = document.querySelector('[data-wsc-modal]')
				if (existing !== null) existing.remove()
				const modal = document.createElement('div')
				modal.setAttribute('data-wsc-modal', '')
				const panel = document.createElement('div')
				panel.className = 'wsc-panel wsc-manager'
				modal.appendChild(panel)
				const closeModal = () => {
					if (unsubscribeStore !== undefined) {
						unsubscribeStore()
						unsubscribeStore = undefined
					}
					modal.remove()
				}
				modal.addEventListener('click', (event) => {
					if (event.target === modal) closeModal()
				})
				let selectedId
				let adding = false
				let renaming = false
				let query = ''
				// 记录本次管理会话里“工作区从哪个分类移到当前分类”，
				// 这样在目标分类取消勾选时可以回到原分类，而不是直接变成未分类。
				const lastMoves = new Map()
				const scrollState = { ws: 0, rail: 0 }
				let draggedManagerCategoryId

				const orderedCategories = () => getViewState().categories.slice()

				const reorderCategories = (sourceId, targetId) => {
					if (sourceId === targetId) return
					const categories = getViewState().categories.slice()
					const from = categories.findIndex((category) => category.id === sourceId)
					const to = categories.findIndex((category) => category.id === targetId)
					if (from < 0 || to < 0 || from === to) return
					const [moved] = categories.splice(from, 1)
					categories.splice(to, 0, moved)
					updateViewState({ categories })
					selectedId = sourceId
					renaming = false
					render()
				}

				const moveCategoryByStep = (categoryId, delta) => {
					const categories = getViewState().categories.slice()
					const from = categories.findIndex((category) => category.id === categoryId)
					const to = from + delta
					if (from < 0 || to < 0 || to >= categories.length) return
					const [moved] = categories.splice(from, 1)
					categories.splice(to, 0, moved)
					updateViewState({ categories })
					selectedId = categoryId
					render()
				}

				const makeFolderIcon = () => {
					const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
					svg.setAttribute('width', '15')
					svg.setAttribute('height', '15')
					svg.setAttribute('viewBox', '0 0 16 16')
					svg.setAttribute('fill', 'none')
					svg.setAttribute('aria-hidden', 'true')
					const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
					path.setAttribute('d', 'M1.75 3.6c0-.58.47-1.05 1.05-1.05h2.78c.28 0 .55.11.75.31l1.47 1.47c.2.2.47.31.75.31h5.65c.58 0 1.05.47 1.05 1.05v6.8c0 .58-.47 1.05-1.05 1.05H2.8c-.58 0-1.05-.47-1.05-1.05V3.6Z')
					path.setAttribute('stroke', 'currentColor')
					path.setAttribute('stroke-width', '1.1')
					svg.appendChild(path)
					return svg
				}

				const makeCloseIcon = () => {
					const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
					svg.setAttribute('width', '16')
					svg.setAttribute('height', '16')
					svg.setAttribute('viewBox', '0 0 16 16')
					svg.setAttribute('aria-hidden', 'true')
					for (const d of ['M4 4L12 12', 'M12 4L4 12']) {
						const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
						path.setAttribute('d', d)
						path.setAttribute('stroke', 'currentColor')
						path.setAttribute('stroke-width', '1.2')
						path.setAttribute('stroke-linecap', 'round')
						svg.appendChild(path)
					}
					return svg
				}

				const makeButton = (label, onClick, className) => {
					const button = document.createElement('button')
					button.type = 'button'
					button.className = className === undefined ? 'wsc-m-act' : className
					button.textContent = label
					button.addEventListener('click', onClick)
					return button
				}

				const render = () => {
					const state = getViewState()
					const snapshot = workspacesStore.getSnapshot()
					const workspaces = snapshot.items || []
					const items = workspaces.concat(
						document.querySelector('[data-row-key="workspace:"]') === null
							? []
							: [{
								workspaceId: UNGROUPED_ID,
								title: '无固定工作区',
								path: '不属于任何工作区的会话'
							}]
					)
					const categories = orderedCategories()
					if (selectedId !== undefined && categories.every((category) => category.id !== selectedId)) selectedId = undefined
					if (selectedId === undefined && categories.length > 0) selectedId = categories[0].id
					const selected = categories.find((category) => category.id === selectedId)
					const counts = new Map()
					for (const target of Object.values(state.assign)) counts.set(target, (counts.get(target) || 0) + 1)
					panel.textContent = ''

					const head = document.createElement('div')
					head.className = 'wsc-m-head'
					const heading = document.createElement('div')
					heading.className = 'wsc-m-heading'
					const title = document.createElement('h2')
					title.textContent = '分类管理'
					const subtitle = document.createElement('p')
					subtitle.textContent = '设置分组外观，并管理分类与工作区'
					heading.appendChild(title)
					heading.appendChild(subtitle)
					head.appendChild(heading)
					const close = document.createElement('button')
					close.type = 'button'
					close.className = 'wsc-m-close'
					close.setAttribute('data-wsc-tip', '关闭')
					close.setAttribute('aria-label', '关闭')
					close.appendChild(makeCloseIcon())
					close.addEventListener('click', () => closeModal())
					head.appendChild(close)
					panel.appendChild(head)

					const body = document.createElement('div')
					body.className = 'wsc-m-body'
					panel.appendChild(body)

					/* ---------------- left rail ---------------- */
					const rail = document.createElement('aside')
					rail.className = 'wsc-m-rail'
					const railHead = document.createElement('div')
					railHead.className = 'wsc-m-rail-head'
					const railLabel = document.createElement('span')
					railLabel.textContent = '分类 · ' + categories.length
					railHead.appendChild(railLabel)
					const add = document.createElement('button')
					add.type = 'button'
					add.className = 'wsc-m-addbtn'
					add.setAttribute('data-wsc-tip', '新建分类')
					add.setAttribute('aria-label', '新建分类')
					add.textContent = '+'
					add.addEventListener('click', () => {
						adding = true
						renaming = false
						render()
					})
					railHead.appendChild(add)
					rail.appendChild(railHead)
					const railList = document.createElement('div')
					railList.className = 'wsc-m-rail-list'
					for (const category of categories) {
						const item = document.createElement('button')
						item.type = 'button'
						item.className = 'wsc-m-cat'
						if (category.id === selectedId) item.setAttribute('data-on', 'true')
						item.appendChild(makeFolderIcon())
						const name = document.createElement('span')
						name.className = 'wsc-m-cat-name'
						name.textContent = category.name
						item.appendChild(name)
						const count = document.createElement('span')
						count.className = 'wsc-m-count'
						count.textContent = String(counts.get(category.id) || 0)
						item.appendChild(count)
						item.addEventListener('click', () => {
							selectedId = category.id
							renaming = false
							query = ''
							render()
						})
						item.draggable = true
						item.addEventListener('dragstart', (event) => {
							draggedManagerCategoryId = category.id
							event.dataTransfer.effectAllowed = 'move'
							event.dataTransfer.setData('text/plain', category.id)
							item.setAttribute('data-dragging', 'true')
						})
						item.addEventListener('dragend', () => {
							draggedManagerCategoryId = undefined
							item.removeAttribute('data-dragging')
							item.removeAttribute('data-drop')
						})
						item.addEventListener('dragover', (event) => {
							if (draggedManagerCategoryId === undefined || draggedManagerCategoryId === category.id) return
							event.preventDefault()
							event.dataTransfer.dropEffect = 'move'
							item.setAttribute('data-drop', 'true')
						})
						item.addEventListener('dragleave', () => item.removeAttribute('data-drop'))
						item.addEventListener('drop', (event) => {
							item.removeAttribute('data-drop')
							if (draggedManagerCategoryId === undefined || draggedManagerCategoryId === category.id) return
							event.preventDefault()
							reorderCategories(draggedManagerCategoryId, category.id)
							draggedManagerCategoryId = undefined
						})
						railList.appendChild(item)
					}
					if (categories.length === 0) {
						const empty = document.createElement('div')
						empty.className = 'wsc-m-rail-empty'
						empty.textContent = '还没有分类'
						railList.appendChild(empty)
					}
					rail.appendChild(railList)
					const railTip = document.createElement('div')
					railTip.className = 'wsc-m-rail-tip'
					railTip.textContent = '拖动分类，或用上移/下移调整顺序'
					rail.appendChild(railTip)
					const appearance = document.createElement('div')
					appearance.className = 'wsc-m-appearance'
					const appearanceLabel = document.createElement('div')
					appearanceLabel.className = 'wsc-m-appearance-label'
					appearanceLabel.textContent = '分组分隔'
					appearance.appendChild(appearanceLabel)
					const appearanceSeg = document.createElement('div')
					appearanceSeg.className = 'wsc-m-seg'
					for (const separator of SEPARATORS) {
						const option = document.createElement('button')
						option.type = 'button'
						option.textContent = SEPARATOR_LABELS[separator]
						if (state.separator === separator) option.setAttribute('data-on', 'true')
						option.addEventListener('click', () => {
							updateViewState({ separator })
							render()
						})
						appearanceSeg.appendChild(option)
					}
					appearance.appendChild(appearanceSeg)
					rail.appendChild(appearance)
					const railFoot = document.createElement('div')
					railFoot.className = 'wsc-m-rail-foot'
					if (adding) {
						const input = document.createElement('input')
						input.className = 'wsc-m-input'
						input.placeholder = '新分类名称'
						input.addEventListener('keydown', (event) => {
							if (event.key === 'Enter') createCategory(input.value)
							if (event.key === 'Escape') {
								adding = false
								render()
							}
						})
						const confirm = document.createElement('button')
						confirm.type = 'button'
						confirm.className = 'wsc-m-primary'
						confirm.textContent = '创建'
						confirm.addEventListener('click', () => createCategory(input.value))
						railFoot.appendChild(input)
						railFoot.appendChild(confirm)
						requestAnimationFrame(() => input.focus())
					} else {
						const newButton = document.createElement('button')
						newButton.type = 'button'
						newButton.className = 'wsc-m-newbtn'
						newButton.textContent = '+ 新建分类'
						newButton.addEventListener('click', () => {
							adding = true
							renaming = false
							render()
						})
						railFoot.appendChild(newButton)
					}
					rail.appendChild(railFoot)
					body.appendChild(rail)

					/* ---------------- right detail ---------------- */
					const detail = document.createElement('section')
					detail.className = 'wsc-m-detail'
					if (selected === undefined) {
						const empty = document.createElement('div')
						empty.className = 'wsc-m-empty'
						const icon = document.createElement('div')
						icon.className = 'wsc-m-empty-icon'
						icon.appendChild(makeFolderIcon())
						empty.appendChild(icon)
						const emptyTitle = document.createElement('div')
						emptyTitle.className = 'wsc-m-empty-title'
						emptyTitle.textContent = '还没有分类'
						empty.appendChild(emptyTitle)
						const emptyButton = document.createElement('button')
						emptyButton.type = 'button'
						emptyButton.className = 'wsc-m-primary'
						emptyButton.textContent = '新建第一个分类'
						emptyButton.addEventListener('click', () => {
							adding = true
							renaming = false
							render()
						})
						empty.appendChild(emptyButton)
						detail.appendChild(empty)
					} else {
						const detailHead = document.createElement('div')
						detailHead.className = 'wsc-m-detail-head'
						if (renaming) {
							const input = document.createElement('input')
							input.className = 'wsc-m-input wsc-m-rename'
							input.value = selected.name
							input.addEventListener('keydown', (event) => {
								if (event.key === 'Enter') saveRename(selected.id, input.value)
								if (event.key === 'Escape') {
									renaming = false
									render()
								}
							})
							detailHead.appendChild(input)
							detailHead.appendChild(makeButton('保存', () => saveRename(selected.id, input.value), 'wsc-m-primary'))
							detailHead.appendChild(makeButton('取消', () => {
								renaming = false
								render()
							}, 'wsc-m-act'))
							requestAnimationFrame(() => {
								input.focus()
								input.select()
							})
						} else {
							const detailTitle = document.createElement('div')
							detailTitle.className = 'wsc-m-detail-title'
							detailTitle.textContent = selected.name
							detailHead.appendChild(detailTitle)
							const detailCount = document.createElement('span')
							detailCount.className = 'wsc-m-detail-count'
							detailCount.textContent = String(counts.get(selected.id) || 0) + ' 个工作区'
							detailHead.appendChild(detailCount)
							const actions = document.createElement('div')
							actions.className = 'wsc-m-actions'
							const orderedIds = state.categories.map((category) => category.id)
							const currentIndex = orderedIds.indexOf(selected.id)
							const up = makeButton('上移', () => moveCategoryByStep(selected.id, -1))
							up.disabled = currentIndex <= 0
							up.setAttribute('data-wsc-tip', '上移分类')
							const down = makeButton('下移', () => moveCategoryByStep(selected.id, 1))
							down.disabled = currentIndex < 0 || currentIndex >= orderedIds.length - 1
							down.setAttribute('data-wsc-tip', '下移分类')
							actions.appendChild(up)
							actions.appendChild(down)
							actions.appendChild(makeButton('重命名', () => {
								renaming = true
								adding = false
								render()
							}))
							actions.appendChild(makeButton('删除', () => {
								if (!window.confirm('删除分类「' + selected.name + '」？其下工作区会回到未分类。')) return
								const assign = Object.assign({}, getViewState().assign)
								for (const [workspaceId, target] of Object.entries(assign)) if (target === selected.id) delete assign[workspaceId]
								updateViewState({ categories: getViewState().categories.filter((entry) => entry.id !== selected.id), assign })
								selectedId = undefined
								render()
							}))
							detailHead.appendChild(actions)
						}
						detail.appendChild(detailHead)

						const search = document.createElement('div')
						search.className = 'wsc-m-search'
						const searchInput = document.createElement('input')
						searchInput.placeholder = '搜索工作区…'
						searchInput.value = query
						searchInput.addEventListener('input', () => {
							query = searchInput.value
							const rows = detail.querySelectorAll('.wsc-m-ws')
							const needle = query.trim().toLowerCase()
							rows.forEach((row) => {
								row.style.display = needle === '' || row.getAttribute('data-search').includes(needle) ? '' : 'none'
							})
						})
						search.appendChild(searchInput)
						detail.appendChild(search)

						const list = document.createElement('div')
						list.className = 'wsc-m-ws-list'
						let visible = 0
						for (const workspace of items) {
							const current = state.assign[workspace.workspaceId]
							const row = document.createElement('label')
							row.className = 'wsc-m-ws'
							row.setAttribute('data-search', (workspace.title || workspace.path || '').toLowerCase() + ' ' + (workspace.path || '').toLowerCase())
							if (current === selected.id) row.setAttribute('data-assigned', 'true')
							const checkbox = document.createElement('input')
							checkbox.type = 'checkbox'
							checkbox.checked = current === selected.id
							checkbox.addEventListener('change', () => {
								const scroller = detail.querySelector('.wsc-m-ws-list')
								const scrollTop = scroller === null ? 0 : scroller.scrollTop
								const workspaceId = workspace.workspaceId
								const before = getViewState().assign[workspaceId]
								const next = Object.assign({}, getViewState().assign)
								if (checkbox.checked) {
									if (before !== selected.id) lastMoves.set(workspaceId, { from: before, to: selected.id })
									next[workspaceId] = selected.id
								} else {
									const move = lastMoves.get(workspaceId)
									if (move !== undefined && move.to === selected.id) {
										// 取消勾选：优先回到本次移动前的分类；原本未分类则回到未分类。
										if (move.from === undefined) delete next[workspaceId]
										else next[workspaceId] = move.from
										lastMoves.delete(workspaceId)
									} else if (next[workspaceId] === selected.id) {
										delete next[workspaceId]
									}
								}
								updateViewState({ assign: next })
								render()
								const restored = panel.querySelector('.wsc-m-ws-list')
								if (restored !== null) restored.scrollTop = scrollTop
							})
							row.appendChild(checkbox)
							const icon = document.createElement('span')
							icon.className = 'wsc-m-ws-icon'
							icon.appendChild(makeFolderIcon())
							row.appendChild(icon)
							const text = document.createElement('span')
							text.className = 'wsc-m-ws-text'
							const name = document.createElement('span')
							name.className = 'wsc-m-ws-name'
							name.textContent = workspace.title || workspace.path
							const path = document.createElement('span')
							path.className = 'wsc-m-ws-path'
							path.textContent = workspace.path || ''
							text.appendChild(name)
							text.appendChild(path)
							row.appendChild(text)
							if (current !== undefined && current !== selected.id) {
								const other = state.categories.find((category) => category.id === current)
								if (other !== undefined) {
									const badge = document.createElement('span')
									badge.className = 'wsc-m-badge'
									badge.textContent = '已在「' + other.name + '」'
									row.appendChild(badge)
								}
							}
							list.appendChild(row)
							visible += 1
						}
						detail.appendChild(list)
						const needle = query.trim().toLowerCase()
						if (needle !== '') {
							for (const row of list.querySelectorAll('.wsc-m-ws')) {
								if (!row.getAttribute('data-search').includes(needle)) row.style.display = 'none'
							}
						}
						const shown = Array.from(list.children).filter((row) => row.style.display !== 'none').length
						if (shown === 0) {
							const empty = document.createElement('div')
							empty.className = 'wsc-m-empty wsc-m-empty-small'
							empty.textContent = items.length === 0 ? '这里还没有工作区' : '没有匹配的工作区'
							detail.appendChild(empty)
						}
						const foot = document.createElement('div')
						foot.className = 'wsc-m-foot'
						const hint = document.createElement('span')
						hint.textContent = '勾选即归入「' + selected.name + '」；取消勾选移回未分类'
						foot.appendChild(hint)
						const total = document.createElement('span')
						total.className = 'wsc-m-foot-count'
						total.textContent = (counts.get(selected.id) || 0) + ' / ' + items.length
						foot.appendChild(total)
						detail.appendChild(foot)
					}
					body.appendChild(detail)
				}

				const createCategory = (value) => {
					const name = value.trim()
					if (name === '') return
					const id = newCategoryId()
					updateViewState({ categories: getViewState().categories.concat([{ id, name, collapsed: false }]) })
					selectedId = id
					adding = false
					render()
				}

				const saveRename = (categoryId, value) => {
					const name = value.trim()
					if (name === '') return
					updateViewState({ categories: getViewState().categories.map((entry) => entry.id === categoryId ? Object.assign({}, entry, { name }) : entry) })
					renaming = false
					render()
				}

				document.body.appendChild(modal)
				render()
				unsubscribeStore = workspacesStore.subscribe(() => {
					if (!modal.isConnected) {
						if (unsubscribeStore !== undefined) unsubscribeStore()
						unsubscribeStore = undefined
						return
					}
					// 工作区列表可能在弹窗打开后才加载完成：保持弹窗内部同步刷新。
					if (adding || renaming) return
					render()
				})
				// 首次打开弹窗与 store 加载完成可能只差一个微任务：订阅后再同步一次，
				// 避免工作区列表一直为空。
				render()
			}

			// 侧栏隐藏/窗口不可见时暂停脉冲动画，避免后台空转。
			const updateAnimationPlayback = () => {
				const list = findList()
				if (list === undefined) return
				const shouldPause = document.hidden || list.getClientRects().length === 0
				const wasPaused = list.hasAttribute('data-wsc-anim-paused')
				if (shouldPause) {
					if (!wasPaused) list.setAttribute('data-wsc-anim-paused', '')
					return
				}
				if (!wasPaused) return
				list.removeAttribute('data-wsc-anim-paused')
				// 恢复时重新对齐所有可见点，避免后台停滞后相位错开。
				for (const dot of list.querySelectorAll('.wsc-pulse')) {
					if (dot.getClientRects().length > 0) alignPulsePhase(dot)
				}
			}
			const onPlaybackContext = () => updateAnimationPlayback()

			const apply = () => {
				if (!running || applying) return
				const list = findList()
				if (list === undefined) return
				applying = true
				if (observer !== undefined) {
					observer.disconnect()
					observerRoot = undefined
				}
				try {
					ensureStyles()
					const state = getViewState()
					const sessionSnapshot = sessionsStore.getSnapshot()
					const statuses = statusStore === undefined ? undefined : statusStore.getSnapshot()
					const inactiveOpen = state.inactiveOpen || {}
					const now = Date.now()
					list.setAttribute('data-wsc-native', '')
					list.setAttribute('data-wsc-sep', state.separator)
					// Clean up pin controls injected by older versions of this plugin.
					for (const legacy of list.querySelectorAll('.wsc-pin, [data-wsc-workspace-pin]')) legacy.remove()
					if (getComputedStyle(list).display.indexOf('flex') === -1) {
						list.style.display = 'flex'
						list.style.flexDirection = 'column'
					}
					const entries = nativeEntries(list)
					if (entries.length === 0) return
					const layoutBefore = layoutReady ? captureLayout(list) : undefined
					const groups = deriveGroups(entries.some((entry) => entry.workspaceId === UNGROUPED_ID))
					const perWorkspace = aggregate()
					const entryByWorkspace = new Map(entries.map((entry) => [entry.workspaceId, entry]))
					for (const entry of entries) {
						entry.element.removeAttribute('data-wsc-card')
						entry.element.removeAttribute('data-wsc-card-last')
					}
					const accounted = new Set()
					let order = 0
					const toolbarElement = toolbar(list)
					if (toolbarElement !== undefined) toolbarElement.style.order = '-30000'
					for (const group of groups) {
						const header = ensureGroupHeader(list, group)
						header.style.order = String(order)
						order += 1
						const groupAggregate = aggregateGroup(group.members, perWorkspace)
						header.setAttribute('data-collapsed', group.collapsed ? 'true' : 'false')
						header.setAttribute('data-wsc-card-collapsed', group.collapsed ? 'true' : 'false')
						const isCategory = group.kind === 'custom' && group.categoryId !== undefined
						header.setAttribute('data-category-id', isCategory ? group.categoryId : '')
						header.draggable = isCategory
						// 无固定工作区不再显示解释性悬浮气泡（分组名本身已经足够清楚）。
						header.removeAttribute('data-wsc-tip')
						header.querySelector('.wsc-glabel').textContent = group.label
						const groupCount = header.querySelector('.wsc-gcount')
						if (groupCount !== null) groupCount.textContent = '· ' + group.members.length
						const markers = header.querySelector('.wsc-gmarkers')
						syncPulse(markers, groupAggregate.counts, groupAggregate.runningCount)
						syncClock(markers, groupAggregate.scheduleCount)
						// 展开的普通分类不亮组头点，由组内工作区点表达；折叠时组头点闪。
						// 「未分类」和「无固定工作区」没有独立分类层，即使展开也保留组头闪烁点。
						const groupDot = markers.querySelector('.wsc-pulse')
						if (groupDot !== null) {
							const special = group.key === '__unassigned__' || group.key === UNGROUPED_ID
							const show = group.collapsed || special
							const wasShown = groupDot.getAttribute('data-wsc-shown') === 'true'
							groupDot.style.display = show ? '' : 'none'
							groupDot.setAttribute('data-wsc-shown', show ? 'true' : 'false')
							if (show && !wasShown) alignPulsePhase(groupDot)
						}
						const inactiveMembers = group.members.filter((workspace) => isInactiveWorkspace(workspace, sessionSnapshot, statuses, now))
						const inactiveIds = new Set(inactiveMembers.map((workspace) => workspace.workspaceId))
						const activeMembers = group.members.filter((workspace) => !inactiveIds.has(workspace.workspaceId))
						const inactiveShown = inactiveOpen[group.key] === true
						const inactiveToggle = header.querySelector('.wsc-inactive-toggle')
						if (inactiveToggle !== null) {
							const showToggle = inactiveMembers.length > 0 && !group.collapsed
							inactiveToggle.style.display = showToggle ? '' : 'none'
							inactiveToggle.setAttribute('data-open', inactiveShown ? 'true' : 'false')
							inactiveToggle.setAttribute('aria-expanded', inactiveShown ? 'true' : 'false')
							const inactiveLabel = inactiveToggle.querySelector('.wsc-inactive-label')
							if (inactiveLabel !== null) inactiveLabel.textContent = String(inactiveMembers.length) + ' 不活跃'
						}
						const activeEntries = []
						const inactiveEntries = []
						for (const workspace of activeMembers.concat(inactiveMembers)) {
							const entry = entryByWorkspace.get(workspace.workspaceId)
							if (entry === undefined) continue
							accounted.add(workspace.workspaceId)
							entry.element.style.order = String(order)
							order += 1
							decorateWorkspace(entry, perWorkspace.get(workspace.workspaceId))
							entry.element.setAttribute('data-wsc-card', 'body')
							if (inactiveIds.has(workspace.workspaceId)) inactiveEntries.push(entry.element)
							else activeEntries.push(entry.element)
						}
						for (const element of activeEntries) setSectionVisible(element, !group.collapsed)
						for (const element of inactiveEntries) setSectionVisible(element, !group.collapsed && inactiveShown)
						const visibleEntries = group.collapsed ? [] : activeEntries.concat(inactiveShown ? inactiveEntries : [])
						if (visibleEntries.length > 0) visibleEntries[visibleEntries.length - 1].setAttribute('data-wsc-card-last', 'true')
						header.setAttribute('data-wsc-card-collapsed', group.collapsed || visibleEntries.length === 0 ? 'true' : 'false')
					}
					const collapseSignature = groups.map((group) => group.key + ':' + (group.collapsed ? '1' : '0')).join('|')
					if (collapseSignature !== lastCollapseSignature) {
						lastCollapseSignature = collapseSignature
						for (const dot of list.querySelectorAll('.wsc-pulse')) {
							if (dot.getClientRects().length > 0) alignPulsePhase(dot)
						}
					}
					const activeGroupKeys = new Set(groups.map((group) => group.key))
					for (const header of Array.from(list.querySelectorAll('[' + GROUP_ATTR + ']'))) {
						if (!activeGroupKeys.has(header.getAttribute(GROUP_ATTR))) header.remove()
					}
					for (const entry of entries) {
						if (accounted.has(entry.workspaceId)) continue
						entry.element.style.order = String(90000 + order)
						setSectionVisible(entry.element, true)
						order += 1
					}
					for (const child of Array.from(list.children)) {
						if (child.getAttribute(TOOLBAR_ATTR) !== null) continue
						if (child.getAttribute(GROUP_ATTR) !== null) continue
						if (child.querySelector(LIST_SELECTOR) === null) child.style.order = '999999'
					}
					animateLayout(list, layoutBefore)
					layoutReady = true
				} finally {
					applying = false
					ensureNativeObserver()
					updateAnimationPlayback()
				}
			}

			const start = () => {
				if (running) return
				running = true
				ensureStyles()
				readTurnErrors()
				readScheduleCatalog().then((value) => {
					if (!running) return
					schedules = normalizeSchedules(value)
					notifyRelevantChange()
				})
				timers = [
					setInterval(readTurnErrors, 15000),
					setInterval(() => readScheduleCatalog().then((value) => {
						if (!running) return
						schedules = normalizeSchedules(value)
						queueApply()
					}), 30000)
				]
				const onStore = () => notifyRelevantChange()
				disposers.push(workspacesStore.subscribe(onStore), sessionsStore.subscribe(onStore))
				if (statusStore !== undefined) disposers.push(statusStore.subscribe(onStore))
				disposers.push(subscribeViewState(onStore))
				document.addEventListener('click', onClick, true)
				document.addEventListener('visibilitychange', onPlaybackContext)
				window.addEventListener('resize', onPlaybackContext)
				lastRelevantSignature = undefined
				ensureNativeObserver()
				queueApply()
			}

			const stop = () => {
				if (!running) return
				running = false
				if (frame !== undefined) {
					clearTimeout(frame)
					frame = undefined
				}
				for (const timer of timers) clearInterval(timer)
				timers = []
				for (const dispose of disposers.splice(0)) {
					try {
						dispose()
					} catch (error) {
						console.warn('[workspace-classifier] unsubscribe failed', error)
					}
				}
				document.removeEventListener('click', onClick, true)
				document.removeEventListener('visibilitychange', onPlaybackContext)
				window.removeEventListener('resize', onPlaybackContext)
				lastRelevantSignature = undefined
				if (observer !== undefined) {
					observer.disconnect()
					observer = undefined
					observerRoot = undefined
				}
				document.querySelectorAll('[' + TOOLBAR_ATTR + '],[' + GROUP_ATTR + '],[' + MARKER_ATTR + '],[data-wsc-workspace-pin]').forEach((node) => node.remove())
				const modal = document.querySelector('[data-wsc-modal]')
				if (modal !== null) modal.remove()
				for (const node of document.querySelectorAll('[data-wsc-exit]')) node.remove()
				for (const node of document.querySelectorAll('[data-wsc-session-indent]')) {
					node.style.paddingLeft = ''
					node.removeAttribute('data-wsc-session-indent')
				}
				for (const row of document.querySelectorAll(LIST_SELECTOR)) {
					const group = row.parentElement === null ? null : row.parentElement.parentElement
					if (group === null) continue
					group.style.order = ''
					group.style.display = ''
					group.style.transform = ''
				}
				const list = findList()
				if (list !== undefined) {
					list.style.display = ''
					list.style.flexDirection = ''
					list.removeAttribute('data-wsc-native')
					list.removeAttribute('data-wsc-sep')
					for (const row of list.querySelectorAll('[data-wsc-card], [data-wsc-card-last], [data-wsc-card-collapsed]')) {
						row.removeAttribute('data-wsc-card')
						row.removeAttribute('data-wsc-card-last')
						row.removeAttribute('data-wsc-card-collapsed')
					}
				}
				layoutReady = false
			}

			const ack = (sessionId) => {
				const sessionSnapshot = sessionsStore.getSnapshot()
				const summary = (sessionSnapshot.byId || {})[sessionId]
				if (summary === undefined) return
				const view = errorViewOf(sessionId, turnErrors)
				if (view === undefined) return
				updateViewState((current) => {
					const acked = current.ackedError[sessionId]
					if (acked !== undefined && acked >= view.turn) return {}
					const next = Object.assign({}, current.ackedError)
					next[sessionId] = view.turn
					return { ackedError: next }
				})
			}

			const onClick = (event) => {
				const target = event.target instanceof Element ? event.target : null
				if (target === null) return
				const row = target.closest('[data-row-key^="session:"]')
				if (row === null) return
				const key = row.getAttribute('data-row-key')
				if (key === null) return
				ack(key.slice('session:'.length))
			}

			return { start, stop, apply }
		}

		/* ------------------------------------------------------------------ *
		 * Native-style tooltip manager
		 * ------------------------------------------------------------------ */

		function createTooltipManager() {
			let tip
			let timer
			let active
			let disposed = false

			const hide = () => {
				if (timer !== undefined) {
					clearTimeout(timer)
					timer = undefined
				}
				active = undefined
				if (tip === undefined) return
				tip.style.visibility = 'hidden'
				tip.style.opacity = '0'
			}

			const show = (element) => {
				if (disposed) return
				const content = element.getAttribute('data-wsc-tip')
				if (content === null || content === '') return
				if (tip === undefined) {
					tip = document.createElement('span')
					tip.className = 'wsc-tip'
					tip.setAttribute('role', 'tooltip')
					document.body.appendChild(tip)
				}
				tip.textContent = content
				tip.style.left = '0px'
				tip.style.top = '0px'
				tip.style.visibility = 'visible'
				tip.style.opacity = '1'
				const rect = element.getBoundingClientRect()
				const width = tip.offsetWidth
				const height = tip.offsetHeight
				const minX = 8 + width / 2
				const maxX = window.innerWidth - 8 - width / 2
				const center = Math.min(maxX, Math.max(minX, rect.left + rect.width / 2))
				let top = rect.bottom + 8
				if (top + height > window.innerHeight - 8) top = rect.top - height - 8
				tip.style.left = Math.round(center) + 'px'
				tip.style.top = Math.round(top) + 'px'
			}

			const scheduleShow = (element) => {
				if (active === element) return
				if (timer !== undefined) clearTimeout(timer)
				active = element
				timer = setTimeout(() => {
					timer = undefined
					if (active === element) show(element)
				}, 180)
			}

			const tipTarget = (target) => target instanceof Element ? target.closest('[data-wsc-tip]') : null

			const onOver = (event) => {
				const element = tipTarget(event.target)
				if (element === null) return
				scheduleShow(element)
			}

			const onOut = (event) => {
				const element = tipTarget(event.target)
				if (element === null) return
				const related = event.relatedTarget instanceof Element ? event.relatedTarget : null
				if (related !== null && element.contains(related)) return
				if (active === element) hide()
			}

			const onFocusIn = (event) => {
				const element = tipTarget(event.target)
				if (element !== null) show(element)
			}

			const onFocusOut = () => hide()
			const onViewport = () => hide()

			document.addEventListener('mouseover', onOver, true)
			document.addEventListener('mouseout', onOut, true)
			document.addEventListener('focusin', onFocusIn, true)
			document.addEventListener('focusout', onFocusOut, true)
			window.addEventListener('scroll', onViewport, true)
			window.addEventListener('resize', onViewport)
			return () => {
				disposed = true
				document.removeEventListener('mouseover', onOver, true)
				document.removeEventListener('mouseout', onOut, true)
				document.removeEventListener('focusin', onFocusIn, true)
				document.removeEventListener('focusout', onFocusOut, true)
				window.removeEventListener('scroll', onViewport, true)
				window.removeEventListener('resize', onViewport)
				if (timer !== undefined) clearTimeout(timer)
				if (tip !== undefined) tip.remove()
			}
		}

		/* ------------------------------------------------------------------ *
		 * Native "Workspaces" header toggle
		 * ------------------------------------------------------------------ */

		function setupHeaderToggle(ctx) {
			let button
			let frame
			let disposed = false
			let styledActions

			const makeIcon = () => {
				const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
				svg.setAttribute('width', '16')
				svg.setAttribute('height', '16')
				svg.setAttribute('viewBox', '0 0 16 16')
				svg.setAttribute('fill', 'none')
				svg.setAttribute('aria-hidden', 'true')
				for (const [index, d] of [
					'M8 1.9 14 5.1 8 8.3 2 5.1 8 1.9Z',
					'M2 8.3 8 11.5 14 8.3',
					'M2 11.4 8 14.6 14 11.4'
				].entries()) {
					const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
					path.setAttribute('d', d)
					if (index === 0) path.setAttribute('class', 'wsc-toggle-top')
					path.setAttribute('stroke', 'currentColor')
					path.setAttribute('stroke-width', '1.1')
					path.setAttribute('stroke-linejoin', 'round')
					svg.appendChild(path)
				}
				return svg
			}

			const resetActions = () => {
				if (styledActions === undefined) return
				styledActions.style.width = ''
				styledActions.style.maxWidth = ''
				styledActions.style.overflow = ''
				styledActions = undefined
			}

			const findActions = () => {
				const label = Array.from(document.querySelectorAll('span')).find(
					(element) => element.childElementCount === 0 && element.textContent.trim() === '工作区'
				)
				if (label === undefined) return undefined
				const header = label.parentElement
				if (header === null) return undefined
				return Array.from(header.children).find((child) => child.querySelectorAll('button').length >= 2)
			}

			const sync = () => {
				if (disposed) return
				const actions = findActions()
				if (actions === undefined) {
					if (button !== undefined) button.style.display = 'none'
					return
				}
				if (styledActions !== undefined && styledActions !== actions) resetActions()
				if (button === undefined || !button.isConnected) {
					button = document.createElement('button')
					button.type = 'button'
					button.className = 'wsc-header-toggle'
					button.appendChild(makeIcon())
					button.addEventListener('click', (event) => {
						event.stopPropagation()
						updateViewState({ overlay: !getViewState().overlay })
					})
					actions.appendChild(button)
				}
				// 原生 headerActions 宽度固定为两枚按钮（60px）且 overflow:hidden。
				// 只按「原生 2 枚 + 本插件 1 枚」固定为 92px，不能随 hover 时
				// 临时插入的子节点变化，否则 hover 会让整排图标横向抽动。
				styledActions = actions
				const width = 92
				if (actions.style.width !== width + 'px') actions.style.width = width + 'px'
				if (actions.style.maxWidth !== width + 'px') actions.style.maxWidth = width + 'px'
				if (actions.style.overflow !== 'visible') actions.style.overflow = 'visible'
				if (button.style.display !== '') button.style.display = ''
				const on = getViewState().overlay
				const onValue = on ? 'true' : 'false'
				if (button.getAttribute('data-on') !== onValue) button.setAttribute('data-on', onValue)
				const label = on ? '工作区分类：开（点击关闭，恢复原生列表）' : '工作区分类：关（点击开启分类显示）'
				if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
				const tipText = on ? '工作区分类：开' : '工作区分类：关'
				if (button.getAttribute('data-wsc-tip') !== tipText) button.setAttribute('data-wsc-tip', tipText)
				const pressed = on ? 'true' : 'false'
				if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed)
			}

			const queue = () => {
				if (frame !== undefined) return
				frame = requestAnimationFrame(() => {
					frame = undefined
					sync()
				})
			}

			const unsubscribe = subscribeViewState(queue)
			// 不再监听整个 body：流式输出/聊天渲染会持续产生 DOM 变更，
			// 体量很小，1.5s 轮询一次即可；按钮丢失时下一次轮询会补回。
			const poll = setInterval(queue, 1500)
			ensureStyles()
			sync()
			return () => {
				disposed = true
				if (frame !== undefined) cancelAnimationFrame(frame)
				clearInterval(poll)
				unsubscribe()
				resetActions()
				if (button !== undefined) button.remove()
			}
		}

		/* ------------------------------------------------------------------ *
		 * Plugin
		 * ------------------------------------------------------------------ */

		const inject = ['uiSession', 'remote', 'sessions', 'workspaces']

		function apply(ctx) {
			ensureStyles()
			const overlay = createOverlay(ctx)
			ctx.effect(() => {
				const sync = () => {
					if (getViewState().overlay) overlay.start()
					else overlay.stop()
				}
				const unsubscribe = subscribeViewState(sync)
				sync()
				return () => {
					unsubscribe()
					overlay.stop()
				}
			}, 'workspace-classifier: native overlay')
			ctx.effect(() => {
				return setupHeaderToggle(ctx)
			}, 'workspace-classifier: header toggle')
			ctx.effect(() => {
				return createTooltipManager()
			}, 'workspace-classifier: native-style tooltip')
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	}
})

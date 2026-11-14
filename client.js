window.__ModuleLoader__.load({
  id: '@tendollars-ag/dsh-screenshot',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    let createPortal = null
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      createPortal = null
    }

    const NS = 'dsh-screenshot'
    const DICT = {
      zh: {
        button: '截图',
        choose: '选择截图目标',
        wholeScreen: '整个屏幕',
        wholeScreenHint: '全部显示器，复制到剪贴板',
        loading: '正在列出窗口…',
        noWindows: '没有可截取的窗口',
        tip: '截取屏幕或指定窗口，并复制到剪贴板',
        busy: '截图中…',
        done: '已截图，Ctrl+V 粘贴',
      },
      en: {
        button: 'Screenshot',
        choose: 'Capture target',
        wholeScreen: 'Whole screen',
        wholeScreenHint: 'Every monitor, copied to the clipboard',
        loading: 'Listing windows…',
        noWindows: 'No capturable windows',
        tip: 'Capture the screen or one window, and copy it to the clipboard',
        busy: 'Capturing…',
        done: 'Captured — paste with Ctrl+V',
      },
    }

    const STYLE = [
      // Pill that picks up the surrounding theme: cream wash, thin gold edge.
      '.dss-shot{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;',
      'border-radius:999px;background:rgba(255,252,245,.55);',
      'border:1px solid rgba(186,158,102,.65);',
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.6);',
      'color:#4a5568;font-size:13px;font-weight:500;font-family:inherit;',
      'cursor:pointer;transition:background .2s ease,border-color .2s ease,color .2s ease}',
      '.dss-shot:hover:not(:disabled){background:rgba(255,252,245,.85);',
      'border-color:#b89552;color:#1e293b}',
      '.dss-shot:focus-visible{outline:2px solid rgba(184,149,82,.7);outline-offset:2px}',
      '.dss-shot:disabled{cursor:progress;opacity:.7}',
      '.dss-shot svg{display:block;flex:none}',
      '.dss-status{margin-left:8px;font-size:12px;align-self:center;',
      'color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.dss-status[data-kind="error"]{color:var(--dsw-alias-state-error-primary,#d84a4a)}',
      '.dss-menu{position:fixed;z-index:2147483000;width:320px;max-height:340px;overflow:auto;padding:6px;',
      'border-radius:12px;',
      'background:var(--dsw-alias-bg-overlay,#f7f8fa);',
      'color:var(--dsw-alias-label-primary,#1c1f26);',
      'border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));',
      'box-shadow:0 16px 40px rgba(0,0,0,.35);font-size:12px;line-height:1.4}',
      '.dss-menu .dss-menu-head{padding:6px 8px;font-size:11px;',
      'color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.dss-menu .dss-item{display:block;width:100%;text-align:left;border:0;border-radius:8px;',
      'padding:7px 8px;background:transparent;font:inherit;cursor:pointer;',
      // Themes style bare buttons; this popup owns its contrast.
      'color:var(--dsw-alias-label-primary,#1c1f26) !important}',
      '.dss-menu .dss-item:hover,.dss-menu .dss-item:focus-visible{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.16))}',
      '.dss-menu .dss-item-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'color:inherit !important;font-size:12px}',
      '.dss-menu .dss-item-meta{display:block;font-size:11px;',
      'color:var(--dsw-alias-label-secondary,#6b7280)}',
      '.dss-menu .dss-empty{padding:8px;',
      'color:var(--dsw-alias-label-secondary,#6b7280)}',
    ].join('')

    function resolveTranslator(ctx) {
      const fallback = (key) => {
        let id = 'en'
        try {
          id = String(ctx.locale.getLocale().id || 'en')
        } catch {
          /* no locale service */
        }
        return (DICT[id.startsWith('zh') ? 'zh' : 'en'] || DICT.en)[key] || key
      }
      try {
        const locales = { zh: DICT.zh, 'zh-CN': DICT.zh, 'zh-Hans': DICT.zh, en: DICT.en, 'en-US': DICT.en }
        for (const [locale, dict] of Object.entries(locales)) ctx.locale.register(NS, locale, dict)
        return ctx.locale.bind(NS)
      } catch {
        return fallback
      }
    }

    function Camera() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 15,
          height: 15,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M2 5.5h2.1l1-1.5h5.8l1 1.5H14a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z' }),
        h('circle', { cx: 8, cy: 9, r: 2.4 }),
      )
    }

    function ScreenshotButton({ t }) {
      const [open, setOpen] = React.useState(false)
      const [windows, setWindows] = React.useState(null)
      const [status, setStatus] = React.useState({ kind: 'idle', text: '' })
      const [anchor, setAnchor] = React.useState(null)
      const buttonRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const running = React.useRef(false)

      const openMenu = React.useCallback(async () => {
        if (open) {
          setOpen(false)
          return
        }
        const rect = buttonRef.current ? buttonRef.current.getBoundingClientRect() : null
        if (rect) setAnchor({ left: rect.left, bottom: rect.bottom, top: rect.top })
        setOpen(true)
        try {
          const response = await fetch('/dsh-screenshot/windows', { headers: { 'x-dsh-screenshot': '1' } })
          const body = await response.json().catch(() => ({}))
          setWindows(body && body.ok && Array.isArray(body.windows) ? body.windows : [])
        } catch {
          setWindows((previous) => previous ?? [])
        }
      }, [open])

      // Warm the host's window cache while the composer idles, so the first
      // click opens a populated menu instead of a spinner.
      React.useEffect(() => {
        let alive = true
        const timer = setTimeout(() => {
          fetch('/dsh-screenshot/windows', { headers: { 'x-dsh-screenshot': '1' } })
            .then((response) => response.json())
            .then((body) => {
              if (!alive || !body || !body.ok || !Array.isArray(body.windows)) return
              setWindows((previous) => previous ?? body.windows)
            })
            .catch(() => {})
        }, 1200)
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const onPointer = (event) => {
          const menu = menuRef.current
          const button = buttonRef.current
          if (menu && menu.contains(event.target)) return
          if (button && button.contains(event.target)) return
          setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onPointer, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('mousedown', onPointer, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open])

      React.useEffect(() => {
        if (status.kind !== 'done' && status.kind !== 'error') return undefined
        const timer = setTimeout(() => setStatus({ kind: 'idle', text: '' }), 4000)
        return () => clearTimeout(timer)
      }, [status])

      const capture = React.useCallback(async (target) => {
        if (running.current) return
        running.current = true
        setOpen(false)
        setStatus({ kind: 'busy', text: t('busy') })
        try {
          const response = await fetch('/dsh-screenshot/capture', {
            method: 'POST',
            headers: { 'x-dsh-screenshot': '1', 'content-type': 'application/json' },
            body: JSON.stringify(target),
          })
          const body = await response.json().catch(() => ({}))
          if (response.ok && body && body.ok) {
            setStatus({ kind: 'done', text: t('done') })
          } else {
            setStatus({ kind: 'error', text: String((body && body.error) || `HTTP ${response.status}`) })
          }
        } catch (error) {
          setStatus({ kind: 'error', text: String((error && error.message) || error) })
        } finally {
          running.current = false
        }
      }, [t])

      const label = status.kind === 'busy' ? t('busy') : status.kind === 'done' ? t('done') : status.kind === 'error' ? status.text : t('button')

      let menu = null
      if (open) {
        const style = { left: 0 }
        if (anchor) {
          const maxLeft = Math.max(8, window.innerWidth - 328)
          style.left = Math.max(8, Math.min(anchor.left, maxLeft))
          // Anchor by the edge the panel grows away from, so the panel never
          // overlaps the button no matter how tall its content is.
          const spaceBelow = window.innerHeight - anchor.bottom
          if (spaceBelow >= 348 || spaceBelow >= anchor.top) {
            style.top = anchor.bottom + 8
          } else {
            style.bottom = window.innerHeight - anchor.top + 8
          }
        }
        const rows = []
        rows.push(h('div', { className: 'dss-menu-head', key: 'head' }, t('choose')))
        rows.push(h(
          'button',
          { className: 'dss-item', key: 'screen', role: 'menuitem', onClick: () => capture({ mode: 'screen' }) },
          h('span', { className: 'dss-item-title' }, t('wholeScreen')),
          h('span', { className: 'dss-item-meta' }, t('wholeScreenHint')),
        ))
        if (windows === null) {
          rows.push(h('div', { className: 'dss-empty', key: 'loading' }, t('loading')))
        } else if (windows.length === 0) {
          rows.push(h('div', { className: 'dss-empty', key: 'empty' }, t('noWindows')))
        } else {
          for (const item of windows) {
            rows.push(h(
              'button',
              {
                className: 'dss-item',
                key: String(item.hwnd),
                role: 'menuitem',
                title: item.title,
                onClick: () => capture({ mode: 'window', hwnd: item.hwnd }),
              },
              h('span', { className: 'dss-item-title' }, item.title),
              h('span', { className: 'dss-item-meta' }, `${item.process} · ${item.width}×${item.height}`),
            ))
          }
        }
        const panel = h('div', { className: 'dss-menu', style, role: 'menu', ref: menuRef }, rows)
        menu = createPortal ? createPortal(panel, document.body) : panel
      }

      return h(
        React.Fragment,
        null,
        h('style', null, STYLE),
        h(
          'button',
          {
            type: 'button',
            className: 'dss-shot',
            ref: buttonRef,
            'data-open': open ? 'true' : 'false',
            'data-state': status.kind,
            title: status.kind === 'error' ? status.text : t('tip'),
            'aria-label': t('button'),
            'aria-haspopup': 'menu',
            'aria-expanded': open ? 'true' : 'false',
            disabled: status.kind === 'busy',
            onClick: openMenu,
          },
          h(Camera),
          h('span', null, t('button')),
        ),
        status.kind === 'idle'
          ? null
          : h('span', { className: 'dss-status', 'data-kind': status.kind }, label),
        menu,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const t = resolveTranslator(ctx)
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'dsh-screenshot',
              order: 20,
            },
            () => h(ScreenshotButton, { t }),
          ),
        )
      },
    }
  },
})

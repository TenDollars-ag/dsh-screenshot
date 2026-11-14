/**
 * Host half of the screenshot bundle.
 *
 * Routes:
 *   GET  /dsh-screenshot/windows   visible top-level windows, front-most first
 *   POST /dsh-screenshot/capture   { mode: 'screen' | 'window', hwnd?: number }
 *
 * Every capture is written to ~/.dsh/screenshots and copied to the clipboard.
 * Each PowerShell helper declares per-monitor DPI awareness first: without it
 * the process sees a 1707x1067 virtual screen on a 150%-scaled 2560x1600 panel
 * and captures only the top-left corner.
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const inject = ['webServer']

const HEADER = 'x-dsh-screenshot'

/** P/Invoke surface plus the DPI fix every capture needs. */
const WIN32 = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Shot {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public static void FixDpi() {
        try { SetProcessDpiAwareness(2); } catch { try { SetProcessDPIAware(); } catch { } }
    }
}
"@
[Win32Shot]::FixDpi() | Out-Null
`

const LIST_SCRIPT = `
$ErrorActionPreference = 'Stop'
${WIN32}
$list = New-Object System.Collections.ArrayList
$callback = {
    param($hwnd, $lparam)
    if (-not [Win32Shot]::IsWindowVisible($hwnd)) { return $true }
    if ([Win32Shot]::IsIconic($hwnd)) { return $true }
    $buffer = New-Object System.Text.StringBuilder 512
    [void][Win32Shot]::GetWindowText($hwnd, $buffer, 512)
    $title = $buffer.ToString()
    if ([string]::IsNullOrWhiteSpace($title)) { return $true }
    $rect = New-Object Win32Shot+RECT
    [void][Win32Shot]::GetWindowRect($hwnd, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 120 -or $height -lt 90) { return $true }
    $owner = 0
    [void][Win32Shot]::GetWindowThreadProcessId($hwnd, [ref]$owner)
    $process = ''
    try { $process = (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { }
    [void]$list.Add([pscustomobject]@{
        hwnd = [int64]$hwnd
        title = $title
        process = $process
        width = $width
        height = $height
    })
    return $true
}
[void][Win32Shot]::EnumWindows($callback, [IntPtr]::Zero)
$json = $list | ConvertTo-Json -Depth 4 -Compress
if ([string]::IsNullOrWhiteSpace($json)) { $json = '[]' }
# Console encoding mangles non-ASCII titles, so ship the JSON as base64 UTF-8.
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
Write-Output ('b64:' + [Convert]::ToBase64String($bytes))
`

/** Whole virtual desktop; DPI-aware, so the full panel is captured. */
const SCREEN_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
${WIN32}
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)
$graphics.Dispose()
$bitmap.Save($env:DSH_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
$clipboard = 'ok'
try { [System.Windows.Forms.Clipboard]::SetImage($bitmap) } catch { $clipboard = 'failed' }
$bitmap.Dispose()
Write-Output ("True|{0}x{1}|ok|{2}" -f $bounds.Width, $bounds.Height, $clipboard)
`

/** One window by handle; PrintWindow also renders occluded windows. */
const WINDOW_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
${WIN32}
$handle = [IntPtr][int64]$env:DSH_SCREENSHOT_HWND
$rect = New-Object Win32Shot+RECT
[void][Win32Shot]::GetWindowRect($handle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 1 -or $height -lt 1) { throw 'window has no drawable area' }
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$ok = [Win32Shot]::PrintWindow($handle, $hdc, 2)
$graphics.ReleaseHdc($hdc)
$graphics.Dispose()
$bitmap.Save($env:DSH_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
$clipboard = 'ok'
try { [System.Windows.Forms.Clipboard]::SetImage($bitmap) } catch { $clipboard = 'failed' }
$bitmap.Dispose()
Write-Output ("{0}|{1}x{2}|ok|{3}" -f $ok, $width, $height, $clipboard)
`

/** Run one PowerShell helper with a hard timeout. */
function runPowerShell(script, env, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NoLogo', '-NonInteractive', '-STA', '-EncodedCommand', encoded],
      { windowsHide: true, env: { ...process.env, ...env } },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('screenshot timed out'))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `powershell exited with code ${code}`))
    })
  })
}

/** Filesystem-safe local timestamp. */
function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(payload)),
  })
  res.end(payload)
}

/** Read a small JSON body. */
function readJson(req, limit = 4096) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        req.destroy()
        resolve({})
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

export function apply(ctx, config) {
  const directory = (config && config.directory) || join(homedir(), '.dsh', 'screenshots')

  // The window list barely changes between clicks, and enumerating it costs a
  // PowerShell start-up. Serve the last snapshot immediately and refresh it in
  // the background once it ages out (stale-while-revalidate).
  let cachedAt = 0
  let cached = null
  let inflight = null
  const TTL = 8000

  function refresh() {
    if (inflight !== null) return inflight
    inflight = (async () => {
      try {
        const output = await runPowerShell(LIST_SCRIPT, {})
        const raw = output.startsWith('b64:')
          ? Buffer.from(output.slice(4), 'base64').toString('utf8')
          : output
        const parsed = JSON.parse(raw)
        cached = Array.isArray(parsed) ? parsed : [parsed]
        cachedAt = Date.now()
        return cached
      } catch {
        return cached ?? []
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  async function listWindows(force) {
    if (force) return refresh()
    if (cached !== null) {
      if (Date.now() - cachedAt > TTL) void refresh()
      return cached
    }
    return refresh()
  }

  /** Same-origin guard: only the composer button may drive captures. */
  function allowed(req, res) {
    if (req.headers[HEADER] !== '1') {
      sendJson(res, 403, { ok: false, error: 'missing client header' })
      return false
    }
    const origin = req.headers.origin
    if (origin !== undefined && origin !== 'null') {
      let host = ''
      try {
        host = new URL(origin).host
      } catch {
        sendJson(res, 403, { ok: false, error: 'bad origin' })
        return false
      }
      if (host !== req.headers.host) {
        sendJson(res, 403, { ok: false, error: 'cross-origin request refused' })
        return false
      }
    }
    return true
  }

  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-screenshot/windows',
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'use GET' })
          return
        }
        if (!allowed(req, res)) return
        try {
          const force = new URL(req.url || '/', 'http://localhost').searchParams.get('refresh') === '1'
          const windows = await listWindows(force)
          sendJson(res, 200, { ok: true, windows })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error && error.message) || error).slice(0, 400) })
        }
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-screenshot/capture',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'use POST' })
          return
        }
        if (!allowed(req, res)) return
        try {
          await mkdir(directory, { recursive: true })
          const body = await readJson(req)
          const windowMode = body.mode === 'window' && Number.isFinite(Number(body.hwnd))
          const suffix = windowMode ? `win-${Number(body.hwnd)}` : 'screen'
          const file = join(directory, `shot-${suffix}-${stamp()}.png`)
          const env = { DSH_SCREENSHOT_PATH: file }
          let output
          if (windowMode) {
            env.DSH_SCREENSHOT_HWND = String(Number(body.hwnd))
            output = await runPowerShell(WINDOW_SCRIPT, env)
          } else {
            output = await runPowerShell(SCREEN_SCRIPT, env)
          }
          const [printOk, size, , clipboard] = output.split('|')
          if (windowMode && printOk === 'False') {
            sendJson(res, 422, {
              ok: false,
              error: 'this window refuses window-level capture; capture the whole screen instead',
            })
            return
          }
          sendJson(res, 200, {
            ok: true,
            mode: windowMode ? 'window' : 'screen',
            path: file,
            size: size || '',
            clipboard: clipboard === 'ok',
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error && error.message) || error).slice(0, 400) })
        }
      },
    }),
  ]

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}

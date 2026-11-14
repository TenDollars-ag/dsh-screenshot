# Screenshot button / 截图按钮

Adds one camera button to the left of the message composer, next to the other compact controls. Clicking it opens a small target menu instead of shooting immediately.

The button is a theme-matched pill: a translucent cream wash, a thin gold edge, and an inner white hairline, with a camera icon and a localized label. A bitmap pill artwork shipped in `assets/` earlier is kept for reference but is not used.

在消息输入框左侧的工具栏里加一个相机按钮。点它不会立刻截屏，而是先弹出目标菜单。

按钮是贴合主题的胶囊样式：半透明米白底、细金边、内侧白色高光，带相机图标和随语言切换的文字。`assets/` 里早先裁的位图胶囊仅留作参考，当前不使用。

## Using it

1. Click the camera button.
2. Pick **Whole screen** (every monitor) or one open window from the list, which shows each window's title, process, and size.
3. The capture is saved as a PNG and copied to the system clipboard; the button reports success.
4. Press `Ctrl+V` in the message box to paste the image as an attachment, then send.

## 用法

1. 点一下相机按钮。
2. 选「整个屏幕」，或者从列表里挑一个窗口（列表显示标题、进程名、尺寸）。
3. 截图会存成 PNG 并放进系统剪贴板，按钮提示成功。
4. 在输入框里按 `Ctrl+V` 粘贴成附件，然后发送。

## Limits

- **DPI:** every capture declares per-monitor DPI awareness first. Without it a helper process sees a scaled virtual screen (for example 1707×1067 on a 150%-scaled 2560×1600 panel) and saves only the top-left corner.
- **Window capture uses `PrintWindow`**, so a window that is partly covered by another window still captures its own content. Some windows refuse it — hardware-protected video, a few UWP/store apps, or windows mid-animation. When `PrintWindow` reports failure the button says so and suggests the whole-screen option.
- The window list is cached for 8 seconds and warmed once after the page loads, so opening the menu again does not spawn a helper process.
- Minimized windows are not listed, because they have no drawable frame to capture.
- Small windows (under 120×90) and windows with an empty title are skipped to keep the list readable.
- Screenshots are written to `~/.dsh/screenshots/` and are not deleted automatically.
- Windows only: capture runs a PowerShell helper using `System.Drawing` and `user32.dll`.

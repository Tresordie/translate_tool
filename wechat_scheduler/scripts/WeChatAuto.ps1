#requires -version 5.1
<#
.SYNOPSIS
    驱动本机 PC 微信，按目标昵称/备注名打开会话并发送文字与文件。
.DESCRIPTION
    由 wxtimer(Python) 用一个 UTF-8 JSON 作业文件调用，命令行不传任何文本，
    从根本上避开中文 / 多行 / 引号的编码问题：

      powershell -NoProfile -ExecutionPolicy Bypass -STA -File WeChatAuto.ps1 -JobFile job.json -OutFile result.json

    两种定位模式，自动判定：
      uia       微信 3.9.x：UIAutomation 能拿到搜索框 / 输入框，可 SetFocus 并核对会话标题。
      keyboard  微信 4.x：界面由 MMUI 自绘，UIA 树不透明（实测整棵树只有 1 个 Pane），
                只能「鼠标点搜索框位置 + 键盘 + 剪贴板」。为防发错人，发送前做哨兵式回读：
                把剪贴板写成随机哨兵 -> Ctrl+A -> Ctrl+C -> 读回，只有读到的内容与预期一致
                才认为焦点确实在那个输入框里，否则中止，绝不盲按回车。

    命令：doctor | probe | tree | send
    退出码 / result.code
       0 成功                 10 找不到微信窗口        11 屏幕已锁定
      12 PowerShell 环境受限   13 搜索框未确认收到文本   14 会话标题校验失败(uia)
      15 用户按 Esc 取消       16 过程异常              17 窗口无法前置
      18 输入框回读校验失败，已中止（未发送）
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$JobFile,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'
$script:Result = [ordered]@{ ok = $true; code = 0; error = ''; detail = ''; data = $null }
$script:Readability = 'unknown'
$script:Hwnd = [IntPtr]::Zero
$script:Options = @{}
$script:Target = ''
$script:Message = ''
$script:Files = @()
$script:Command = ''
$script:Win32 = $false
$script:ForegroundNote = ''

function Write-Result {
    param(
        [int]$Code,
        [bool]$Ok = $true,
        [string]$ErrMsg = '',
        [string]$Detail = '',
        $Data = $null
    )
    $script:Result['ok'] = $Ok
    $script:Result['code'] = $Code
    $script:Result['error'] = $ErrMsg
    $script:Result['detail'] = $Detail
    $merged = [ordered]@{ readability = $script:Readability }
    if ($Data -is [System.Collections.IDictionary]) {
        foreach ($k in $Data.Keys) { $merged[$k] = $Data[$k] }
    }
    $script:Result['data'] = $merged
    $json = $script:Result | ConvertTo-Json -Depth 12 -Compress
    $dir = Split-Path -Parent $OutFile
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Host ("RESULT code={0} ok={1} {2}" -f $Code, $Ok, $Detail)
}

function Get-Opt {
    param([string]$Name, $Default)
    if ($script:Options.ContainsKey($Name) -and $null -ne $script:Options[$Name]) { return $script:Options[$Name] }
    return $Default
}

function OptInt { param([string]$Name, [int]$Default) return [int](Get-Opt $Name $Default) }
function OptBool { param([string]$Name, [bool]$Default) return [bool](Get-Opt $Name $Default) }
function OptStr { param([string]$Name, [string]$Default) return [string](Get-Opt $Name $Default) }
function OptDbl { param([string]$Name, [double]$Default) return [double](Get-Opt $Name $Default) }

# ---------------------------------------------------------------------------
# Win32 辅助
# ---------------------------------------------------------------------------
try {
    if (-not ('WxAuto32' -as [type])) {
        Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WxAuto32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool join);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint data, IntPtr extra);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern bool GetUserObjectInformation(IntPtr h, int index, StringBuilder info, uint length, IntPtr needed);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool altTab);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);

    // 矩形是否「真的在屏幕上看得到」。最小化/缩进托盘时 GetWindowRect 返回 -32000,-32000，
    // 拿它算点击点会被系统夹到另一台显示器的边缘，结果点到完全无关的程序上（实测踩过）。
    public static bool RectSane(IntPtr h) {
        int x, y, w, hh;
        if (!Rect(h, out x, out y, out w, out hh)) return false;
        if (x <= -30000 || y <= -30000) return false;
        return w >= 600 && hh >= 400;
    }

    public static bool Front(IntPtr h) {
        if (h == IntPtr.Zero) return false;
        if (IsIconic(h)) ShowWindow(h, 9);   // SW_RESTORE
        ShowWindow(h, 5);                     // SW_SHOW
        // Windows 的「前台锁」会拒绝后台进程抢焦点：先补一次 Alt 按下/抬起，
        // 再用 SwitchToThisWindow / BringWindowToTop 兜底。
        try {
            keybd_event(0x12, 0, 0, IntPtr.Zero);   // VK_MENU down
            keybd_event(0x12, 0, 2, IntPtr.Zero);   // VK_MENU up
        } catch { }
        uint mine = GetCurrentThreadId();
        uint other = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        try {
            if (other != mine && other != 0 && AttachThreadInput(mine, other, true)) {
                SetForegroundWindow(h);
                BringWindowToTop(h);
                AttachThreadInput(mine, other, false);
            }
        } catch { }
        try { SwitchToThisWindow(h, true); } catch { }
        SetForegroundWindow(h);
        return GetForegroundWindow() == h;
    }

    public static bool Rect(IntPtr h, out int x, out int y, out int w, out int hh) {
        RECT r; x = 0; y = 0; w = 0; hh = 0;
        if (!GetWindowRect(h, out r)) return false;
        x = r.Left; y = r.Top; w = r.Right - r.Left; hh = r.Bottom - r.Top;
        return w > 50 && hh > 50;
    }

    // 按「相对窗口左上角的绝对像素」点击。微信左侧栏是固定宽度的，
    // 搜索框位置不随窗口变宽而移动 —— 所以绝对偏移比比例更可靠（比例留作兜底）。
    public static bool ClickOff(IntPtr h, int ox, int oy) {
        int x, y, w, hh;
        if (!Rect(h, out x, out y, out w, out hh)) return false;
        if (x <= -30000 || y <= -30000 || w < 600 || hh < 400) return false;
        if (ox < 0 || oy < 0 || ox >= w || oy >= hh) return false;
        POINT saved; GetCursorPos(out saved);
        SetCursorPos(x + ox, y + oy);
        System.Threading.Thread.Sleep(140);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(40);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
        System.Threading.Thread.Sleep(80);
        SetCursorPos(saved.X, saved.Y);
        return true;
    }

    // 按窗口内相对比例点击（微信 4.x 自绘界面唯一的定位手段），点完把光标放回原位
    public static bool ClickFrac(IntPtr h, double fx, double fy) {
        int x, y, w, hh;
        if (!Rect(h, out x, out y, out w, out hh)) return false;
        // 窗口最小化/缩托盘时坐标是 -32000，点下去会被夹到别的屏幕边缘 —— 必须拒绝
        if (x <= -30000 || y <= -30000 || w < 600 || hh < 400) return false;
        POINT saved; GetCursorPos(out saved);
        SetCursorPos(x + (int)(w * fx), y + (int)(hh * fy));
        System.Threading.Thread.Sleep(140);
        mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);   // LEFTDOWN
        System.Threading.Thread.Sleep(40);
        mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);   // LEFTUP
        System.Threading.Thread.Sleep(80);
        SetCursorPos(saved.X, saved.Y);
        return true;
    }

    public static bool EscDown() { return (GetAsyncKeyState(0x1B) & 0x8000) != 0; }

    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);

    // 输入桌面不是 Default == 锁屏 / 登录界面。
    // 打不开输入桌面按「未锁」处理：真锁屏的话后面的回读校验必然失败并中止，
    // 宁可少发一条，也不要把正常状态误判成锁屏而全部跳过。
    public static bool InputLocked() {
        IntPtr d = OpenInputDesktop(0, false, 0x0100);   // DESKTOP_READOBJECTS
        if (d == IntPtr.Zero) return false;
        try {
            StringBuilder sb = new StringBuilder(260);
            if (!GetUserObjectInformation(d, 2, sb, 520, IntPtr.Zero)) return false;   // UOI_NAME
            return !string.Equals(sb.ToString(), "Default", StringComparison.OrdinalIgnoreCase);
        } finally { CloseDesktop(d); }
    }
}
'@
    }
    $script:Win32 = $true
}
catch {
    $hint = '无法编译 Win32 辅助代码。若 PowerShell 处于受限语言模式，请在普通窗口执行 ' +
            '$ExecutionContext.SessionState.LanguageMode 确认为 FullLanguage。'
    Write-Result -Code 12 -Ok $false -ErrMsg $_.Exception.Message -Detail $hint
    exit 12
}

try {
    Add-Type -AssemblyName UIAutomationClient | Out-Null
    Add-Type -AssemblyName UIAutomationTypes | Out-Null
    Add-Type -AssemblyName WindowsBase | Out-Null
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
}
catch {
    Write-Result -Code 12 -Ok $false -ErrMsg $_.Exception.Message -Detail '缺少 UIAutomation / WindowsForms 程序集'
    exit 12
}

# ---------------------------------------------------------------------------
# 环境检测 / 键盘 / 剪贴板
# ---------------------------------------------------------------------------
function Test-Locked {
    if (Get-Process -Name LogonUI -ErrorAction SilentlyContinue) { return $true }
    try { return [WxAuto32]::InputLocked() } catch { return $false }
}

function Send-Key {
    param([string]$Keys, [int]$DelayMs = 80)
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Start-Sleep -Milliseconds $DelayMs
}

function Wait-Foreground {
    param([int]$TimeoutMs = 3000)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
        try {
            if ($script:Hwnd -ne [IntPtr]::Zero -and [WxAuto32]::GetForegroundWindow() -eq $script:Hwnd) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 100
    }
    return $false
}

function Set-ClipText {
    param([string]$Text, [int]$Retry = 10)
    for ($i = 0; $i -lt $Retry; $i++) {
        try {
            Set-Clipboard -Value $(if ($null -ne $Text -and $Text -ne '') { $Text } else { ' ' })
            return
        } catch { Start-Sleep -Milliseconds 120 }
    }
    throw '无法写入剪贴板：请关闭剪贴板历史 / 同步类软件后重试'
}

function Set-ClipFiles {
    param([string[]]$Paths, [int]$Retry = 10)
    for ($i = 0; $i -lt $Retry; $i++) {
        try { Set-Clipboard -Path $Paths; return } catch { Start-Sleep -Milliseconds 120 }
    }
    throw '无法把文件写入剪贴板：请关闭正在占用剪贴板的软件后重试'
}

function Get-ClipText {
    for ($i = 0; $i -lt 6; $i++) {
        try {
            $t = Get-Clipboard -Raw
            if ($null -ne $t) { return [string]$t }
        } catch { }
        Start-Sleep -Milliseconds 120
    }
    return ''
}

function Clear-Clip {
    try { Clear-Clipboard } catch { }
}

function Same-Text {
    param([string]$A, [string]$B)
    $na = (($A -replace "`r`n", "`n") -replace '\u200B|\uFEFF', '').TrimEnd()
    $nb = (($B -replace "`r`n", "`n") -replace '\u200B|\uFEFF', '').TrimEnd()
    return ($na -eq $nb)
}

<#
  哨兵式回读：先把剪贴板写成随机哨兵，再全选 + 复制。
    读到内容 -> 焦点在某个文本框里，内容可比对
    读回空   -> 要么焦点不在文本框（粘贴没生效），要么该框不支持 Ctrl+C
  不用哨兵的话，粘贴用的原文还留在剪贴板上，会被误判成「校验通过」。
#>
function Read-FocusedText {
    $sentinel = 'WXTIMER-SENTINEL-' + ([Guid]::NewGuid().ToString('N')).Substring(0, 10)
    Set-ClipText -Text $sentinel
    Send-Key '^a' 160
    Send-Key '^c' 320
    $back = Get-ClipText
    if (Same-Text $back $sentinel) { return '' }
    return $back
}

function Clear-FocusedText {
    param([string]$Method = 'keyboard')
    if ($Method -eq 'clip') {
        # 个别版本的搜索框 Ctrl+A 无效：改用 Home + Shift+End + Delete
        Send-Key '{HOME}' 90
        Send-Key '+{END}' 90
        Send-Key '{DEL}' 200
    } else {
        Send-Key '^a' 150
        Send-Key '{DEL}' 250
    }
}

# 重要：微信 PC 端按 Esc 会「关闭主窗口、缩进托盘」，而不是退出搜索态！
# 所以本脚本任何地方都不发 Esc；要清场就用 Clear-FocusedText 把文本删掉。
function Ensure-WeChatWindow {
    <#
      找不到主窗口时（多半是缩进了托盘），自动把微信再拉起来：
      进程还活着的话，重新启动 exe 只是让已有窗口显示出来，不会二次登录。
    #>
    $found = Find-WeChatWindow
    if ($found) { return $found }
    if (-not (OptBool 'auto_launch' $true)) { return $null }
    # 已经有微信进程在跑就绝对不要再 Start-Process：实测会冒出「第二个实例 + 登录窗」，
    # 反而把工具引到错误的窗口上。这种情况交给 Restore-WeChatWindow 从托盘还原。
    if (Get-Process -Name Weixin, WeChat -ErrorAction SilentlyContinue) { return $null }
    $exe = $null
    foreach ($c in @("$env:ProgramFiles\Tencent\Weixin\Weixin.exe",
                     "$env:ProgramFiles\Tencent\WeChat\WeChat.exe",
                     "${env:ProgramFiles(x86)}\Tencent\WeChat\WeChat.exe")) {
        if (Test-Path -LiteralPath $c) { $exe = $c; break }
    }
    if (-not $exe) { return $null }
    try { Start-Process -FilePath $exe } catch { return $null }
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        $f = Find-WeChatWindow
        if ($f) { return $f }
    }
    return $null
}

# ---------------------------------------------------------------------------
# 窗口与控件（3.9 才有控件树；4.x 只有一个自绘 Pane）
# ---------------------------------------------------------------------------
$AE = [System.Windows.Automation.AutomationElement]
$TP = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

function Test-MainWindowSize {
    param($El)
    # 主窗口至少 600x400；登录窗（mmui::LoginWindow，实测 280x380）之类的必须排除，
    # 否则按相对比例点击会点到完全无关的位置
    try {
        $b = $El.Current.BoundingRectangle
        return ($b.Width -ge 600 -and $b.Height -ge 400)
    } catch { return $false }
}

function Find-LoginWindow {
    <#
      只有在「找不到主窗口」时才参考它：机器上可能留着一个隐藏的登录窗，
      甚至同时跑着第二个微信实例 —— 不能因为存在登录窗就拒绝正常工作。
      所以要求它真的可见、且尺寸像登录窗，才判定「停在登录界面」。
    #>
    foreach ($cls in @('mmui::LoginWindow', 'WeChatLoginWndForPC', 'LoginWindow')) {
        try {
            $cond = [System.Windows.Automation.PropertyCondition]::new($AE::ClassNameProperty, $cls)
            foreach ($w in @($AE::RootElement.FindAll($TP::Children, $cond))) {
                $h = Get-ElHwnd -El $w
                if ($h -eq [IntPtr]::Zero) { continue }
                try { if (-not [WxAuto32]::IsWindowVisible($h)) { continue } } catch { }
                $lx = 0; $ly = 0; $lw = 0; $lh = 0
                if ([WxAuto32]::Rect($h, [ref]$lx, [ref]$ly, [ref]$lw, [ref]$lh) -and $lw -ge 150 -and $lh -ge 150) {
                    return $cls
                }
            }
        } catch { }
    }
    return ''
}

function Get-ElHwnd {
    param($El)
    try {
        $native = $El.Current.NativeWindowHandle
        if ($native -gt 0) { return [IntPtr]$native }
    } catch { }
    return [IntPtr]::Zero
}

function Get-ElArea {
    param($El)
    try {
        $b = $El.Current.BoundingRectangle
        return [double]($b.Width * $b.Height)
    } catch { return 0.0 }
}

function Get-WindowCandidate {
    <#
      判断一个顶层窗口能否作为「微信主窗口」候选，返回 @{ iconic; area } 或 $null。
      最小化 / 缩进托盘的窗口必须保留 —— 它正是 Restore-WeChatWindow 能救回来的那个；
      但它的 UIA 矩形只有 160x28，所以不能用尺寸把它筛掉。
    #>
    param($El)
    $h = Get-ElHwnd -El $El
    if ($h -eq [IntPtr]::Zero) { return $null }
    try { if (-not [WxAuto32]::IsWindowVisible($h)) { return $null } } catch { }
    $iconic = $false
    try { $iconic = [WxAuto32]::IsIconic($h) } catch { }
    if (-not $iconic -and -not (Test-MainWindowSize -El $El)) { return $null }
    $area = Get-ElArea -El $El
    if ($iconic) { $area = 1.0 }          # 有正常窗口时，正常窗口优先
    return @{ iconic = $iconic; area = $area }
}

function Find-WeChatWindow {
    <#
      微信 4.x 是 Qt 程序，进程里同时存在多个同类名窗口（主窗、隐藏窗、托盘消息窗…）。
      实测教训：拿错窗口 -> GetWindowRect 给出 -32000,-32000 -> 点击点被系统夹到另一台显示器
      边缘 -> 按键打进完全无关的应用。所以这里枚举全部同类窗口，要求「可见」，取面积最大的。
    #>
    $classes = ((OptStr 'class_name' 'Qt51514QWindowIcon,WeChatMainWndForPC') -split ',' | Where-Object { $_.Trim() })
    $best = $null
    $bestArea = 0.0
    $bestClass = ''
    $bestBy = ''

    foreach ($cls in $classes) {
        try {
            $cond = [System.Windows.Automation.PropertyCondition]::new($AE::ClassNameProperty, $cls.Trim())
            foreach ($w in @($AE::RootElement.FindAll($TP::Children, $cond))) {
                $c = Get-WindowCandidate -El $w
                if (-not $c) { continue }
                if ($c.area -gt $bestArea) { $bestArea = $c.area; $best = $w; $bestClass = $cls.Trim(); $bestBy = 'class' }
            }
        } catch { }
    }

    if (-not $best) {
        foreach ($n in @('微信', 'Weixin', 'WeChat')) {
            try {
                $cond = [System.Windows.Automation.PropertyCondition]::new($AE::NameProperty, $n)
                foreach ($w in @($AE::RootElement.FindAll($TP::Children, $cond))) {
                    $cn = ''
                    try { $cn = $w.Current.ClassName } catch { }
                    if ($cn -match 'Login') { continue }
                    $c = Get-WindowCandidate -El $w
                    if (-not $c) { continue }
                    if ($c.area -gt $bestArea) { $bestArea = $c.area; $best = $w; $bestClass = $cn; $bestBy = 'name' }
                }
            } catch { }
        }
    }

    if ($best) { return @{ el = $best; class = $bestClass; by = $bestBy } }

    # Win32 兜底：微信 4.x 关窗缩进托盘是 SW_HIDE，隐藏窗可能根本不出现在 UIA 树里；
    # FindWindow 按类名能找到隐藏窗口，FromHandle 包成 UIA 元素后交给 Restore-WeChatWindow 还原。
    foreach ($cls in $classes) {
        try {
            $h = [WxAuto32]::FindWindow($cls.Trim(), '微信')
            if ($h -eq [IntPtr]::Zero) {
                # 同类名但标题被改过（带版本号等）的隐藏窗：用 Win32 GetWindowText 校验，不依赖 UIA Name
                $h2 = [WxAuto32]::FindWindow($cls.Trim(), $null)
                if ($h2 -ne [IntPtr]::Zero) {
                    $sb = New-Object System.Text.StringBuilder 256
                    [void][WxAuto32]::GetWindowTextW($h2, $sb, 256)
                    if ($sb.ToString() -match '微信|WeChat|Weixin') { $h = $h2 }
                }
            }
            if ($h -ne [IntPtr]::Zero) {
                $el = $AE::FromHandle($h)
                if ($el) { return @{ el = $el; class = $cls.Trim(); by = 'findwindow' } }
            }
        } catch { }
    }
    return $null
}

function Restore-WeChatWindow {
    <#
      把微信窗口从「最小化 / 缩进托盘」状态拉回正常显示，并轮询确认矩形真的可用。
      微信 4.x 关窗口是缩到托盘，此时 GetWindowRect 会给出 -32000,-32000 ——
      不确认清楚就去点，点击会被系统夹到别的显示器边缘，落到完全无关的程序上。
    #>
    param($Found)
    $h = Get-Hwnd -Found $Found
    if ($h -eq [IntPtr]::Zero) { return $false }
    $script:Hwnd = $h
    foreach ($cmd in @(9, 1, 5)) {        # SW_RESTORE / SW_SHOWNORMAL / SW_SHOW
        for ($i = 0; $i -lt 6; $i++) {
            try { if ([WxAuto32]::RectSane($h)) { return $true } } catch { }
            Start-Sleep -Milliseconds 250
        }
        try { [void][WxAuto32]::ShowWindow($h, $cmd) } catch { }
        Start-Sleep -Milliseconds 250
    }
    return ([WxAuto32]::RectSane($h))
}

function Assert-WeChatForeground {
    <#
      敲键盘/点鼠标之前的两道闸：
        1) 窗口必须是「已还原、矩形正常」的可见状态（不是最小化/托盘里的 -32000）
        2) 前台窗口句柄必须真的是微信
      任一条不满足就中止：宁可这一轮不发，也绝不把按键打进别的程序。
    #>
    param($Found)
    if ($script:Hwnd -eq [IntPtr]::Zero) { $script:Hwnd = Get-Hwnd -Found $Found }
    if ($script:Hwnd -eq [IntPtr]::Zero) { return $true }   # 拿不到句柄就不拦，交给回读校验兜底
    try {
        if (-not (Restore-WeChatWindow -Found $Found)) {
            $script:ForegroundNote = '微信窗口处于最小化/托盘状态且无法还原'
            return $false
        }
        if ([WxAuto32]::GetForegroundWindow() -eq $script:Hwnd) { return $true }
        [void][WxAuto32]::Front($script:Hwnd)
        Start-Sleep -Milliseconds 350
        if ([WxAuto32]::GetForegroundWindow() -eq $script:Hwnd) { return $true }
        $script:ForegroundNote = '前台窗口不是微信（被其它窗口/置顶窗口抢了焦点）'
        return $false
    } catch { return $true }
}


# 统一取窗口：能用主窗口就继续；拿不到时才判断是「停在登录界面」还是「压根没窗口」
function Get-WindowOrExit {
    $found = Ensure-WeChatWindow
    if ($found) { return $found }
    $login = Find-LoginWindow
    if ($login) {
        Write-Result -Code 19 -Ok $false -ErrMsg ('微信停在登录界面（' + $login + '）：请先在电脑上扫码/确认登录，再重跑') -Detail ''
        exit 19
    }
    Write-Result -Code 10 -Ok $false -ErrMsg '未找到微信主窗口：请启动 PC 微信并登录（托盘里的窗口会被自动唤回）' -Detail ''
    exit 10
}

function Get-Hwnd {
    param($Found)
    try {
        $native = $Found.el.Current.NativeWindowHandle
        if ($native -gt 0) { return [IntPtr]$native }
    } catch { }
    return [IntPtr]::Zero
}

function Invoke-Front {
    param($Found)
    # 先确保窗口已从托盘/最小化里还原出来，再抢前台
    $sane = Restore-WeChatWindow -Found $Found
    if (-not $sane) { return $false }
    try { [void][WxAuto32]::Front($script:Hwnd) } catch { }
    if (Wait-Foreground) { return $true }
    try { $Found.el.SetFocus() } catch { }
    Start-Sleep -Milliseconds 300
    return (Wait-Foreground 1200)
}

function Get-Boxes {
    param($Found)
    $out = @{ usable = $false; search = $null; input = $null; edit_count = 0 }
    try {
        $cond = [System.Windows.Automation.PropertyCondition]::new($AE::ControlTypeProperty, $CT::Edit)
        $edits = @($Found.el.FindAll($TP::Descendants, $cond))
        $out.edit_count = $edits.Count
        if ($edits.Count -lt 2) { return $out }
        $r = $Found.el.Current.BoundingRectangle
        $pool = @()
        foreach ($e in $edits) {
            try { $b = $e.Current.BoundingRectangle } catch { continue }
            if ($b.Width -lt 40 -or $b.Height -lt 8) { continue }
            $pool += [pscustomobject]@{
                el   = $e
                rx   = ((($b.X + $b.Width / 2) - $r.X) / [math]::Max(1, $r.Width))
                ry   = ((($b.Y + $b.Height / 2) - $r.Y) / [math]::Max(1, $r.Height))
                area = $b.Width * $b.Height
            }
        }
        $s = $pool | Where-Object { $_.ry -lt 0.14 -and $_.rx -lt 0.32 } | Sort-Object { $_.ry } | Select-Object -First 1
        $t = $pool | Where-Object { $_.ry -gt 0.55 -and $_.rx -gt 0.32 } | Sort-Object -Descending { $_.area } | Select-Object -First 1
        if ($s -and $t) { $out.usable = $true; $out.search = $s.el; $out.input = $t.el }
    } catch { }
    return $out
}

function Save-DebugShot {
    <#
      options.debug_shots = true 时，把每一步的微信画面存到 data/debug/，
      用来回答「它到底看到了什么」—— 排错和校准坐标都靠这个。
    #>
    param([string]$Tag)
    if (-not (OptBool 'debug_shots' $false)) { return }
    try {
        $dir = Join-Path (Split-Path -Parent $PSScriptRoot) 'data\debug'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $x = 0; $y = 0; $w = 0; $h = 0
        if (-not [WxAuto32]::Rect($script:Hwnd, [ref]$x, [ref]$y, [ref]$w, [ref]$h)) { return }
        Add-Type -AssemblyName System.Drawing | Out-Null
        $bmp = [System.Drawing.Bitmap]::new([int]$w, [int]$h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen([int]$x, [int]$y, 0, 0, [System.Drawing.Size]::new([int]$w, [int]$h))
        $g.Dispose()
        $bmp.Save((Join-Path $dir ($Tag + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
    } catch { }
}

function Test-ChatTitle {
    param($Found, [string]$Target)
    try {
        $r = $Found.el.Current.BoundingRectangle
        $cond = [System.Windows.Automation.PropertyCondition]::new($AE::ControlTypeProperty, $CT::Text)
        foreach ($n in @($Found.el.FindAll($TP::Descendants, $cond))) {
            $name = $null
            try { $name = $n.Current.Name } catch { continue }
            if ([string]::IsNullOrWhiteSpace($name)) { continue }
            $b = $n.Current.BoundingRectangle
            $rx = (($b.X + $b.Width / 2) - $r.X) / [math]::Max(1, $r.Width)
            $ry = (($b.Y + $b.Height / 2) - $r.Y) / [math]::Max(1, $r.Height)
            if ($rx -lt 0.30 -or $ry -gt 0.14) { continue }
            $clean = ($name -replace '\s+', ' ').Trim()
            if ($clean -eq $Target -or $clean.StartsWith("$Target ") -or $clean.Contains($Target)) { return $true }
        }
    } catch { }
    return $false
}

function Wait-ConfirmEsc {
    param([int]$Seconds = 8, [string]$Line = '')
    Write-Host $Line
    for ($i = $Seconds; $i -gt 0; $i--) {
        Write-Host "  剩余 ${i}s（按 Esc 取消）" -NoNewline
        for ($k = 0; $k -lt 5; $k++) {
            Start-Sleep -Milliseconds 200
            try { if ([WxAuto32]::EscDown()) { Write-Host ''; return $false } } catch { }
        }
        Write-Host "`r" -NoNewline
    }
    Write-Host ''
    return $true
}

# ---------------------------------------------------------------------------
# 会话操作
# ---------------------------------------------------------------------------
function Try-Click {
    <#
      先按「相对窗口左上角的绝对像素」点（左侧栏固定宽度，绝对值最稳），
      再退回按比例点（窗口被拉得很窄/很宽时的兜底），两者都失败返回 ''。
    #>
    param($h, [int]$Ax, [int]$Ay, [double]$Fx, [double]$Fy)
    try { if ([WxAuto32]::ClickOff($h, $Ax, $Ay)) { return ('abs(' + $Ax + ',' + $Ay + ')') } } catch { }
    try { if ([WxAuto32]::ClickFrac($h, $Fx, $Fy)) { return ('frac(' + $Fx + ',' + $Fy + ')') } } catch { }
    return ''
}

function Focus-Search {
    param($Found, $Boxes)
    if ($Boxes.usable -and ((OptStr 'focus_method' 'click') -eq 'uia')) {
        try { $Boxes.search.SetFocus(); return 'uia' } catch { }
    }
    $h = $script:Hwnd
    if ($h -eq [IntPtr]::Zero) { $h = Get-Hwnd -Found $Found }
    if ($h -ne [IntPtr]::Zero) {
        $r = Try-Click $h (OptInt 'search_click_ax' 234) (OptInt 'search_click_ay' 60) `
                          (OptDbl 'search_click_fx' 0.16) (OptDbl 'search_click_fy' 0.06)
        if ($r) { return $r }
        return 'click失败(窗口矩形异常)'
    }
    Send-Key (OptStr 'search_hotkey' '^f')
    return 'hotkey'
}

function Focus-Input {
    param($Found, $Boxes)
    if ($Boxes.usable) { try { $Boxes.input.SetFocus(); return 'uia' } catch { } }
    $h = $script:Hwnd
    if ($h -eq [IntPtr]::Zero) { $h = Get-Hwnd -Found $Found }
    if ($h -eq [IntPtr]::Zero) { return 'none' }
    $x = 0; $y = 0; $w = 0; $hh = 0
    if (-not [WxAuto32]::Rect($h, [ref]$x, [ref]$y, [ref]$w, [ref]$hh)) { return 'rect失败' }
    # 输入框贴着窗口底部：用「距底边多少像素」比用比例可靠得多
    $ax = OptInt 'input_click_ax' 700
    $ay = [int]($hh - (OptInt 'input_from_bottom' 120))
    $r = Try-Click $h $ax $ay (OptDbl 'input_click_fx' 0.60) (OptDbl 'input_click_fy' 0.86)
    if ($r) { return ($r + ' ax=' + $ax + ' ay=' + $ay) }
    return 'click失败(窗口矩形异常)'
}

# 在搜索框写入目标名并（可选）回车打开会话。回读校验不通过时绝不回车。
function Open-Chat {
    param($Found, $Boxes, [string]$Target, [switch]$NoEnter)

    if (-not (Assert-WeChatForeground -Found $Found)) {
        return @{ ok = $false; code = 17
            msg = ('前台校验未通过：' + $script:ForegroundNote + '；已中止，不会把按键打进别的程序') }
    }
    $how = Focus-Search -Found $Found -Boxes $Boxes
    Start-Sleep -Milliseconds 350
    Clear-FocusedText -Method (OptStr 'clear_method' 'keyboard')
    Set-ClipText -Text $Target
    Send-Key '^v' 200
    Start-Sleep -Milliseconds (OptInt 'search_wait_ms' 1500)
    Save-DebugShot '1-search-typed'

    if (OptBool 'verify_input' $true) {
        $back = Read-FocusedText
        if (-not (Same-Text $back $Target)) {
            $empty = [string]::IsNullOrWhiteSpace($back)
            Clear-FocusedText -Method (OptStr 'clear_method' 'keyboard')
            if ($empty) {
                $script:Readability = 'unreadable'
                return @{ ok = $false; code = 13
                    msg = ('聚焦处读不到内容（focus=' + $how + '）：点击可能没落在搜索框上。' +
                           '先用 run.cmd probe 校准 search_click_fx/fy；' +
                           '若该框确实不支持复制粘贴，可在 defaults 设 "verify_input": false 并接受人工确认') }
            }
            $script:Readability = 'ok'
            $snip = [string]$back
            if ($snip.Length -gt 24) { $snip = $snip.Substring(0, 24) + '…' }
            return @{ ok = $false; code = 13
                msg = ('搜索框内容不是【' + $Target + '】（读到：' + $snip + '，focus=' + $how + '）—— 点击位置需校准') }
        }
        $script:Readability = 'ok'
    }

    if ($NoEnter) {
        return @{ ok = $true; code = 0; msg = ('搜索框已确认收到文本（focus=' + $how + '，未回车）') }
    }
    # 微信 4.x 搜索下拉的第一行常常是「搜索网络结果 / 搜索建议」，回车会跳去搜一搜而不是打开会话。
    # 实测规律：目标名越独特（加了前缀的备注名就是），下拉里没有建议项，回车直接打开会话；
    # 而「文件传输助手」这类热词带 5 条建议，回车会进搜一搜 —— 这种情况改用 open_method=click
    # 直接点结果行（坐标用 run.cmd shot 或 --debug 截图量出来）。
    if ((OptStr 'open_method' 'enter') -eq 'click') {
        $rx = OptInt 'result_click_ax' 215
        $ry = OptInt 'result_click_ay' 337
        if (-not [WxAuto32]::ClickOff($script:Hwnd, $rx, $ry)) {
            return @{ ok = $false; code = 17; msg = ('点击结果行失败（' + $rx + ',' + $ry + '）：窗口矩形异常') }
        }
        Start-Sleep -Milliseconds (OptInt 'open_wait_ms' 1200)
        Save-DebugShot '2-result-clicked'
        return @{ ok = $true; code = 0; msg = ('已点击结果行 (' + $rx + ',' + $ry + ')') }
    }

    $times = OptInt 'open_enter_times' 1
    for ($i = 1; $i -le $times; $i++) {
        Send-Key '{ENTER}' 250
        Start-Sleep -Milliseconds (OptInt 'open_wait_ms' 1200)
        Save-DebugShot ('2-enter' + $i)
    }
    return @{ ok = $true; code = 0; msg = ('回车 ' + $times + ' 次打开会话（focus=' + $how + '）') }
}

# 把文字放进输入框，回读确认无误后才按回车
function Send-TextVerified {
    param($Found, $Boxes, [string]$Text, [switch]$NoEnter)

    if (-not (Assert-WeChatForeground -Found $Found)) {
        return @{ ok = $false; code = 17
            msg = '微信不在前台（有别的窗口/置顶窗口抢了焦点），已中止且未发送' }
    }
    $howIn = Focus-Input -Found $Found -Boxes $Boxes
    Start-Sleep -Milliseconds 200
    Save-DebugShot '3-input-clicked'
    Set-ClipText -Text $Text
    Send-Key '^v' 250
    Start-Sleep -Milliseconds (OptInt 'paste_wait_ms' 600)
    Save-DebugShot '4-message-pasted'

    if ((OptBool 'verify_input' $true) -and -not [string]::IsNullOrWhiteSpace($Text)) {
        $back = Read-FocusedText
        if (-not (Same-Text $back $Text)) {
            Clear-FocusedText
            $got = [string]$back
            if ([string]::IsNullOrWhiteSpace($got)) { $hint = '读到空，可能没点进消息输入框（调 input_click_fx/fy）' }
            elseif ($got.Length -gt $Text.Length) { $hint = '读到的内容比预期长：输入框里原本有草稿，请先手动清空' }
            else { $hint = ('读到 ' + $got.Length + ' 字，与预期不符') }
            return @{ ok = $false; code = 18; msg = ('输入框回读校验失败（' + $hint + '），已中止且未发送') }
        }
        $script:Readability = 'ok'
    }
    if (-not $NoEnter) {
        Send-Key '{ENTER}' 250
        Start-Sleep -Milliseconds 400
    }
    return @{ ok = $true; code = 0; msg = '' }
}

function Send-Files {
    param($Found, $Boxes, [string[]]$Paths)
    if (-not (Assert-WeChatForeground -Found $Found)) {
        return @{ ok = $false; code = 17; msg = ('前台校验未通过：' + $script:ForegroundNote + '；未发送文件') }
    }
    $want = @($Paths)
    $exists = @($Paths | Where-Object { Test-Path -LiteralPath $_ })
    if ($exists.Count -ne $want.Count) {
        $miss = @($want | Where-Object { -not (Test-Path -LiteralPath $_) })
        return @{ ok = $false; code = 16; msg = ('文件不存在：' + ($miss -join '、')) }
    }
    [void](Focus-Input -Found $Found -Boxes $Boxes)
    Set-ClipFiles -Paths $exists
    Send-Key '^v'
    $bytes = 0
    foreach ($f in $exists) { try { $bytes += (Get-Item -LiteralPath $f).Length } catch { } }
    $extra = [math]::Min(6000, [int]($bytes / 1MB * 250))
    Start-Sleep -Milliseconds ((OptInt 'gap_ms' 1500) + $extra)
    Send-Key '{ENTER}' 250
    Start-Sleep -Milliseconds (OptInt 'file_enter_wait_ms' 1200)
    if (OptBool 'file_confirm_enter' $false) { Send-Key '{ENTER}' 250 }
    return @{ ok = $true; code = 0; msg = ($exists.Count.ToString() + ' 个文件') }
}

# ---------------------------------------------------------------------------
# 读取作业
# ---------------------------------------------------------------------------
try {
    if (-not (Test-Path $JobFile)) { throw "找不到作业文件 $JobFile" }
    $job = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:Command = [string]$job.command
    if ($job.PSObject.Properties['options'] -and $job.options) {
        foreach ($p in $job.options.PSObject.Properties) { $script:Options[$p.Name] = $p.Value }
    }
    $script:Target = [string]$job.target
    $script:Message = [string]$job.message
    if ($job.PSObject.Properties['files'] -and $job.files) { $script:Files = @($job.files) }
}
catch {
    Write-Result -Code 16 -Ok $false -ErrMsg $_.Exception.Message -Detail '读取作业文件失败'
    exit 16
}

try {
    switch ($script:Command) {

        'doctor' {
            $info = [ordered]@{
                ps_version = $PSVersionTable.PSVersion.ToString()
                language   = $ExecutionContext.SessionState.LanguageMode.ToString()
                win32      = [bool]$script:Win32
                locked     = (Test-Locked)
            }
            foreach ($c in @("$env:ProgramFiles\Tencent\Weixin\Weixin.exe",
                             "$env:ProgramFiles\Tencent\WeChat\WeChat.exe",
                             "${env:ProgramFiles(x86)}\Tencent\WeChat\WeChat.exe")) {
                if (Test-Path -LiteralPath $c) {
                    $info.exe = $c
                    try { $info.version = (Get-Item -LiteralPath $c).VersionInfo.ProductVersion } catch { }
                    break
                }
            }
            $info.process_running = [bool](Get-Process -Name Weixin, WeChat -ErrorAction SilentlyContinue)

            $found = Ensure-WeChatWindow
            $loginCls = Find-LoginWindow
            $info.login_window = $loginCls
            $info.window_found = [bool]$found
            $code = 0
            $err = ''
            $mode = ''
            if ($found) {
                $info.window_class = $found.class
                $info.matched_by = $found.by
                $info.hwnd = [int64](Get-Hwnd -Found $found)
                $boxes = Get-Boxes -Found $found
                $info.uia_edits = $boxes.edit_count
                if ($boxes.usable) { $mode = 'uia' } else { $mode = 'keyboard' }
                $info.mode = $mode
                try {
                    $r = $found.el.Current.BoundingRectangle
                    $info.rect = ([string]([math]::Round($r.X)) + ',' + [string]([math]::Round($r.Y)) + ' ' +
                                  [string]([math]::Round($r.Width)) + 'x' + [string]([math]::Round($r.Height)))
                    # 报出当前窗口下将要点击的绝对坐标，方便核对是否真的落在搜索框 / 输入框上
                    $info.search_click_abs = ([string]([math]::Round($r.X + $r.Width * (OptDbl 'search_click_fx' 0.06))) + ',' +
                                              [string]([math]::Round($r.Y + $r.Height * (OptDbl 'search_click_fy' 0.03))))
                    $info.input_click_abs = ([string]([math]::Round($r.X + $r.Width * (OptDbl 'input_click_fx' 0.60))) + ',' +
                                             [string]([math]::Round($r.Y + $r.Height * (OptDbl 'input_click_fy' 0.80))))
                } catch { }
            } else {
                $code = 10
                $err = '未找到微信主窗口：请先启动 PC 微信并登录'
                if ($loginCls) { $code = 19; $err = '微信停在登录界面（' + $loginCls + '）：请在电脑上扫码/确认登录后重试' }
            }
            if ($info.locked) { $code = 11; $err = '屏幕已锁定，键盘输入无法送达微信' }
            if ($info.language -ne 'FullLanguage') { $code = 12; $err = 'PowerShell 受限语言模式' }

            $note = ''
            if ($mode -eq 'keyboard') {
                $note = '键盘模式（微信 4.x 不暴露控件树）：发送前会做剪贴板回读校验，但无法核对会话标题，' +
                        '请务必给定时对象设置唯一前缀备注名。'
            }
            Write-Result -Code $code -Ok ($code -eq 0) -ErrMsg $err -Detail ($mode + ' 模式；' + $note) -Data $info
            exit $code
        }

        'shot' {
            # 把微信窗口当前画面存成 PNG，并标出「默认点击点」落在哪：用于校准搜索框坐标
            $found = Ensure-WeChatWindow
            if (-not $found) { Write-Result -Code 10 -Ok $false -ErrMsg '未找到微信主窗口' -Detail ''; exit 10 }
            [void](Invoke-Front -Found $found)
            Start-Sleep -Milliseconds 600
            $x = 0; $y = 0; $w = 0; $h = 0
            if (-not [WxAuto32]::Rect($script:Hwnd, [ref]$x, [ref]$y, [ref]$w, [ref]$h)) {
                Write-Result -Code 16 -Ok $false -ErrMsg '取不到窗口矩形' -Detail ''
                exit 16
            }
            $outPath = OptStr 'out' ''
            if (-not $outPath) {
                $dir = Join-Path (Split-Path -Parent $PSScriptRoot) 'data'
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                $outPath = Join-Path $dir ('shot-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')
            }
            try {
                Add-Type -AssemblyName System.Drawing | Out-Null
                $bmp = [System.Drawing.Bitmap]::new([int]$w, [int]$h)
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $g.CopyFromScreen([int]$x, [int]$y, 0, 0, [System.Drawing.Size]::new([int]$w, [int]$h))
                # 把将要点击的位置画在图上：一眼就能看出点没点对
                $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::Red, 2.0)
                $script:ShotSearch = @([int](OptInt 'search_click_ax' 234), [int](OptInt 'search_click_ay' 60))
                $script:ShotInput = @([int](OptInt 'input_click_ax' 700), [int]($h - (OptInt 'input_from_bottom' 120)))
                foreach ($m in @($script:ShotSearch, $script:ShotInput)) {
                    $px = [int]$m[0]; $py = [int]$m[1]
                    $g.DrawLine($pen, ($px - 14), $py, ($px + 14), $py)
                    $g.DrawLine($pen, $px, ($py - 14), $px, ($py + 14))
                }
                $pen.Dispose()
                $g.Dispose()
                $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
                $bmp.Dispose()
            } catch {
                Write-Result -Code 16 -Ok $false -ErrMsg ('截图失败：' + $_.Exception.Message) -Detail ''
                exit 16
            }
            $data = [ordered]@{
                rect = ([string]$x + ',' + [string]$y + ' ' + [string]$w + 'x' + [string]$h)
                search_point = ('窗口内 ' + $script:ShotSearch[0] + ',' + $script:ShotSearch[1] +
                                '｜屏幕 ' + [string]([int]($x + $script:ShotSearch[0])) + ',' + [string]([int]($y + $script:ShotSearch[1])))
                input_point = ('窗口内 ' + $script:ShotInput[0] + ',' + $script:ShotInput[1] +
                                '｜屏幕 ' + [string]([int]($x + $script:ShotInput[0])) + ',' + [string]([int]($y + $script:ShotInput[1])))
                file = $outPath
            }
            Write-Result -Code 0 -Ok $true -Detail ('窗口 ' + $data.rect + '｜搜索框点击点 ' + $data.search_point) -Data $data
            exit 0
        }

        'tree' {
            $found = Get-WindowOrExit
            $boxes = Get-Boxes -Found $found
            $all = @($found.el.FindAll($TP::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
            $dump = @()
            $i = 0
            foreach ($e in $all) {
                if ($i -ge 400) { break }
                $item = [ordered]@{ i = $i; type = $null; name = $null; auto = $null; class = $null; rect = $null }
                try { $item.type = $e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch { }
                try { $item.name = $e.Current.Name } catch { }
                try { $item.auto = $e.Current.AutomationId } catch { }
                try { $item.class = $e.Current.ClassName } catch { }
                try {
                    $b = $e.Current.BoundingRectangle
                    $item.rect = ([string]([math]::Round($b.X)) + ',' + [string]([math]::Round($b.Y)) + ' ' +
                                  [string]([math]::Round($b.Width)) + 'x' + [string]([math]::Round($b.Height)))
                } catch { }
                $dump += $item
                $i++
            }
            $mode = 'keyboard'
            if ($boxes.usable) { $mode = 'uia' }
            $data = [ordered]@{
                mode         = $mode
                window_class = $found.class
                total        = $all.Count
                edits        = $boxes.edit_count
                elements     = $dump
            }
            Write-Result -Code 0 -Ok $true -Detail ('导出 ' + $i + '/' + $all.Count + ' 个元素') -Data $data
            exit 0
        }

        'probe' {
            # 键盘链路探针：验证「窗口前置 + 搜索框能否收到文本」。全程不回车，零发送风险。
            # 输入框那一步请用 test --dry-run（它会真的打开会话再粘贴，同样不回车）。
            $found = Get-WindowOrExit
            if (Test-Locked) { Write-Result -Code 11 -Ok $false -ErrMsg '屏幕已锁定' -Detail ''; exit 11 }
            if (-not (Invoke-Front -Found $found)) {
                Write-Result -Code 17 -Ok $false -ErrMsg '无法把微信切到前台' -Detail ''
                exit 17
            }
            Start-Sleep -Milliseconds 400
            $boxes = Get-Boxes -Found $found
            $name = $script:Target
            if ([string]::IsNullOrWhiteSpace($name)) { $name = 'WXTIMER-PROBE' }

            $r = Open-Chat -Found $found -Boxes $boxes -Target $name -NoEnter
            # 收尾：清掉搜索框里的测试文本并退出搜索态，恢复原状
            Clear-FocusedText -Method (OptStr 'clear_method' 'keyboard')

            $mode = 'keyboard'
            if ($boxes.usable) { $mode = 'uia' }
            $data = [ordered]@{
                mode          = $mode
                focus_method  = (OptStr 'focus_method' 'click')
                search_box_ok = [bool]$r.ok
                search_note   = [string]$r.msg
                probe_target  = $name
                next_step     = ('run.cmd test -t ' + $name + ' -m 自检 --dry-run')
            }
            $ok = [bool]$r.ok
            $code = [int]$r.code
            $msg = [string]$r.msg
            if ($ok) { $msg = '' }
            Write-Result -Code $code -Ok $ok -ErrMsg $msg -Detail ('搜索框=' + $ok + '（未回车，未发送）') -Data $data
            exit $code
        }

        'send' {
            if ([string]::IsNullOrWhiteSpace($script:Target)) {
                Write-Result -Code 16 -Ok $false -ErrMsg 'target 为空' -Detail ''
                exit 16
            }
            $found = Get-WindowOrExit
            if (Test-Locked) { Write-Result -Code 11 -Ok $false -ErrMsg '屏幕已锁定，无法输入' -Detail ''; exit 11 }
            if (-not (Invoke-Front -Found $found)) {
                Write-Result -Code 17 -Ok $false -ErrMsg '无法把微信窗口切到前台' -Detail ''
                exit 17
            }
            Start-Sleep -Milliseconds 400

            $boxes = Get-Boxes -Found $found
            $mode = 'keyboard'
            if ($boxes.usable) { $mode = 'uia' }
            $dry = OptBool 'dry_run' $false

            $opened = Open-Chat -Found $found -Boxes $boxes -Target $script:Target
            if (-not $opened.ok) {
                $code = [int]$opened.code
                $msg = [string]$opened.msg
                Write-Result -Code $code -Ok $false -ErrMsg $msg -Detail ('mode=' + $mode)
                exit $code
            }

            if ($mode -eq 'uia' -and (OptBool 'verify_target' $true)) {
                $hit = Test-ChatTitle -Found $found -Target $script:Target
                if (-not $hit) { Start-Sleep -Milliseconds 700; $hit = Test-ChatTitle -Found $found -Target $script:Target }
                if (-not $hit) {
                    Write-Result -Code 14 -Ok $false -ErrMsg ('会话标题与【' + $script:Target + '】不一致') -Detail '已中止，未发送任何内容'
                    exit 14
                }
            }

            # 人工确认窗口：4.x 无法核对标题，这是防「发错人」的兜底
            # confirm_every_send = 每次都等；confirm_first_send = 只在该任务首次发送时等（由 Python 侧按已发次数决定）
            $needConfirm = (OptBool 'confirm_every_send' $false) -or (OptBool 'confirm_first_send' $false)
            if (-not $dry -and $needConfirm) {
                $secs = OptInt 'confirm_seconds' 8
                if ($secs -gt 0) {
                    $go = Wait-ConfirmEsc -Seconds $secs -Line ('  >> 即将发送给【' + $script:Target + '】，按 Esc 取消')
                    if (-not $go) {
                        Clear-Clip
                        Write-Result -Code 15 -Ok $false -ErrMsg '用户按 Esc 取消' -Detail ''
                        exit 15
                    }
                }
            }

            if ($dry) {
                # 完整彩排：打开会话 + 粘贴 + 回读校验，但绝不回车；随后清空草稿还原现场
                $preview = $script:Message
                if ([string]::IsNullOrWhiteSpace($preview)) { $preview = 'DRY-RUN-预览' }
                $r = Send-TextVerified -Found $found -Boxes $boxes -Text $preview -NoEnter
                Clear-FocusedText
                Clear-Clip
                $code = [int]$r.code
                $ok = [bool]$r.ok
                $msg = [string]$r.msg
                $data = [ordered]@{ dry_run = $true; mode = $mode }
                Write-Result -Code $code -Ok $ok -ErrMsg $msg `
                    -Detail ('dry-run：会话【' + $script:Target + '】已打开，输入框校验=' + $ok + '，草稿已清空，未发送') -Data $data
                exit $code
            }

            $done = @()
            $order = @('text', 'files')
            if (OptBool 'files_first' $false) { $order = @('files', 'text') }

            foreach ($kind in $order) {
                if ($kind -eq 'text') {
                    if ([string]::IsNullOrWhiteSpace($script:Message)) { continue }
                    $r = Send-TextVerified -Found $found -Boxes $boxes -Text $script:Message
                    if (-not $r.ok) {
                        Clear-Clip
                        $code = [int]$r.code
                        $msg = [string]$r.msg
                        Write-Result -Code $code -Ok $false -ErrMsg $msg -Detail ('mode=' + $mode + '; 已发出：' + ($done -join '、'))
                        exit $code
                    }
                    $done += ('文字(' + $script:Message.Length + '字)')
                } else {
                    if ($script:Files.Count -eq 0) { continue }
                    $r = Send-Files -Found $found -Boxes $boxes -Paths $script:Files
                    if (-not $r.ok) {
                        Clear-Clip
                        $code = [int]$r.code
                        $msg = [string]$r.msg
                        Write-Result -Code $code -Ok $false -ErrMsg $msg -Detail ('mode=' + $mode + '; 已发出：' + ($done -join '、'))
                        exit $code
                    }
                    $done += [string]$r.msg
                }
                Start-Sleep -Milliseconds (OptInt 'gap_ms' 1500)
            }

            Clear-Clip
            Write-Result -Code 0 -Ok $true -Data ([ordered]@{ mode = $mode }) `
                -Detail ('[' + $mode + '] 已发送给【' + $script:Target + '】：' + ($done -join '、'))
            exit 0
        }

        default {
            Write-Result -Code 16 -Ok $false -ErrMsg ('未知命令 ' + $script:Command) -Detail ''
            exit 16
        }
    }
}
catch {
    Write-Result -Code 16 -Ok $false -ErrMsg $_.Exception.Message -Detail $_.ScriptStackTrace
    exit 16
}

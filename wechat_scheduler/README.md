# 微信定时消息 · 本机服务（wechat_scheduler）

LinguaFlow「微信定时消息」模块的后端：定时驱动 **PC 微信**向指定好友/群发送**文字 + 文件**，
同时把整个项目静态托管到局域网——电脑、手机浏览器打开 `http://<电脑IP>:8765/` 即可使用全部页面。

> 📖 **完整使用教程（demo 截图、演练流程、FAQ、退出码）见 [USAGE.md](USAGE.md)**。本文偏部署与接口。

**跨平台能力矩阵（v0.30.0）**：

| 能力 | Windows | macOS | Linux |
|---|---|---|---|
| 服务本体（调度/REST/云同步/页面） | ✅ | ✅ | ✅ |
| 定时发送 | ✅ `psauto`（已验证） | 🧪 `macauto` osascript（需真机验证 + 辅助功能授权） | 🧪 `linuxauto` xdotool（需 X11/XWayland；纯 Wayland 不可用） |
| 聊天记录总结 | ✅ wechatauto-replica | ❌（经 Drive 查看结果 / 局域网访问 Win 主力机） | ❌（同左） |
| Drive 云同步 | ✅ 官方客户端 | ✅ 官方客户端 | ⚠️ 无官方客户端（建议局域网访问主力机） |

默认发送通道按系统自动选；`--sender` 可覆盖。开机自启按 OS 注册（计划任务/launchd/systemd-user）。

**发送通道（默认零依赖）**：

| 通道 | 启动参数 | 依赖 | 特点 |
|---|---|---|---|
| `psauto`（默认） | 无需参数 | **无**（系统 PowerShell + UIAutomation/Win32） | 模拟点击粘贴，不注入不 hook；剪贴板回读校验、前台断言、锁屏/登录窗识别、首次发送倒计时 |
| `wechatauto`（可选） | `--sender wechatauto` | `pip install wechatauto-replica winsdk pypinyin` | 额外提供联系人列表（读微信本地库）；发送按名称+DB 回读。**「聊天记录 AI 总结」功能依赖此库读取消息（仅读取，发送仍走默认通道）** |
| `mock`（演示） | `--mock` | 无 | 假发送真调度，走通全流程 |

> ⚠️ **风险声明**：非官方自动化（模拟操作自己的微信窗口），违反微信使用条款，高频/营销式发送有被风控风险；
> 微信 4.x 界面自绘**无法核对会话标题**——务必给定时对象设唯一前缀备注名（如 `定-妈妈`）。
> 本服务与项目对使用后果不承担任何责任。

## 与「电脑关机不受影响」的关系

消息由**这台电脑上的微信**发出：关机/锁屏/微信掉线期间无法发送；服务恢复后在**补发窗口**
（默认 240 分钟，`options.catch_up_minutes` 可调）内自动补发错过的任务（一次性补 1 条、周期任务
整段停机只补 1 条，加「【补发】」前缀）；超窗或同一计划点连续失败 5 次则**放弃留痕**，绝不轰炸收件人。

## 一、安装（一次性）

1. 安装 Python 3.9+（勾选 **Add to PATH**）：<https://www.python.org/downloads/>（pyenv-win 用户无需 rehash，启动脚本会自动扫描 versions 目录）
2. PC 微信已登录、**主窗口开着**（可最小化）。就这两步——默认通道零 pip 依赖。

## 二、启动

```bat
cd wechat_scheduler
start_wx_scheduler.bat                 :: 一键：定位 Python → 端口检查 → 启动，出错回显日志尾部
python server.py --mock                :: 演示模式（不需要微信）
python server.py --port 8765 --token mysecret   :: 指定端口与访问口令
```

- 管理页：<http://127.0.0.1:8765/wechat_schedule.html>（项目「微信定时」Tab 同源页面）
- 手机（同一局域网 Wi-Fi）：<http://<电脑IP>:8765/wechat_schedule.html>，电脑 IP 见启动日志
- 首次运行请确认 Windows 防火墙放行该端口的「专用网络」入站规则
- 开机自启：`schtasks /Create /TN "LinguaFlow微信定时服务" /TR "cmd /c cd /d <本目录> && start_wx_scheduler.bat" /SC ONSTART /RU SYSTEM /F`

数据文件在 `data/`（`tasks.json` / `history.json`，原子写；`data/.send.lock` 为发送互斥锁）。

## 三、REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 服务与通道状态、任务计数、下次触发时间 |
| GET | `/api/doctor` | 环境体检：微信窗口/锁屏/PS 语言模式/定位模式 uia\|keyboard/微信版本（psauto） |
| POST | `/api/probe` | 搜索框链路探针 `{target}`（不发送消息，psauto） |
| GET | `/api/contacts` | 联系人/会话列表（需 wechatauto-replica，否则报错、页面手填名称） |
| GET/POST | `/api/tasks` | 任务列表 / 新建 |
| PUT/DELETE | `/api/tasks/<id>` | 修改（局部字段）/ 删除 |
| POST | `/api/tasks/<id>/run` | 立即发送一次（历史标记「手动」） |
| POST | `/api/tasks/<id>/dryrun` | 演练：真实打开会话+输入框回读校验，**不按回车不发送**（psauto） |
| GET | `/api/history?limit=50` | 历史（新→旧；补发/手动/演练/放弃标记，每条含 `id`） |
| DELETE | `/api/history/<id>` | 删除单条历史 |
| DELETE | `/api/history` | 清空全部历史（不影响任务） |
| GET | `/api/messages` | **读聊天记录** `?target=wxid或名称&start=&end=`（本地 ISO；缺省 `hours=24`）。经 wechatauto-replica 本地解密读取，返回 `{messages:[{time,sender_name,type,content}], display, scanned}` |
| POST/GET | `/api/summaries` | 保存/列出聊天记录 AI 总结记录（服务端存 `data/summaries.json`，上限 100） |
| DELETE | `/api/summaries/<id>` · `/api/summaries` | 删除单条 / 清空总结记录 |
| GET/PUT | `/api/settings` | 云同步设置 `{drive_path, auto_backup}`（PUT 带 `test:true` 保存即试写） |
| POST | `/api/backup` | 立即备份；GET `/api/backup/status` 最近备份+快照列表；GET `/api/backup/snapshot?name=` 读包 |
| POST/GET | `/api/browser-data` | 页面推送/拉取浏览器数据（服务端强制剥离 apiKey/token） |
| POST | `/api/restore` | 恢复：`{name}` Drive 快照 / `{bundle}` 上传文件；返回 browser_state 供页面写回 |
| GET/POST | `/api/autostart` | 开机自启状态 / `{enable:true|false}` 注册或取消 |

任务体与调度模型：

```jsonc
{
  "name": "妈妈生日",
  "receiver": { "wxid": "可留空", "name": "定-妈妈" },   // psauto 按 name 搜索会话
  "content": "{target}，生日快乐！{note}",               // 占位符 {target}{date}{time}{note}
  "note": "记得买蛋糕",
  "files": ["assets/shengri.png"],                       // 可选附件，每行一路径；相对路径按本目录解析
  "schedule": { "type": "yearly", "date": "05-10", "time": "08:30" },
  "options": { "catch_up_minutes": 240 },                // 透传驱动参数（见 USAGE §options）
  "enabled": true
}
```

`schedule.type`：`once`（`at`）｜ `daily`（`time`）｜ `weekly`（`time`+`weekdays[1..7]`，1=周一）｜
`monthly`（`time`+`day 1..31`+`clamp`，当月无此日提前到月末/跳过）｜ `yearly`（`time`+`date MM-DD`，2-29 只在闰年）。
设置了 `--token` 时 `/api/*` 需请求头 `X-Api-Token`。

## 四、psauto 驱动退出码

| code | 含义 | 处理 |
|---|---|---|
| 0 | 成功 | — |
| 10 | 未找到微信主窗口 | 微信进程在跑但窗口缩进托盘时**会自动唤回**（托盘兜底已修复）；仍报 10 = 微信没启动或未登录 |
| 11 | 屏幕锁定 | 解锁后自动重试（补发窗口内） |
| 12 | PowerShell 受限语言模式 | 用普通 cmd/PowerShell 启动服务 |
| 13 | 搜索框没收到文本 | 校准 `options.search_click_ax/ay`（USAGE §校准） |
| 14 | 会话标题与目标不符（仅 3.9 uia 模式可校验） | 检查 target 与备注名是否完全一致 |
| 15 | 你在首次发送倒计时中按了 Esc | 本次取消（正常保护） |
| 16 | 过程异常/驱动超时 | 看日志与 `data/debug/*.png` |
| 17 | 微信不在前台（被抢占） | 稍后自动重试；发送时别操作电脑 |
| 18 | 输入框回读校验失败，已中止未发送 | 多半是搜索下拉「搜一搜」抢了焦点——用唯一前缀备注名或 `open_method:"click"` |
| 19 | 微信停在登录界面 | 扫码登录后自动恢复 |

**聊天记录读取异常**：报「database disk image is malformed」≠ 数据损坏——微信活跃写入时上游会读到撕裂的临时合并副本（常见于刚聊过的群，尤其个别成员不在索引、回查 contact.db 昵称时触发）。服务内置三级自愈：重置连接重试 → 清合并缓存强制重建 → 昵称查询失败降级为 ID 显示、不阻断整次读取（日志可见）。仍持续失败时完全退出并重启 PC 微信（触发 WAL 检查点），再用微信「设置 → 通用 → 故障修复」处理。

## 五、代码结构

```
server.py           # 入口：HTTP(标准库) + 调度线程（补发窗口/重试上限/占位符/发送锁）+ 静态托管
scheduler_logic.py  # 纯函数：next_occurrence（五种调度）/ validate_schedule / schedule_text
store.py            # tasks.json / history.json 原子读写
ps_driver.py        # Python ↔ PowerShell 驱动桥（UTF-8 JSON 作业文件，退出码表）
wx_sender.py        # 通道统一接口：PsAutoSender(默认) / WechatAutoSender(可选) / MockSender
wx_reader.py        # 聊天记录本地读取（wechatauto-replica WeChatDB，时间窗口过滤，供 AI 总结）
sync.py             # 云同步引擎：Drive 读写/每日快照/自动备份去抖/恢复/脱密/开机自启注册
scripts/WeChatAuto.ps1   # 界面驱动（移植自 wxtimer，真机打磨）：找窗口/哨兵剪贴板校验/前台断言/倒计时
start_wx_scheduler.bat
```

## 六、数据云同步与服务自启（v0.29.0）

- **Google Drive 镜像**：设置 Drive 路径（Google Drive 桌面客户端的本地同步文件夹）后，服务把「浏览器数据 + 微信任务/历史/总结」写入 `<Drive>/<用户目录>/LinguaFlow/`：`latest.json` + 每日快照（保留 14 份）。数据变化去抖 5 秒自动备份；恢复/导入/导出均在云同步面板操作。**备份包永不含 API Key 与访问口令**（客户端+服务端双重剥离）。
- **全模块入口（v0.31.0，v0.32.0 统一）**：`cloud-sync.js` 云同步抽屉——**每个模块页（含微信工具页）**左下角「☁」胶囊点开即得完整控制（Drive 路径/目录浏览器/自动备份/立即备份/恢复/快照/导入导出/开机自启），单一入口、单一实现；微信工具页不再有独立云卡片，「一键拉起服务」按钮在其「定时服务连接」区。
- **开机自启（推荐）**：管理页「注册开机自启」= 服务生成 `launch_hidden.vbs`（静默、用当前解释器绝对路径）并注册 `schtasks /SC ONLOGON`；此后登录系统即有服务，无需再开 bat 窗口。
- **一键拉起（可选）**：`chrome_extension/install_native_host_win.bat <扩展ID>` 注册 native host 后，装了扩展的浏览器在服务未启动时可点「一键拉起服务」（宿主探测 8765 端口，未监听则脱离会话启动 server.py）。卸载：`reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.linguaflow.launcher" /f`。

⚠️ 维护约定：`start_wx_scheduler.bat` 必须 **GBK+CRLF**、`scripts/WeChatAuto.ps1` 必须 **UTF-8+BOM+CRLF**
（Windows PowerShell 5.1 对无 BOM UTF-8 中文注释会乱码报错），改完别用 UTF-8/LF 工具顺手重写。

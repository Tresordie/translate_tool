"""微信聊天记录本地读取（wechatauto-replica WeChatDB，SQLCipher 本地解密）。

隐私边界：消息只从本机微信数据目录读取，经服务端 API 返回给管理页；
除用户自行配置的 AI 接口外，不经过任何第三方。
依赖 wechatauto-replica（可选安装；未装时给出明确中文错误，不影响其它功能）。
"""

import html as _html
import os
import re
import sys
import threading
import time
from datetime import datetime

_lock = threading.Lock()
_db = None
_last_db = [None]  # 最近一次成功构造的实例：_db 被重置后仍能定位其 workdir 清缓存
_nick_cache = {}

# 引用/卡片/撤回类消息的 content 是微信协议 XML（<msgsource>/<appmsg>/<refermsg>…），
# 直接进预览与 AI 语料会全是标签噪音；提取其中的 <title>/<content> 语义文本代替。
# 注意存在「提取出的 content 仍是转义过的 XML」的嵌套情况，需 unescape 后迭代处理（最多 3 层）。
_XML_HINT = re.compile(r"<\?xml|<(msg|msgsource|appmsg|refermsg|title|content|img|body)\b", re.I)
_TAG_TITLE = re.compile(r"<title>(.*?)</title>", re.S | re.I)
_TAG_CONTENT = re.compile(r"<content>(.*?)</content>", re.S | re.I)


def _extract_semantic(c):
    """从一层协议 XML 中取 title/content 语义文本；纯噪音返回 []。"""
    parts = []
    titles = [t.strip() for t in _TAG_TITLE.findall(c) if t.strip()]
    if titles:
        parts.append(titles[-1])
    for x in _TAG_CONTENT.findall(c):
        x = x.strip()
        if x and x not in parts:
            parts.append(x)
    return parts


def _deep_unescape(s):
    """反复 unescape 直到稳定（真机存在 &amp;lt; 双重转义），最多 3 轮。"""
    for _ in range(3):
        u = _html.unescape(s)
        if u == s:
            break
        s = u
    return s


def clean_content(mtype, content):
    """非文本消息的 XML 协议体 → 语义文本（多层嵌套自动展开）；提不出则 [类型] 占位。"""
    c = _deep_unescape(str(content or "")).strip()
    if not c:
        return "[%s]" % (mtype or "消息")
    if not _XML_HINT.search(c):
        return c
    out, pending = [], [c]
    for _ in range(3):
        nxt = []
        for p in pending:
            if _XML_HINT.search(p):
                got = _extract_semantic(p)
                if not got:
                    continue  # 只剩协议噪音，丢弃
                for g in got:
                    g = _deep_unescape(g).strip()  # 嵌套转义 XML：解开后再判断
                    if not g or g in out:
                        continue
                    (nxt if _XML_HINT.search(g) else out).append(g)
            elif p not in out:
                out.append(p)
        pending = [p for p in nxt if p not in out]
        if not pending:
            break
    out = [p for p in out if p.strip()][:3]
    return " ｜ ".join(out) or ("[%s]" % (mtype or "消息"))


class ReaderError(Exception):
    pass


class _DbCorrupt(Exception):
    """数据库镜像损坏类错误：可能是单例缓存了撕裂的合并临时库，重置连接重试或可恢复。"""
    pass


_CORRUPT_HINTS = ("malformed", "not a database", "disk i/o")


def _is_corrupt(e):
    m = str(e).lower()
    return any(h in m for h in _CORRUPT_HINTS)


def _reset_db():
    global _db
    with _lock:
        _db = None


def _purge_merged_cache():
    """删除 wechatauto 的合并临时库（%TEMP%\\wechatauto_db\\<账号>，保留 keys.json 密钥缓存）。

    上游把「合并结果」按 stamp 跨实例缓存复用；活跃群写入竞态可能产出一个
    quick_check 通过、但 SELECT 才爆 malformed 的坏镜像并被固化——只重建连接
    （_reset_db）不够，必须删掉坏缓存文件强制全量重解密。
    """
    global _db
    with _lock:
        db, _db = _db, None
    if db is None:
        db = _last_db[0]
    _last_db[0] = None
    _nick_cache.clear()
    wd = getattr(db, "workdir", None) if db else None
    if not wd or not os.path.isdir(wd):
        return 0
    removed = 0
    for f in os.listdir(wd):
        if f == "keys.json":
            continue
        try:
            os.remove(os.path.join(wd, f))
            removed += 1
        except OSError:
            pass
    return removed


def _install_nickname_guard(db):
    """上游 _msg_row_to_dict 对索引未命中的 sender_id 会回查 contact.db 取昵称；
    活跃会话期间 contact.db 合并副本偶发 malformed，会让整次读取功亏一篑。
    类级守卫：昵称查询失败降级为空串（发送人回退显示 ID），不影响消息主体读取。"""
    cls = type(db)
    if getattr(cls.get_nickname, "_wxguard", False):
        return
    orig = cls.get_nickname

    def safe(self, user, *a, **kw):
        try:
            return orig(self, user, *a, **kw)
        except Exception as e:
            print("[wx-schedule] 昵称查询降级(%s)：%s" % (user, e), flush=True)
            return ""

    safe._wxguard = True
    cls.get_nickname = safe


def _get_db():
    global _db
    with _lock:
        if _db is None:
            if not sys.platform.startswith(("win", "cygwin", "msys")):
                raise ReaderError(
                    "聊天记录读取目前仅支持 Windows 微信（wechatauto-replica）。"
                    "跨平台用法：在 Windows 主力机上做总结，结果经 Google Drive 同步后所有系统可查看；"
                    "其他电脑也可经局域网直接访问主力机服务（http://<主力机IP>:8765/）使用总结功能")
            try:
                from wechatauto import WeChatDB
            except ImportError:
                raise ReaderError("读取聊天记录需安装 wechatauto-replica：pip install wechatauto-replica winsdk pypinyin")
            try:
                _db = WeChatDB()  # 首次会做密钥提取（约 20s），之后走缓存
            except Exception as e:
                raise ReaderError("打开微信本地数据库失败（确认 PC 微信 4.x 已登录）：%s" % e)
            _install_nickname_guard(_db)
        return _db


def _nickname(db, wxid):
    if not wxid:
        return ""
    if wxid in _nick_cache:
        return _nick_cache[wxid]
    name = ""
    try:
        name = db.get_nickname(wxid) or wxid
    except Exception:
        name = wxid
    if len(_nick_cache) < 2000:
        _nick_cache[wxid] = name
    return name


def resolve_target(db, target):
    """wxid/群号直接使用；否则按名称搜联系人（唯一匹配才放行）。返回 (username, 显示名)。"""
    t = str(target or "").strip()
    if not t:
        raise ReaderError("请指定会话（wxid 或名称）")
    if t == "filehelper" or t.startswith("wxid_") or t.endswith("@chatroom"):
        return t, _nickname(db, t) or t
    try:
        hits = db.search_contact(t) or []
    except Exception as e:
        raise _DbCorrupt(e) if _is_corrupt(e) else ReaderError("搜索联系人失败：%s" % e)
    exact = [h for h in hits if str(h.get("nick_name") or h.get("remark") or "") == t] or hits
    if len(exact) == 1:
        h = exact[0]
        return str(h.get("username") or ""), str(h.get("nick_name") or h.get("remark") or t)
    if not exact:
        raise ReaderError("未找到名为「%s」的联系人/群（可在列表中点选以使用 wxid）" % t)
    raise ReaderError("「%s」匹配到 %d 个联系人，请改用 wxid 或更精确的备注名" % (t, len(exact)))


def _read_once(target, start_ts, end_ts, scan_limit, max_rows):
    db = _get_db()
    _last_db[0] = db
    username, disp = resolve_target(db, target)
    try:
        rows = db.get_messages(username, limit=scan_limit)  # 新→旧
    except Exception as e:
        raise _DbCorrupt(e) if _is_corrupt(e) else ReaderError("读取消息失败：%s" % e)
    out = []
    for r in reversed(rows):
        try:
            ct = int(r.get("create_time") or 0)
        except (TypeError, ValueError):
            continue
        if ct < start_ts or ct > end_ts:
            continue
        mtype = str(r.get("type") or "")
        content = clean_content(mtype, r.get("content"))
        if not content:
            content = "[%s]" % (mtype or "消息")
        sender = str(r.get("sender_username") or "")
        out.append({
            "time": datetime.fromtimestamp(ct).strftime("%Y-%m-%d %H:%M:%S"),
            "sender_wxid": sender,
            "sender_name": _nickname(db, sender) or disp,
            "type": mtype,
            "content": content[:2000],
        })
    return out[-max_rows:], len(rows), disp


def read_messages(target, start_ts, end_ts, scan_limit=3000, max_rows=800):
    """读取 [start_ts, end_ts]（unix 秒，闭区间）内的消息，时间升序。

    返回 (messages, scanned_count, display_name)。
    messages: [{time, sender_wxid, sender_name, type, content}]
    非文本消息保留 [图片]/[语音] 等类型占位。

    自愈：微信恰在写入时读到的「malformed」多为上游把撕裂的合并临时库缓存固化，
    依次「重建连接 → 清合并缓存强制全量重解密」重试（共 3 次尝试）；仍失败才报错
    （真损坏需微信端修复）。
    """
    for attempt in (1, 2, 3):
        try:
            return _read_once(target, start_ts, end_ts, scan_limit, max_rows)
        except _DbCorrupt as e:
            if attempt == 1:
                _reset_db()
                print("[wx-schedule] 检测到数据库镜像错误（%s），重置连接重试" % e, flush=True)
                continue
            if attempt == 2:
                n = _purge_merged_cache()
                print("[wx-schedule] 重试仍损坏，已清合并缓存（%d 个文件）强制重建后再试" % n, flush=True)
                time.sleep(1.5)
                continue
            raise ReaderError("数据库镜像持续损坏（%s）：已自动重建连接并清理合并缓存仍失败，"
                              "请完全退出并重启 PC 微信（触发 WAL 检查点）再试；"
                              "若仍失败，用该会话所在微信的「设置→通用→故障修复」修复本地存储" % e)
    return [], 0, ""

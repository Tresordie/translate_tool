"""纯调度计算逻辑（无 I/O、仅标准库）。

调度模型 schedule:
  {"type": "once",    "at": "YYYY-MM-DDTHH:MM"}
  {"type": "daily",   "time": "HH:MM"}
  {"type": "weekly",  "time": "HH:MM", "weekdays": [1..7]}   # 1=周一 ... 7=周日
  {"type": "monthly", "time": "HH:MM", "day": 1..31, "clamp": true}   # 当月无此日：clamp=true 提前到月末，false 跳过该月
  {"type": "yearly",  "time": "HH:MM", "date": "MM-DD"}      # 每年月日；2-29 只在闰年出现

时间一律为本地时间 naive datetime，字符串格式 ISO（HH:MM 或 HH:MM:SS 均可解析）。
"""

import calendar
from datetime import datetime, timedelta

WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
_DT_FMT = "%Y-%m-%dT%H:%M:%S"


def parse_dt(s):
    """ISO 字符串 → datetime；失败抛 ValueError。"""
    return datetime.fromisoformat(s)


def fmt_dt(dt):
    """datetime → 存储用字符串（分钟精度）。"""
    return dt.strftime(_DT_FMT)


def parse_hm(s):
    """'HH:MM' → (hour, minute)；非法抛 ValueError。"""
    parts = str(s).strip().split(":")
    if len(parts) not in (2, 3):
        raise ValueError("时间格式应为 HH:MM")
    h, m = int(parts[0]), int(parts[1])
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError("时间超出范围")
    return h, m


def parse_month_day(s):
    """'MM-DD'（也接受 'YYYY-MM-DD'，只取月日）→ (month, day)；非法抛 ValueError。"""
    parts = str(s).strip().split("-")
    if len(parts) == 3:
        parts = parts[1:]
    if len(parts) != 2:
        raise ValueError("日期格式应为 MM-DD")
    m, d = int(parts[0]), int(parts[1])
    datetime(2024, m, d)  # 2024 为闰年：允许 2-29，拒绝 2-30/13-1 等
    return m, d


def validate_schedule(schedule, now=None):
    """返回错误信息（中文）或 None（合法）。"""
    if not isinstance(schedule, dict):
        return "调度规则格式错误"
    t = schedule.get("type")
    if t == "once":
        at = schedule.get("at")
        try:
            dt = parse_dt(at)
        except (TypeError, ValueError):
            return "一次性任务需要有效的时间（YYYY-MM-DDTHH:MM）"
        if now is not None and dt <= now:
            return "一次性任务的发送时间必须晚于当前时间"
        return None
    if t == "daily":
        try:
            parse_hm(schedule.get("time"))
        except (TypeError, ValueError):
            return "每日任务需要有效的时间（HH:MM）"
        return None
    if t == "weekly":
        try:
            parse_hm(schedule.get("time"))
        except (TypeError, ValueError):
            return "每周任务需要有效的时间（HH:MM）"
        days = schedule.get("weekdays")
        if not isinstance(days, list) or not days:
            return "每周任务至少勾选一天"
        for w in days:
            try:
                if not (1 <= int(w) <= 7):
                    raise ValueError
            except (TypeError, ValueError):
                return "星期取值必须为 1-7（1=周一）"
        return None
    if t == "monthly":
        try:
            parse_hm(schedule.get("time"))
        except (TypeError, ValueError):
            return "每月任务需要有效的时间（HH:MM）"
        try:
            if not (1 <= int(schedule.get("day")) <= 31):
                raise ValueError
        except (TypeError, ValueError):
            return "每月任务的日期取值必须为 1-31"
        return None
    if t == "yearly":
        try:
            parse_hm(schedule.get("time"))
        except (TypeError, ValueError):
            return "每年任务需要有效的时间（HH:MM）"
        try:
            parse_month_day(schedule.get("date"))
        except (TypeError, ValueError):
            return "每年任务的日期无效（应为存在的 MM-DD）"
        return None
    return "未知的调度类型（once / daily / weekly / monthly / yearly）"


def next_occurrence(schedule, after):
    """严格晚于 after 的下一次触发时间；不再有下一次返回 None。"""
    t = schedule.get("type")
    if t == "once":
        dt = parse_dt(schedule["at"])
        return dt if dt > after else None
    if t in ("daily", "weekly"):
        h, m = parse_hm(schedule["time"])
        days = None
        if t == "weekly":
            days = {int(w) for w in schedule["weekdays"]}
        # 从今天起逐日找第一个「星期匹配且时间严格晚于 after」的分钟
        for offset in range(0, 8):
            day = after + timedelta(days=offset)
            cand = day.replace(hour=h, minute=m, second=0, microsecond=0)
            if cand <= after:
                continue
            if days is None or cand.isoweekday() in days:
                return cand
        return None
    if t == "monthly":
        h, m = parse_hm(schedule["time"])
        want = int(schedule["day"])
        clamp = bool(schedule.get("clamp", True))
        year, month = after.year, after.month
        for _ in range(0, 26):  # 最多向后看两年
            last = calendar.monthrange(year, month)[1]
            actual = want if want <= last else (last if clamp else 0)
            if actual:
                cand = datetime(year, month, actual, h, m)
                if cand > after:
                    return cand
            month += 1
            if month == 13:
                month, year = 1, year + 1
        return None
    if t == "yearly":
        h, m = parse_hm(schedule["time"])
        mm, dd = parse_month_day(schedule["date"])
        year = after.year
        for _ in range(0, 6):  # 2-29 遇非闰年跳过，最多看 5 年
            try:
                cand = datetime(year, mm, dd, h, m)
            except ValueError:
                cand = None
            if cand and cand > after:
                return cand
            year += 1
        return None
    return None


def schedule_text(schedule):
    """人类可读的调度描述。"""
    t = schedule.get("type")
    try:
        if t == "once":
            return parse_dt(schedule["at"]).strftime("%Y-%m-%d %H:%M") + "（一次性）"
        if t == "daily":
            return "每天 " + str(schedule["time"])
        if t == "weekly":
            names = "/".join(WEEKDAY_NAMES[int(w) - 1] for w in sorted(int(x) for x in schedule["weekdays"]))
            return "每周 %s %s" % (names, schedule["time"])
        if t == "monthly":
            extra = "" if bool(schedule.get("clamp", True)) else "（当月无此日跳过）"
            return "每月 %s 日 %s%s" % (schedule["day"], schedule["time"], extra)
        if t == "yearly":
            mm, dd = parse_month_day(schedule["date"])
            return "每年 %02d-%02d %s" % (mm, dd, schedule["time"])
    except (TypeError, ValueError, IndexError):
        pass
    return str(schedule)

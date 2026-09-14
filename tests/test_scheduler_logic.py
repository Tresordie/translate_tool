# -*- coding: utf-8 -*-
"""wechat_scheduler/scheduler_logic.py 纯逻辑自测（无第三方依赖）。

运行：python tests/test_scheduler_logic.py   （全部通过输出 ALL PASS）
"""

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "wechat_scheduler"))

from scheduler_logic import (  # noqa: E402
    fmt_dt, next_occurrence, parse_dt, parse_hm, schedule_text, validate_schedule,
)

DT = datetime


def check(name, got, want):
    if got != want:
        raise AssertionError("%s: got %r, want %r" % (name, got, want))


def test_parse():
    check("parse_dt 分钟", parse_dt("2026-09-14T08:30"), DT(2026, 9, 14, 8, 30))
    check("parse_hm", parse_hm("08:05"), (8, 5))
    check("fmt_dt", fmt_dt(DT(2026, 9, 14, 8, 30, 45)), "2026-09-14T08:30:45")


def test_once():
    after = DT(2026, 9, 13, 10, 0)
    sched = {"type": "once", "at": "2026-09-14T08:30"}
    check("once 未来", next_occurrence(sched, after), DT(2026, 9, 14, 8, 30))
    check("once 已过", next_occurrence(sched, DT(2026, 9, 15)), None)
    check("once 未来合法", validate_schedule(sched, after), None)
    check("once 过去拒绝", validate_schedule({"type": "once", "at": "2026-09-13T09:00"}, after) is not None, True)
    check("once 非法格式", validate_schedule({"type": "once", "at": "abc"}, after) is not None, True)


def test_daily():
    check("daily 今天未到", next_occurrence({"type": "daily", "time": "18:00"}, DT(2026, 9, 13, 10, 0)), DT(2026, 9, 13, 18, 0))
    check("daily 今天已过", next_occurrence({"type": "daily", "time": "08:30"}, DT(2026, 9, 13, 10, 0)), DT(2026, 9, 14, 8, 30))
    check("daily 恰好等于当前 → 严格晚于", next_occurrence({"type": "daily", "time": "10:00"}, DT(2026, 9, 13, 10, 0)), DT(2026, 9, 14, 10, 0))
    check("daily 秒级当前仍在窗口内", next_occurrence({"type": "daily", "time": "10:00"}, DT(2026, 9, 13, 9, 59, 59)), DT(2026, 9, 13, 10, 0))
    check("daily 非法时间", validate_schedule({"type": "daily", "time": "25:00"}) is not None, True)
    check("daily 合法", validate_schedule({"type": "daily", "time": "08:30"}), None)


def test_weekly():
    # 2026-09-13 是周日（isoweekday=7）
    sun10 = DT(2026, 9, 13, 10, 0)
    check("weekly 周一", next_occurrence({"type": "weekly", "time": "09:00", "weekdays": [1]}, sun10), DT(2026, 9, 14, 9, 0))
    check("weekly 今天星期匹配但时间已过 → 下周", next_occurrence({"type": "weekly", "time": "08:00", "weekdays": [7]}, sun10), DT(2026, 9, 20, 8, 0))
    check("weekly 今天星期匹配且未到", next_occurrence({"type": "weekly", "time": "20:00", "weekdays": [7]}, sun10), DT(2026, 9, 13, 20, 0))
    check("weekly 多天取最早", next_occurrence({"type": "weekly", "time": "08:30", "weekdays": [5, 1]}, sun10), DT(2026, 9, 14, 8, 30))
    check("weekly 空星期", validate_schedule({"type": "weekly", "time": "08:00", "weekdays": []}) is not None, True)
    check("weekly 越界星期", validate_schedule({"type": "weekly", "time": "08:00", "weekdays": [8]}) is not None, True)
    check("weekly 合法", validate_schedule({"type": "weekly", "time": "08:00", "weekdays": [1, 3, 5]}), None)


def test_schedule_text():
    check("text once", schedule_text({"type": "once", "at": "2026-09-14T08:30"}), "2026-09-14 08:30（一次性）")
    check("text daily", schedule_text({"type": "daily", "time": "08:30"}), "每天 08:30")
    check("text weekly 乱序归一", schedule_text({"type": "weekly", "time": "09:00", "weekdays": [5, 1]}), "每周 周一/周五 09:00")


def test_unknown_type():
    check("未知类型", validate_schedule({"type": "cron", "expr": "* * *"}), "未知的调度类型（once / daily / weekly / monthly / yearly）")
    check("非字典", validate_schedule("bad") is not None, True)
    check("未知 next", next_occurrence({"type": "??"}, DT(2026, 1, 1)), None)


def test_monthly():
    # 每月 31 日 clamp：2 月无 31 → 提前到月末（2026-02 有 28 天）
    jan15 = DT(2026, 1, 15, 10, 0)
    check("monthly 31→月末", next_occurrence({"type": "monthly", "day": 31, "time": "09:00"}, DT(2026, 1, 31, 10, 0)), DT(2026, 2, 28, 9, 0))
    check("monthly 正常", next_occurrence({"type": "monthly", "day": 15, "time": "09:00"}, jan15), DT(2026, 2, 15, 9, 0))
    check("monthly 未到仍在本月", next_occurrence({"type": "monthly", "day": 20, "time": "09:00"}, jan15), DT(2026, 1, 20, 9, 0))
    check("monthly clamp=false 跳过2月", next_occurrence({"type": "monthly", "day": 31, "time": "09:00", "clamp": False}, DT(2026, 1, 31, 10, 0)), DT(2026, 3, 31, 9, 0))
    check("monthly 闰年 30→29", next_occurrence({"type": "monthly", "day": 30, "time": "08:00"}, DT(2024, 1, 31, 10, 0)), DT(2024, 2, 29, 8, 0))
    check("monthly day 越界", validate_schedule({"type": "monthly", "day": 32, "time": "09:00"}) is not None, True)
    check("monthly day 0", validate_schedule({"type": "monthly", "day": 0, "time": "09:00"}) is not None, True)
    check("monthly 合法", validate_schedule({"type": "monthly", "day": 31, "time": "09:00"}), None)


def test_yearly():
    check("yearly 已过→明年", next_occurrence({"type": "yearly", "date": "05-10", "time": "08:30"}, DT(2026, 9, 13, 10, 0)), DT(2027, 5, 10, 8, 30))
    check("yearly 未到→今年", next_occurrence({"type": "yearly", "date": "12-31", "time": "00:05"}, DT(2026, 9, 13, 10, 0)), DT(2026, 12, 31, 0, 5))
    check("yearly 2-29 只在闰年", next_occurrence({"type": "yearly", "date": "02-29", "time": "08:00"}, DT(2025, 3, 1, 10, 0)), DT(2028, 2, 29, 8, 0))
    check("yearly 完整日期只取月日", next_occurrence({"type": "yearly", "date": "2000-05-10", "time": "08:30"}, DT(2026, 9, 13, 10, 0)), DT(2027, 5, 10, 8, 30))
    check("yearly 2-30 非法", validate_schedule({"type": "yearly", "date": "02-30", "time": "08:00"}) is not None, True)
    check("yearly 13 月非法", validate_schedule({"type": "yearly", "date": "13-01", "time": "08:00"}) is not None, True)
    check("yearly 合法", validate_schedule({"type": "yearly", "date": "05-10", "time": "08:30"}), None)
    check("yearly text", schedule_text({"type": "yearly", "date": "05-10", "time": "08:30"}), "每年 05-10 08:30")
    check("monthly text clamp默认", schedule_text({"type": "monthly", "day": 10, "time": "08:00"}), "每月 10 日 08:00")
    check("monthly text 跳过", schedule_text({"type": "monthly", "day": 31, "time": "08:00", "clamp": False}), "每月 31 日 08:00（当月无此日跳过）")


if __name__ == "__main__":
    for fn in [test_parse, test_once, test_daily, test_weekly, test_monthly, test_yearly, test_schedule_text, test_unknown_type]:
        fn()
        print("PASS %s" % fn.__name__)
    print("ALL PASS")

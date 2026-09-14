# -*- coding: utf-8 -*-
"""wx_reader.clean_content 消息协议体清洗自测（无第三方依赖）。

运行：python tests/test_wx_reader_clean.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "wechat_scheduler"))

from wx_reader import clean_content  # noqa: E402


def check(name, got, want):
    if got != want:
        raise AssertionError("%s: got %r, want %r" % (name, got, want))


def test_plain():
    check("普通文本原样", clean_content("文本", "今天进度如何？"), "今天进度如何？")
    check("空内容给占位", clean_content("图片", ""), "[图片]")
    check("非XML短串原样", clean_content("文本", "ok"), "ok")


def test_quote():
    # 引用消息：外层 content 是真实消息，refermsg 内层是被引用原文
    xml = ('<?xml version="1.0"?><msg><img aeskey="x"/><refermsg>'
           '<type>57</type><content>我不知道变更位置是哪里</content><displayname>SIE Jamison</displayname>'
           '</refermsg><title></title><content>@未来(☆_☆) - 新PCBA 的制程不影响吗？包含焊接跟分析？</content></msg>')
    out = clean_content("引用", xml)
    # refermsg 内层原文在前、外层新消息在后，两段都保留（对 AI 理解上下文有用）
    check("引用取双段 content", out, "我不知道变更位置是哪里 ｜ @未来(☆_☆) - 新PCBA 的制程不影响吗？包含焊接跟分析？")


def test_card_title():
    xml = '<appmsg appid="" sdkver="0"><title>CTJ1129837875: 我来看看</title><des></des><type>57</type></appmsg>'
    check("卡片取 title", clean_content("文件/链接/卡片", xml), "CTJ1129837875: 我来看看")


def test_nested_escaped():
    # 真机案例：content 内嵌「转义后的 XML」——unescape 后迭代提取，绝不输出原始标签
    inner = "&lt;?xml version=&quot;1.0&quot;?&gt;&lt;msg&gt;&lt;img aeskey=&quot;k&quot;/&gt;&lt;yunpan_ext folder=&quot;3&quot; /&gt;&lt;/msg&gt;"
    xml = "<msg><appmsg><title>1号线</title><content>%s</content></appmsg></msg>" % inner
    out = clean_content("文件/链接/卡片", xml)
    check("嵌套转义只剩语义文本", out, "1号线")  # 内层是纯协议噪音（img/yunpan），丢弃
    assert "<" not in out and "xml" not in out.lower(), "不应残留 XML"
    # 双重转义（真机实测存在 &amp;lt; 形态）
    xml2 = "<msg><appmsg><title>2号线</title><content>&amp;lt;?xml version=&amp;quot;1.0&amp;quot;?&amp;gt;&amp;lt;msg&amp;gt;&amp;lt;img/&amp;gt;&amp;lt;/msg&amp;gt;</content></appmsg></msg>"
    check("双重转义同样清洗", clean_content("文件/链接/卡片", xml2), "2号线")


def test_pure_noise():
    xml = '<msgsource><signature>N0_V1_9BRn+xb</signature><tmp_node/></msgsource>'
    check("纯噪音给类型占位", clean_content("系统消息", xml), "[系统消息]")


def test_corrupt_selfheal():
    """镜像损坏错误 → 第 2 次尝试前重置连接；第 3 次尝试前清合并缓存；普通错误不重试。"""
    import tempfile
    import wx_reader

    calls = {'n': 0}
    wd = tempfile.mkdtemp(prefix="wxcache-")
    open(wd + "/message__message_0.db", "w").write("bad")
    open(wd + "/message__message_0.db.stamp", "w").write("x")
    open(wd + "/keys.json", "w").write("{}")

    class FakeDB:
        workdir = wd

        def get_nickname(self, w):
            return w

        def get_messages(self, user, limit=3000):
            calls['n'] += 1
            if calls['n'] <= 2:  # 前两次都损坏：走「重置连接」+「清缓存」两级自愈
                raise Exception('database disk image is malformed')
            return []

    orig = wx_reader._get_db
    wx_reader._get_db = lambda: FakeDB()
    try:
        msgs, scanned, disp = wx_reader.read_messages('filehelper', 0, 99999999999)
        check("两级自愈后成功", calls['n'], 3)
        import os
        check("坏缓存已删（db 文件）", os.path.exists(wd + "/message__message_0.db"), False)
        check("坏缓存已删（stamp）", os.path.exists(wd + "/message__message_0.db.stamp"), False)
        check("密钥缓存保留", os.path.exists(wd + "/keys.json"), True)

        calls['n'] = 0

        class BadDB(FakeDB):
            def get_messages(self, user, limit=3000):
                calls['n'] += 1
                raise Exception('no such table: message_0')

        wx_reader._get_db = lambda: BadDB()
        try:
            wx_reader.read_messages('filehelper', 0, 99999999999)
            raise AssertionError('应抛出 ReaderError')
        except wx_reader.ReaderError as e:
            check("非损坏错误不重试", calls['n'], 1)
            assert '读取消息失败' in str(e)
    finally:
        wx_reader._get_db = orig


def test_nickname_guard():
    """get_nickname 抛错（contact.db 撕裂副本）→ 降级空串，不炸整次读取。"""
    import wx_reader

    class G:
        def get_nickname(self, user):
            raise Exception("database disk image is malformed")

    wx_reader._install_nickname_guard(G())
    check("昵称查询失败降级为空", G().get_nickname("wxid_x"), "")
    # 幂等：重复安装不叠加包装
    wx_reader._install_nickname_guard(G())
    check("守卫幂等", G().get_nickname("wxid_y"), "")


if __name__ == "__main__":
    for fn in [test_plain, test_quote, test_card_title, test_nested_escaped, test_pure_noise, test_corrupt_selfheal, test_nickname_guard]:
        fn()
        print("PASS %s" % fn.__name__)
    print("ALL PASS")

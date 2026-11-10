import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · Cashcast" };

/** Short, both languages. The code backs it: bank data never leaves the browser; the only server routes relay PayPal sandbox calls. */
export default function Privacy() {
  return (
    <main className="shell prose">
      <a href="/" className="back">← Cashcast</a>
      <h1>Privacy</h1>
      <p>Your bank file is read inside your browser and is never uploaded; Cashcast has no server that receives it.</p>
      <p>What you confirm is saved only in this browser&apos;s local storage, and you can export it or delete it in Settings at any time.</p>
      <p>There are no accounts, cookies, analytics or tracking scripts, and account or card numbers in a file are dropped as it is read.</p>
      <p>The PayPal tab talks to PayPal&apos;s sandbox (test money only) through this site&apos;s server; your bank data is never sent there, payer emails are dropped, and nothing is logged beyond an error name.</p>
      <h1 lang="zh-CN">隐私</h1>
      <p lang="zh-CN">你的银行文件只在浏览器里读取，从不上传；Cashcast 没有接收它的服务器。</p>
      <p lang="zh-CN">你确认的内容只保存在这个浏览器的本地存储里，随时可以在设置里导出或删除。</p>
      <p lang="zh-CN">没有账户、Cookie、统计或追踪脚本；文件里的账号和卡号在读取时直接丢弃。</p>
      <p lang="zh-CN">PayPal 页通过本站服务器连接 PayPal 沙箱（只有测试资金）；银行数据从不发送过去，付款人邮箱会被丢弃，日志只记错误名称。</p>
      <p className="quiet">Cashcast is a cash-flow calculator, not financial, tax or legal advice. 现金流计算工具，不构成财务、税务或法律建议。</p>
    </main>
  );
}

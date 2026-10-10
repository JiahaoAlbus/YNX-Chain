# 扫码切换到新 Send 输入 — 2026-10-10

父源 `b83c128c1d0b97737e5f8a3dac283267725d92c2`。本批在原Desktop源码修复两处正常输入切换，未改Native App、共享协议、账户、密钥、金额、签名或UNKNOWN journal。

原二维码chooser替换只退休尚未返回的文件选择器，不能退休已经进入异步文件读取/解码的收款输入。原camera点击也不能退休尚未完成的图片或paste解析。迟到结果可填回收款人并清掉新金额。

新chooser点击递增原`paymentDraftRevision`、invalidate原`paymentRecipientUI`后停止旧camera；新camera点击同样退休旧输入，并替换旧chooser节点，然后进入原camera流程。显式切换不清除用户可见地址/金额，不签名、不转账。新合法二维码仍仅填收款人、清空金额、撤销旧review，要求原显式审阅和批准。

证据目录 `/tmp/ynx-wallet-scan-input-switch-20261010-Zms7e6`：

- 原renderer mounted反例：7项，1PASS/6FAIL；旧迟到输入实际覆盖新recipient。`original.log` SHA256 `8cfe255bdefa730ea61c76c96bc02b649ec9d3163b27b75df233b90e1d1eb20f`。
- 新批8项与相邻camera-entry/scan-ui组合：19PASS/0FAIL，无skip；`successor.log` SHA256 `b4303a1e31e1394099377f48ca19c2faba1ef8ffc4159a7392acad82eaf4f913`。
- 原renderer语法检查、git diff --check通过。

测试执行实际renderer输入组合片段及原SDK-free输入controller，以受控文件、decoder、camera和DOM端口验证；不加载Auth/SDK runtime，不证明真实相机权限、checksum生产者、实机转账、installed/public新版或业务授权。没有复跑旧77camera/148transfer-balance大批。完整任务未完成。

本次恢复发现旧`/private/tmp/ynx-wallet-owned-matching-suite-20261004-dWCPfk`构建composition已不在磁盘；旧source bundle、正式冻结报告和不可变发行包继续作为恢复输入，不能直接用当前旧共享SDK替换原相容图封包。

# Creator 刷新后鉴权拒绝诊断

基线：工作树3731507f88b93e2895cf8808760af2b69ac077f6，公开Creator29896f10c5e59fc17590dd3697d6e7af3d34a809、Video API48fe3824cc6a38ba944427776e48d076f27f54f5、Auth f2939095023391a39b3ab0ee1528288110d01059。浏览器 SDK b3e4b5269d665ee5c8e2542454191cfc6ff53ecb。

Wallet 专项真实 Android 安装版拒绝→Creator declined成功；之后批准、系统模拟指纹、回跳后Signed in并加载Studio；刷新仍Signed in但API返回 `unauthorized: Product Session v2 introspection rejected`。

## 只读发现

API `internal/video/central_gateway_auth_v2.go:84` 将Auth非200、request-id不一致或响应读取失败归为同一错误，UI文案本身无法区分原因。API/Auth06:13–06:19 UTC journald没有请求记录。随后对Auth现有持久化审计作只读字段投影，输出仅at/path/outcome/code/requestId，没有subject、session、proof、tokens或密钥。

审计证明：06:15:20.114 API introspect成功；06:15:20.542一次API introspect被 `ISSUED_IN_FUTURE` 拒绝。刷新06:15:47.728 SDK restore introspect成功；06:15:47.860及47.963两次API introspect均被同一时间错误拒绝。06:16:29.640正常撤销成功。详见 `refresh-auth-redacted-audit-20260906.json`。

在线Auth proof-v2.js第48行同时以此代码拒绝proof早于session.issuedAt或晚于服务器now的两种情况。SDK恢复证明与API证明均30秒有效，因此不能归因于不同有效期。Creator每次API调用及网络重试均生成freshproof；未发现证明复用。已核f293/b3均以lowS:false验证P256，排除两版高S兼容差异。

结论：实际根因类别已经缩小到签发时间校验；具体设备/服务器偏差大小应由Wallet owner只读测时确认。共享SDK/Auth校验由Wallet owner修复；本子任务不改共享源码、不扩大时间容忍、不用sleep或复用证明掩盖。没有再次发起公开批准、签名、内容写入或部署。

## Creator独立退出缺陷

Sign out正常撤销后设置snapshot=null，但renderAudit仍直接读取snapshot.revenue等字段，导致空值异常并中断界面清理。Creator-only修复将补齐空值处理、清除私有展示，并防止退出前的异步请求返回后重新展示旧账号数据；完成测试后单独冻结，待协调者审核发布。

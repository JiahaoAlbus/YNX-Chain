# 经原 verifier 确认的业务 effect 计数

状态：源码与针对性测试已验证，未部署/未四节点；Whole完整网关证明链及开户CLI正例尚未完成。

性能消费者在原 verifier 输出的 exact type/wire/hash/H/index、included/finalized、两次commit/light transition及DATA分类校验后，按原执行结果分类：成功单笔转账为1；已最终提交但执行失败为0；开户为0；Whole逐行核原有序成员及 canonical effect hash，仅admitted计业务，rejected无effect。partial不是整批成功。未知/缺行/错序/错误effect/hash/partial冒完整均拒绝。

报告增加 `consensusExecutionOutcome` 与 `finalizedBusinessHashes`。重复只读取得相同原effect身份，后续原测量汇总可以据此去重；本次没有新增或声称已完成持续TPS汇总器。验证到实际拒绝执行时，保留终态证明但明确错误退出，不当UNKNOWN重发，不计有效业务。

原public签名证明夹具的结果分类实测为成功单笔1、真实已提交的重复拒绝0、四成员partial Whole3，及五组篡改负例。这里的Whole测试是原core已验证结果的计数测试，没有用来证明网关支持Whole collector。共享transfer生产execute另实际通过原离线verifier，0POST。两个顶层race用时4.704s。

已仅消费canonical 74457f76d 对原 `cmd/ynx-consensus-proof-verify/transaction.go` 的initial类型单行，前blob一致，形成349e9d805；没有导入新fundedcore或main。开户CLI独立正例继续等待原fresh funded公共夹具及同源支持initial的Mac verifier，不能将旧或过期1h QA trust重标有效。

Whole原网关 `/txs/{ABCIhash}/pq-finality-proof` 当前仍lookup Member且按单笔ABCI Data=hash收集，不支持Whole批执行数据；已交原gateway owner沿既有route补齐，不自造第二网关/签名/信任。消费者尚未开放Whole在线proof选项，保留实际缺项。

CI40209829604与40210385574已通过此前修复后的ABCI组，后续失败在原integration检查仍硬编码state12/AppHashV12/app18，而该canonical base实际为state18/app20。已交Root对齐原integration/release owner；未删检查、改运行时回旧版本或伪造release升级。

[原始命令、SHA与范围](evidence/pq-verified-business-accounting-20261026.json)。下一步消费原fresh initial与Whole供货，同条件四节点阶段计时与1000有效业务TPS继续按Root窗口推进。

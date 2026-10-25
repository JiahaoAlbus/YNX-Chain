# 私有快照编码器：实际 worker 结果接收修复

CODE `f15f32153185ad8d8c8b2131b06186218dceb6fb`。实际四节点run40195409369/attempt1失败，SOURCE仍为原`c14aee1e21894407cb09aff19ff26786e22eddf8`，grant125625已消费，after未启动，没有重派。

首因是父进程在独立worker退出后调用 `load_result(_verifier_controller(),...)`：原裁剪 `SimpleNamespace` 未暴露新增 `PREPARED_JSON_ENCODINGS`。完整controller校验已绿并不足以覆盖这个实际接收入口；不能把该缺口当成机器压力、链吞吐瓶颈或业务失败，也不能补源码后改写本次失败结论。

通过实际 `_verifier_controller()` → `stream_verifier.load_result()` 复现两encoder均报相同AttributeError的RED，再最小增加这一项不可变依赖；49项协议/清理拒绝轻测通过，包含两encoder实际接收、错误选择不篡改原receipt、缺worker时post-fsync清理后仍不可qualified，以及first失败/UNKNOWN禁止after；source guard26项通过。没有改验签、nonce、完整状态、锁序、fsync、限额、2checker或双closure。新测试直接接原CI已有pair协议组，不另造业务资格。

本次原日志中before case38.329s、pair38.690s，qualified均false；post-fsync双launcher-only closure原帧已存在，完整slot/容量/四ELF/业务与耗时仍沿artifact12600061137恢复验证后再报告。原49,588,133字节归档与缺失区间缓存保留，60秒恢复期限不变；已完成区间不重复下载。普通修复CI继续，未来新SOURCE及exact READY另等Root新授权，不复用本次grant。

证据：[失败与最小修复索引](evidence/prepared-json-worker-bridge-fix-20261025.json)。

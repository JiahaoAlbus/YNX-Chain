# 原 CI 的 selector / 私有发布夹具修复及退出证据

状态：已修源码，针对性真实RED→GREEN，完整正常CI待验证；未部署、未新四节点压测，不代表1000有效TPS。

40208347215 已终态FAIL：新签名proof producer、原verifier消费者、控制器、static vet、StreamBFT通过，但ABCI组失败。两处首因已分别处理：

- own chain-core workflow 在原hardhat:build后漏 `npm run contracts:selectors`。`internal/chain/compiler.go`从原 `artifacts/ynx-selector-metadata.json`读取ethers keccak selector；缺该文件会产生空selector，多项初始化/合约/历史测试失败。补原命令，与resource-market原正常CI一致；不改合约/runtime或测试，不写替代selector。
- 原proof fixture的默认root直接用TempDir，未满足原publisher的0700父目录要求。本地两个顶层测试复现FAIL6.034s。仅消费Protocol ce7bca49c 对 `proof_host_source_test.go` 的helper差量，parent blob一致，形成f877c118c；让默认root创建显式0700子目录。原同组开户、transfer、typed-action发布与独立证明回归PASS7.068s。不放宽publisher，不整入fundedcore或main合流。

本地没有node_modules和编译artifacts，未另开安装/构建；Node脚本语法与workflow YAML通过。selector的完整artifact-backed执行由原正常CI完成，不能提前说整轮绿。

性能客户端现在记录原 verifier 是否真正启动、实际exit code及context中断标记。实际原程序拒绝篡改执行证明时保留非零退出与stdout证据；预先取消context时不启动子程序，不重发交易，不沿用此前的finality标记。真实原签名夹具及取消差量race PASS4.214s。

[失败原件、RED/GREEN与退出测试证据](evidence/pq-source-ci-selector-parent-repair-20261026.json)。下一步跟进修后完整CI，并继续真实隔离节点测量；Root未给新heavy窗口，本轮不启动公网/隔离四节点重压。

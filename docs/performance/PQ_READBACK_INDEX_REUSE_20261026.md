# 原读回 index 复用与阶段计时

已实现、微基准和针对性race通过，未部署/未四节点，不代表1000有效业务TPS或确认延迟。

原路径先完整strict JSON解码并校验Member/Whole身份和结果，随后为获得CometIndex又对完整响应json.Unmarshal一次；第二次解析位于分项validation计时外，只进入总observation计时。现在 `committedResponse` 将首次已校验的index与原admitted/rejected/height一并返回，不再扫描完整响应，全部读回解码/身份校验位于原validation分项内。不删mandatory index、wire/hash、fee、原ordered results校验，也不从proof反推观测坐标。

使用原canonical库生成最大合法N1024 Whole（wire297196B），单位RPC view响应521543B；生成签名不在计时循环。Apple M4、24GiB、GOMAXPROCS1/GOMEMLIMIT160MiB，同一对输入三组各3次比较：

| 每次完整读回校验 | 原二次index解析 | 复用已验证index |
|---|---:|---:|
| 中位耗时 | 3.769ms | 2.153ms |
| 分配字节 | 1,563,938 | 1,563,658 |
| 分配次数 | 2101 | 2093 |

局部校验CPU耗时约下降42.9%，没有明显分配字节收益。这是单位读回微基准，消息未执行/记账/最终确认，不能换算链上TPS或假装1024笔业务完成。四个针对性race覆盖最大Whole/缺index、Native原hash、零值开户、UNKNOWN恢复，PASS2.903s。

另仅消费canonical e64cbb78f两原验证脚本（两个前blob一致）→d8133c026。本地integration与release检查均通过：原published cb20源码仍state12/app18，当前runtime18/app20按当前实际源码独立校验；没有更改发布metadata、降runtime或删检查。完整CI仍须当前提交实际执行，不用本地两门冒整轮绿。

[原始样本、SHA与命令](evidence/pq-readback-index-reuse-20261026.json)。下一步消费fresh初始账户公共证明材料及原Whole collector，Root新窗口内做真实同条件四节点阶段测量。

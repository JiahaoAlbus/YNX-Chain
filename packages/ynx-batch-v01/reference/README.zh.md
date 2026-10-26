# YNX 算法 v0.1：双根批次签名参考包

**状态：研究候选及可运行参考原型。** 本包定义 YNX-BATCH/v0.1，由 ML-DSA-87、SLH-DSA-SHA2-256f、SHA3-512 和 SHA-512 组成。它没有建立新的数学困难问题，也没有证明全球新颖性、优于所有现有签名、生产安全或整链后量子安全。

本构造认证同一个获得授权的 owner 的完整消息组。一批消息共享两份基础签名；支持重建全批双树验证及提取单条消息的双路径验证。不能由区块生产者替其他账户签名，也不能将无共同授权的不同用户签名合并成一个 owner 的授权。

## 运行

参考环境为 Node.js v24.19.0、OpenSSL 3.5.7、Linux x64。使用内置 node:crypto，不需 npm 依赖。实际运行时必须存在 ml-dsa-87 和 slh-dsa-sha2-256f provider 支持。

在解压后的同一目录依次运行：

```bash
node ynx-batch-v01-prototype.cjs
node ynx-batch-v01-prefix-prototype.cjs
node ynx-batch-v01-codec.cjs
```

前两个文件是独立数学/性能实验；第三个是严格线格式 codec 与测试。它们不是生产 SDK。Codex 应将其中已验证的运算、边界和线格式整理成项目现有语言的模块，连接账户注册、交易解析和状态执行。测试密钥在运行时随机生成；测试网络 ID、owner 和 batchId 是合成值，不能作为生产配置。

## 1. 固定参数

| 参数 | v0.1 固定值 |
|---|---|
| 分支 A 签名 | ML-DSA-87，FIPS 204 pure 接口 |
| 分支 B 签名 | SLH-DSA-SHA2-256f，FIPS 205 pure 接口 |
| 两个标准签名接口的 ctx | 空字节串；协议域分离写在 message 参数里 |
| A 外层树哈希 | SHA3-512，输出 64 字节 |
| B 外层树哈希 | SHA-512，输出 64 字节 |
| 公钥长度 | A=2592 B；B=64 B |
| 签名长度 | A=4627 B；B=49856 B |
| N | 1,2,4,...,1024；不补齐 |
| 单条消息长度 | 0..1048576 B |
| 构建批次及 WholeWire 内原消息总长度 | 不超过 8388608 B；独立 MemberWire 无法证明其他不可见消息的总长度 |
| owner | 1..128 B 可打印 ASCII，按精确字节匹配可信登记 |
| purpose | 1..64 B 可打印 ASCII；链交易用途固定 TX-BATCH |
| chainId | 32 B 可信网络标识，从本地已确认链配置取得 |
| batchId | 16 B 公共批标识；生产签名器生成新鲜随机值 |
| CertificateWire | 不超过 65536 B |

两种基础参数都以 NIST Category 5 为目标；该事实不等于 YNX 组合获得 NIST 标准化、认证或可以叠加安全位数。消息和总批大小是本候选的资源上限，链仍可施加更严格且共识一致的交易/区块限制。

所有验证返回成功仅代表密码学认证成功。nonce、余额、手续费、过期、owner 权限和执行有效性另行检查。batchId 不是秘密，也不是防重放机制。

## 2. 唯一编码

所有输入是字节串。常量标签按 UTF-8 编码；本版本常量都是 ASCII。所有整数是恰好 4 字节的大端无符号整数。

```text
U32(n) = n 的 4 字节大端编码
F(x) = U32(byteLength(x)) || x
E(x1,...,xk) = U32(k) || F(x1) || ... || F(xk)
```

解码必须先校验总大小和各字段长度，再分配或遍历数据。每层严格检查字段数、固定标签、预定字段长度、整数长度、范围及尾随数据。不接受 JSON 作为被签名字节，不接受不明字段、自动大小写归一化或不同算法标识的协商降级。E() 是 U32(0)。

## 3. KeyGen 与上下文

分别调用两种标准 KeyGen，使用各自新鲜随机性，得到 `(pkA,skA)` 和 `(pkB,skB)`。不要将测试用固定种子或相同种子直接塞给两种算法。

```text
C = E(
  "YNX-BATCH/v0.1/CONTEXT",
  "ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512",
  chainId[32], owner, pkA[2592], pkB[64], batchId[16], purpose
)
```

C 固定为 8 个字段，不含树根，避免循环定义。owner 与完整双公钥必须来自可信的账户登记；将任意公钥写入 C 不会使它成为被冒称 owner 的公钥。

## 4. 双树与 BatchSign

签名器先授权并复制完整有序消息列表及全部元数据，冻结后计算以下内容。不能盲签外部服务提供的任意根。

令 H_A=SHA3-512，H_B=SHA-512，b 为字符 A 或 B：

```text
T_b[0][i] = H_b(E(
  "YNX-BATCH/v0.1/LEAF/" + b,
  C, U32(N), U32(i), M[i]
))

T_b[level][j] = H_b(E(
  "YNX-BATCH/v0.1/NODE/" + b,
  C, U32(N), U32(level), U32(j),
  T_b[level-1][2*j], T_b[level-1][2*j+1]
))
```

叶子层为 level=0；父层从 1 开始；节点 j 在每层从 0 编号。令 d=log2(N)，根 R_b=T_b[d][0]。N=1 时根就是唯一叶子，路径为空。

每个叶子直接使用完整的原消息 M[i]，不能先对所有消息做共同的 SHA-256 摘要再分别送给两条分支。

```text
D = E("YNX-BATCH/v0.1/DESCRIPTOR", C, U32(N), RA[64], RB[64])

sigmaA = ML-DSA-87.Sign(skA,
  E("YNX-BATCH/v0.1/CERT/A", D), ctx=empty)

sigmaB = SLH-DSA-SHA2-256f.Sign(skB,
  E("YNX-BATCH/v0.1/CERT/B", D), ctx=empty)

CertificateWire = E(D, sigmaA, sigmaB)
```

标准签名使用其正常随机化/hedged 模式。签名失败返回失败，不返回半成品认证。两份签名覆盖同一个冻结后的 D，D 含两根、两公钥、完整上下文和 N；两份签名均完成后才能返回已签批次。

返回证书、完整消息快照以及两棵公开树。树只是提取证明所需的公开辅助数据，不属于私钥。

## 5. AuthenticateCertificate

严格解析证书并检查：C 的 8 个字段、D 的 5 个字段和证书的 3 个字段；suite、标签、N、所有长度；网络、owner、purpose 和完整双公钥必须与调用方提供的可信身份及适用策略相同。

再按上一节定义的两个签名 message 执行 Verify_A 和 Verify_B。返回值必须是两者的逻辑 AND。

成功后可创建不可伪造的进程内句柄，私有保存 C、N、两个根及适用信任信息的不可变快照。网络请求不得直接创建“已认证”句柄；不缓存失败。缓存命中须核对完整证书及可信公钥/策略，不能仅凭 batchId 或未经再次比较完整字节的单一摘要决定授权。

密码学证书缓存不能永久缓存账户当前有效性。账户轮换、撤销、执行高度和 nonce 检查必须遵循当前 Chain 策略。

## 6. Extract 与逐笔验证

对每个分支，从叶到根输出路径：

```text
j = index
for level = 0..d-1:
  path_b[level] = T_b[level][j XOR 1]
  j = floor(j/2)

ProofWire = E(U32(index), E(pathA[0],...,pathA[d-1]),
                            E(pathB[0],...,pathB[d-1]))
```

index 必须在 [0,N)；两条路径必须恰好 d 个 64 B 节点。

逐条验证用已经认证的 C,N,RA,RB，对两个分支分别执行：

```text
x = Leaf_b(C,N,index,M)
j = index
for level = 1..d:
  up = floor(j/2)
  sibling = path_b[level-1]
  if j mod 2 == 0:
    x = Node_b(C,N,level,up,x,sibling)
  else:
    x = Node_b(C,N,level,up,sibling,x)
  j = up
accept branch iff x == R_b
```

两条分支必须验证同一个 M 和 index，两者都成功才接受。完整 VerifyOne = AuthenticateCertificate + VerifyMember。缓存证书只能省略重复证书验签，不能省略成员证明。

## 7. VerifyWholeBatch 与完整线格式

接收全部消息时：先认证证书，检查实际消息数等于 N、单条和总大小合法；按给定顺序重建两棵树，两个根均相等才成功。无需传输所有成员路径。

```text
WholeWire = E(
  "YNX-BATCH/v0.1/WHOLE",
  CertificateWire,
  E(M[0],...,M[N-1])
)

MemberWire = E(
  "YNX-BATCH/v0.1/MEMBER",
  CertificateWire,
  M,
  ProofWire
)
```

本版本单条独立网络包携带完整证书。仅传证书引用的跨包协议尚未定义；必须另行定义数据可用性、缺证书时取回规则、引用解析和完整字节核对后，才可上线此类压缩。进程内已经持有认证句柄时可直接调用 VerifyMember。

8 MiB 是构建器及 WholeWire 接收的资源限制，不是独立成员证明能够证明的隐藏批次属性。MemberWire 只能检查当前消息不超过1 MiB。若 Chain 要求逐笔入口也验证全批总大小，需已认证的完整批次登记或以后版本的大小承诺与证明；当前冻结格式不提供它。

## 8. 保持字节不变的前缀优化

```text
LeafPrefix_b = U32(5) || F(leafTag_b) || F(C) || F(U32(N))
LeafSuffix   = F(U32(index)) || F(M)
NodePrefix_b = U32(7) || F(nodeTag_b) || F(C) || F(U32(N))
NodeSuffix   = F(U32(level)) || F(U32(j)) || F(left) || F(right)
```

分别初始化两种哈希的叶前缀状态和节点前缀状态。每次复制尚未 final/digest 的哈希状态，再吸收对应后缀并完成哈希。这里复制的是哈希计算的完整中间状态；没有把 C 换成一个新摘要。5、7 是完整 E 的字段数。

参考 Node 实现使用 Hash.copy()。等价性要求原始 Enc 与前缀+后缀的每个字节一致，完整树节点和路径也一致。原型已验证 N=128 的全部 256 个叶输入、254 个内部节点输入、全部树节点、双根和 256 条路径。

## 9. 条件安全命题

范围：固定一个诚实签署者、独立标准生成的两个密钥、可信完整公钥登记、无歧义编码；攻击者可量子计算，并发出经典自适应批签名查询。

获胜事件为输出通过验证但从未被授权的 (D,index,M)。重复提交已经授权的消息、为同一消息换一份签名不属于这个抗伪造游戏；应用层必须单独防重放。

令 epsilon_b 是分支 b 标准签名在相应资源及签名查询次数下的量子 EUF-CMA 优势，beta_b 是其树在所有已签批次中的位置绑定攻击优势，则归约草图给出：

```text
Adv_YNX <= min(epsilon_A + beta_A, epsilon_B + beta_B)
```

对于任一分支：新 D 上的有效签名构成签名伪造；已签 D 上相同位置的新消息构成树绑定破坏。beta 必须涵盖多批次目标，不能直接把单承诺安全界当成全局界。多账户模型须计入相应多用户损失。

这是条件归约草图，尚非经外部审查的完整安全证明。两种哈希族不能被称作数学独立；不能相乘失败概率或相加安全位数。注册表、编码、运行环境和共同密钥托管是共同依赖。

此版本使用长期密钥，没有前向安全；两把私钥均泄漏时可新签描述符。它不提供消息保密性、业务正确性、冲突交易排除或共识最终性。

## 10. 精确尺寸与本轮实测

对于 owner="ynx-test-owner-001"、purpose="TX-BATCH"、N=128、每条消息1024 B：

| 项目 | 字节 |
|---|---:|
| C | 2836 |
| D | 3017 |
| CertificateWire | 57516 |
| ProofWire | 980 |
| WholeWire | 189140 |
| MemberWire | 59561 |
| 全批原消息合计 | 131072 |
| WholeWire 超出原消息的认证+编码开销 | 58068 |

全批证书单独均摊为 449.34375 B/消息；包括完整 WholeWire 的编码开销后均摊为 453.65625 B/消息。独立单条完整网络包为59561 B，内含1024 B消息。不能声称独立签名只有449 B。若 owner 长度为 a、purpose 长度为 p，则证书长度为57490+a+p；本示例 a=18,p=8。

N=2^d 时 ProofWire 长度为28+136*d B。性能实验仅实测 N=128；codec还以空消息批次对N=1和N=1024的真实签名、全批验证及末尾成员验证做了边界测试。严格解析器的54项拒绝测试通过。8MiB边界的构造仅验证语法接受，不代表替换后的消息仍通过旧证书的密码验证。

根代理复跑记录见 observed-results.json。本机样本每项1次预热、3次测量，未剔除慢样本：

- 原始批签创建128条消息：中位135.1502 ms，含快照、双树、双签名；排除KeyGen和消息准备。
- 同一进程前缀优化比较：完整128条验证，中位15.6467 -> 12.3393 ms。
- 同一进程前缀优化比较：已认证缓存下128条双路径，中位44.3683 -> 16.0925 ms。
- 上述成员计时排除证书认证、提取证明及每证书一次的前缀初始化；本次首次初始化0.9590 ms。全批优化计时包含前缀初始化及双证书验证。

测量存在明显波动，小样本不能提供稳定容量、尾延迟或整链TPS结论；没有计入凑批、传播、共识、状态I/O和最终确认。

## 11. Codex 接入任务

1. 首先核对真实仓库、当前分支和提交。不要将本文假定为对现有源码的完整审计。
2. 建立版本固定的 ynx/v01 模块：编码、KeyGen、BatchSign、证书认证、Extract、VerifyMember、VerifyWholeBatch、严格网络解码、前缀优化。异常一律显式失败。
3. 原始实现与优化实现保留差分校验，接入基础算法标准测试向量、跨实现验证和解析模糊测试。不要改变底层标准参数、拒绝采样或验证条件来提高速度。
4. 链上登记完整双公钥与授权策略。首次登记由现有有效账户授权并附新双密钥的持有证明，绑定网络、owner、用途和登记内容；轮换/撤销按协议有效高度生效。旧算法失守后不能依靠其单独证明首次迁移所有权。
5. 新增有明确域和版本的交易认证封装。将完整规范交易签名字节作为 M，而不是已有32 B tx hash。nonce、费用、动作数据等所有原来应签的语义必须完整覆盖。
6. 同一个 owner 的消息才进入同批；TX-BATCH 默认逐笔授权、可拆分执行，不自动提供整批原子性。每条消息继续检查当前权限、nonce、余额、费用和执行规则。
7. Whole 路径证书传一次、双树重建一次。为高吞吐授权账户压测N=128及更大合法批次；凑批等待上限是本地调度参数，需要与P95/P99一起评估。
8. 下一步可做有界公钥导入缓存、ML-DSA公开矩阵预计算、有界多核池和不同批次并行；保持结果索引与状态执行顺序一致。缓存不得跨过密钥撤销/策略有效期。
9. 账户地址、余额、nonce和历史数据可通过版本化迁移保留；新验证规则仅在已定义激活高度适用。Wallet增加双密钥备份/恢复、登记、批次确认和新封装；Social仅在共享钱包/链SDK处适配，签名升级不自动升级聊天加密。
10. 共识层签名必须单独设计。交易验证接入不能自动替代验证者投票、Commit、证据、轻客户端和远程签名器规则。未来共识消息通常尚未确定，不能假定能够预先批签多个未来高度。
11. 任一旧交易入口、Ethereum兼容路径、应用动作或恢复入口都不能绕过已升级账户的现行授权策略。已有 classic AND PQ 策略如需更改，必须单独版本化激活。
12. 本版本不证明普通多账户散单比单一ML-DSA或Ed25519更快。若真实负载没有同一签署者的批次，预期的签名摊销收益就不成立。整链吞吐必须以多节点、混合账户、已最终确认的用户交易重新测量。

## 12. 主要来源

- NIST FIPS 204： https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf
- NIST FIPS 205： https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.205.pdf
- Node.js v24.19.0 crypto / Hash.copy： https://nodejs.org/download/release/v24.19.0/docs/api/crypto.html
- OpenSSL 3.5 SLH-DSA： https://docs.openssl.org/3.5/man7/EVP_PKEY-SLH-DSA/
- RFC 9162： https://www.rfc-editor.org/rfc/rfc9162.txt

Merkle树根签名与成员证明已有先例。这个具体候选的命名和实现不构成对全球原创性或行业领先地位的证明。本包的目标是让Codex有明确、可复查、可差分验证的实现起点。

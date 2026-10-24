# 原始业务报告解码时释放重复字节持有

从失败原run40068452896按原ZIP central/local边界、64KiB精确206、CRC、SHA及receipt.resultSHA256恢复前侧原7189495B客户端报告，SHA3cbd538f66b56576d8b360874548732eb8405d4a1da49f6d3653d8af64590405。仅恢复一个公开成员用于诊断，没有下载整个ZIP、提交交易或新增网络资格，原failed pair继续保持失败。

原严格JSON解析同时持有原始bytes、解码文本和完整对象。本地同一报告的测量显示解析峰值约25.7MB。当前差量将native stream报告读取收敛到read_native_stream_report：先按原文件界限完整捕获并哈希，解码文本后释放raw字节，再执行原重复键与非有限常量拒绝的strict_json。保留Python json.loads原编码检测和surrogate解码语义，UTF8/BOM/UTF16/UTF32反例已核对。原case资格读回继续强制合法原resultSHA，缺失/错误SHA均在解码前拒绝；run回执SHA绑定实际解析的同一份捕获字节。legacy模式保持原路径。

同一原报告交替3组：原解析峰值25702653/25701837/25701821B，新18512549/18512533/18512509B，中位峰值下降约27.97%，约减少7.19MB重复持有。所有完整解析对象canonical SHA均42ec69dd070cdde022b9afe748127da9fb30c0a11bd9b51139b6ca39a617047d。解析后的存活对象大小基本相同，减少的是瞬时重复持有，不是删除业务字段。测量带tracemalloc，约82–88ms不用于速度收益结论；本地Python分配峰值也不是Linux进程RSS。

22项pair/报告测试和89项报告/资源测试通过。weakref确认进入严格对象解码前raw已释放；错误哈希、缺失SHA、重复key、NaN、尾随内容、非法编码、symlink和超过16MiB均失败。全部原source/ELF/host/cleanup/UNKNOWN停止规则保留，无预算或GOGC变化，也没有生产GC调用。适用测试沿原chain-core执行入口自动运行。

在途run40070727578使用冻结源码19f30ec47；本次报告解码差量位于它之后。当前只有局部验证，网络RSS修复和持续1000有效final/s×600秒仍待实测。[原始测量与源码SHA](evidence/native-report-decode-lifetime-local-20261024.json)保留精确输入、每组峰值及全部输出SHA。

```sh
python3 -B -m unittest discover -s scripts/loadtest -p test_native_stream_pair.py
python3 -B -m unittest discover -s scripts/loadtest -p test_supply_linux_window.py
```

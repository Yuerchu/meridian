# LiteRT-LM 0.18 接入验证记录

实施与验收：2026-10-20，收尾复核：2026-10-21。代码位于 `feat/litert-018-metadata`；应用与 core 子模块使用独立分支。本文记录本轮判断和可复现实验，不把演示数据或模拟后端当作硬件实测。

## 行为与来源

- 运行库锁定 0.18.0 / C ABI 0.2.0，归档和提取后的原生库都按 `src-tauri/crates/litert-lm/runtime-manifest.json` 的 SHA-256 验证。
- Windows 三个 DLL 以及许可文件由准备脚本提供；GPU 编译器依赖从已验证的目录预加载，不靠工作目录偶然命中。
- 后端是供应商级 `auto/cpu/gpu/npu`。自动仅遵循运行库解析出的模型优先级，原生初始化失败不悄悄重试 CPU。
- ModelInfo 来自公开 C API；模型名称、精确架构与参数量没有可靠 getter，不从文件名/大小猜测。文件名只作别名。
- 模型允许的后端不等于当前驱动/硬件可用；缺少约束时上游会推导 CPU+GPU、CPU 优先。界面明确说明这一点。
- 元数据为只读事实，不自动写入用户模型档案或分配最大的上下文。用户必须配置运行上下文和输出预算，输出预算实际传入原生 optional args。
- 模型能力与当前文本适配器取交集，不能通过能力覆盖开启适配器没有实现的图像输入或采样参数。
- 未改历史消息、模型 ID 或价格；迁移只回填新后端列并清理本地供应商的静态模型列表缓存。
- 任意路径检查仅限本机；远程只可按已保存的 provider ID 读取信息，不能新建本地供应商或设置、清空主机后端。

## 自动检查结果

| 检查 | 结果 |
| --- | --- |
| 固定运行库与共享下载安全测试 | 通过；覆盖暖缓存离线、旧同名库、同长度坏字节、缺 DLL、许可损坏、归档越界/重复/路径穿越、哈希与目标路径 |
| LiteRT Rust 封装 | 18 个测试通过，包含真实 Windows DLL 的 0.18 符号加载与原生错误读取；没有将模拟函数表当成 ABI 实测 |
| core 全工作区 | core 单元测试 2360 通过、4 个既有忽略项；trybuild 1、daemon 25、Windows sandbox 19、sandbox types 5 通过 |
| core 外部集成探针 | 另有 12 个既有 ignored 用例未执行，涉及真实登录、付费请求或 Docker；未使用 `--ignored` |
| Tauri 命令与远程权限 | 233 个测试通过 |
| 两个 Rust 工作区 | rustfmt 检查、clippy `--workspace --all-targets -- -D warnings` 通过 |
| 前端全量 | 179 个文件、1905 个测试通过，使用 `--maxWorkers=4` |
| 发布前端 | build、typecheck、发布包 demo 剔除检查通过 |
| lint 与格式 | 通过；eslint 有 37 个既有 React Fast Refresh 警告，不计为零警告 |
| 契约与生成物 | `lint:rules`、`responses:check`、`contracts:check`、`schema:check`、`catalog:check`、`txgraph:check`、`blockon:check`、`android-cfg:check` 通过 |
| 原生分发完整性 | `pnpm litert:check` 通过，运行库为 0.18.0 |
| Windows 浏览器 | 全套 81 个测试通过 |
| Linux 浏览器 | 固定 Playwright 镜像内全套 81 个测试通过 |
| 关键修复变异 | 11 项全部完成原代码绿 → 变异断言红 → 恢复绿；每轮确认源码 SHA-256 已还原 |

测试过程中的失败没有通过放宽断言或重拍无关图片掩盖：新增 IPC 的旧命令数断言已修正；侧栏用例首次出现 5 秒超时，定向及限并发全量复测通过；Windows 视觉首次拍到计划审查页懒加载的空帧，定向和全量复测通过，未更新其旧基线。Rust 测试与 clippy 并行时曾争用 Tauri 资源 DLL，改为串行复核后通过。

构建仍报告已有大 chunk 提示；普通 Rust 构建报告缺少未构建的 IME 打包产物，依赖 `proc-macro-error2` 有 future-incompatibility 提示。均未为此修改无关代码、放宽 clippy 或声称没有警告。

## 视觉检查

新增的两种场景分别检查模型信息上半部和能力/采样下半部，各有亮/暗及宽/窄窗口。Windows 与 Linux 各 8 张，共 16 张新增基线已逐张审阅；既有图片未改。

初次审阅发现窄屏的长采样值将左侧标签挤成竖排，已用既有 `SettingsRow stacked` 解决，并增加标签宽度断言。宽屏后端行和文件别名的长说明已显式纵向排列，后端控件增加右边界断言；没有靠隐藏文本或改小字体掩盖。

初次基线覆盖和 Linux 容器执行被权限策略拒绝，随后用户分别明确授权：仅重拍本轮 8 张 Windows 新图、在本机隔离容器生成 Linux 新图、读取模型并执行小预算探针。Windows 新图在重拍前备份于忽略的独立缓存目录。

未复制 Windows 图充当 Linux 图；Linux 使用 `mcr.microsoft.com/playwright:v1.63.0-noble`，与项目 Playwright 版本一致。执行前确认守护进程属于本机，且只读源挂载与工作树 package.json 的 SHA-256 一致。容器内安装依赖，只导出新增场景，不改 Docker 配置或清理其他容器。

浏览器交互覆盖新增、检查、保存、返回重开、选择并保存 GPU，宽/窄、亮/暗均执行。它使用 DEV 演示后端，不能当作真实模型推理或 Tauri 持久化重启验收。

## 防复发门禁与变异证据

原有缺口是“存在 GPU 枚举”没有约束“保存的 GPU 最终到了原生参数”，固定列表也没有文件来源断言。此次同时增加数据库、工厂/共享 wire、FFI 参数、列表来源、错误传播、缓存键及远程边界测试。

以下每项都先跑原代码，再只退回关键修复，要求测试因断言失败变红，最后恢复并重新变绿；编译失败不算有效证据。临时变异脚本和详细输出位于忽略的缓存中，结论在此持久记录。

| 变异 | 已验证会变红的门禁 |
| --- | --- |
| provider 入口重新固定 CPU | `a_saved_gpu_selection_reaches_the_actual_provider_factory` |
| 缓存比较忽略后端 | `cache_key_includes_backend_file_context_and_runtime` |
| 放开不受模型允许的后端 | `automatic_selection_obeys_model_order_and_explicit_selection_is_checked` |
| GPU 初始化失败后重试 CPU | `native_error_is_copied_before_cleanup_and_never_retried_on_cpu` |
| 恢复固定 Gemma 型号 | `local_models_are_file_aliases_not_a_hardcoded_catalog` |
| 吞掉流内错误并返回部分成功 | `error_events_and_error_items_cannot_become_partial_success` |
| Rust 加载器不校验字节哈希 | `same_sized_unpinned_bytes_are_rejected_before_dll_loading` |
| JS 打包检查不校验字节哈希 | `fetch-litert-runtime.test.mjs` 的 same-sized 用例 |
| 远程更新允许后端写入/清空 | `remote_cannot_set_or_clear_hardware_or_create_a_local_provider` |
| 任意路径检查从 local 变为远程可调用 | `the_local_only_set_is_what_we_think_it_is` |
| 去掉采样行的窄屏堆叠 | `e2e/local-model.spec.ts` 的 narrow/light 真实布局断言 |

## 实机模型与数据安全

模型目录初次访问被策略拒绝，未绕过；在用户随后明确授权后才读取真实的 `gemma-4-12B-it-gpu.litertlm`。

实际元数据：文本 LLM，文本后端列表只有 `gpu`；采样为 top-p、temperature 1、top-k 64、top-p 约 0.95；上下文上界、最低运行库版本、视觉/Embedding 信息未提供，思考/工具/推测解码没有声明支持。`is_dynamic_context=false` 与未知上界不能直接宣传为已知的固定窗口，界面保留未知。

原生探针结果：

- `gpu / context=1024 / output_budget=32`：退出 0，生成文本 3 个字符；未输出提示或回答正文。这证明显式 gpu 后端可以初始化并生成，不等于性能基准或最快设备选择。
- 同一文件显式 `cpu`：退出 1，错误 `model does not allow the requested cpu backend`，在创建引擎前拒绝；这是预期的负向控制，不是 CPU 正向推理通过。
- 2026-10-21 补跑同预算的真实 `auto` 探针被权限策略拒绝，未换工具绕过。auto 优先级与后端传参有自动测试，但没有将其写成该文件的 auto 实机生成结果。
- 当前授权目录仅有这一个 GPU-only 文件，未自动下载 CPU 模型；没有宣称 CPU 模型正向生成或 NPU 实机通过。
- 不触碰日用数据库、模型权重和模型目录；推理缓存只写独立临时目录并清理。

`src-tauri/crates/litert-lm/examples/probe.rs` 是后续受控验收入口：

- 两个参数时仅加载已验证的运行库并读取指定模型元数据，不创建引擎。
- 显式追加后端、上下文和输出预算才进行推理；预算不可缺省。
- 推理缓存只写本次新建的临时目录，退出后清理；不写模型目录。
- 控制台只报告元数据、后端和生成字符数，不输出提示或回答正文。

仅检查：

```bash
cargo run --manifest-path src-tauri/crates/Cargo.toml -p litert-lm --example probe --target-dir src-tauri/target -- src-tauri/resources/litert-lm.dll "<模型绝对路径>"
```

获准后的 GPU 小预算探针：

```bash
cargo run --manifest-path src-tauri/crates/Cargo.toml -p litert-lm --example probe --target-dir src-tauri/target -- src-tauri/resources/litert-lm.dll "<模型绝对路径>" gpu 1024 32
```

## 机制说明

1. 旧 `from_model_path` 在供应商创建时固定传入 `Backend::Cpu`，与 GPU-only 文件的后端约束冲突；不是 GPU 已跑起来后退回 CPU。
2. 新实现让数据库里的选择经共享 `ResolvedProvider → wire → create_provider` 传递，先按元数据校验，再把实际 `cpu/gpu/npu` 字符串传给 C API，失败不换设备。
3. 引擎缓存比较文件检查标识、各模态后端、上下文和运行库；否则切换 GPU 或替换同路径文件仍可能复用旧引擎。
4. 原生错误是线程局部状态，清理 FFI 也可能覆盖它；必须在同线程清理前复制，流式与辅助非流式入口都向上传播。

## 未覆盖的验收与提交边界

- 未进行真实 Tauri 窗口下“设置保存 → 退出应用 → 重启 → 推理”的完整端到端验收；目前是数据库/命令测试、浏览器保存重开与真实原生 GPU 推理的分层证据。
- Android 只执行 cfg 门禁，未执行 Android target 原生编译或设备推理；Linux 容器只验证前端，不代表 Linux 原生推理通过。
- CPU 正向生成、NPU 实机、自动选择的真实生成与安装包安装验收未完成；不把这些未测项写成通过。
- 元数据仍不等于驱动/显存/硬件可用性；没有对应厂商环境时不能保证 NPU 可用。名称、精确架构、参数量与整包量化继续显示未提供。
- 旧本地模型若没有配置运行上下文和输出预算，升级后需要显式补齐；不继续使用伪造的 8192/4096 限制。

普通工作树门禁会扫描当前实现；暂存区门禁读取父仓 pinned core commit。提交时必须先在 core 提交、推送，再更新应用子模块指针，不能拿旧指针上的检查冒充新 core 的交付验证。提交与 PR 创建另按用户明确授权执行。

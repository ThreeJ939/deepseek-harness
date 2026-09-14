# Agent Note: 按可信变更文件策略路由评审

Status: implemented

[English](2026-09-08-trusted-changed-file-review-routing.md) | 中文

## 问题

GitHub 原生 CODEOWNERS 行为会在匹配路径变更时请求评审者。它无法应用本仓库对「可评审的实现或文档文件」与「仅测试证据」的区分。原生 CODEOWNERS 文件还会让 GitHub——而不是可检查的仓库程序——负责请求决策。

评审路由需要可观测的变更文件输入、显式 owner 规则、完整的测试排除，以及对方叉拉取请求仍保持安全的可写工作流。

## 决策

仓库在 [`.github/review-ownership/CODEOWNERS`](../../../../.github/review-ownership/CODEOWNERS) 保留一份与 CODEOWNERS 兼容的映射，放在 GitHub 原生 CODEOWNERS 位置之外。该映射只接受带一或两名个人 GitHub 用户的显式绝对目录模式。它拒绝通配符、隐藏目录模式、团队、超过两名 owner、重复模式与重复 owner。后出现的匹配模式替换先出现的匹配。

策略测试统计匹配所有权规则的目录中非测试已跟踪行数。若 `@turtle1999` 拥有超过该合格已拥有代码库的三分之一，映射会被拒绝。

[`request-review` 工作流](../../../../.github/workflows/request-review.yml) 在 opened、synchronized、reopened、ready-for-review 与 converted-to-draft 拉取请求的 `pull_request_target` 事件上运行。其可写作业检出默认分支，并只执行默认分支上的扫描器与所有权映射。它不检出拉取请求代码，也不读取仓库密钥。

扫描器在决策前拉取每一条变更文件记录。若拉取请求报告超过 GitHub 的 3,000 文件 API 上限，或分页返回不完整列表，则失败。它规范化仓库路径，分别评估重命名的新旧路径，并在记录文件名到日志前转义它们。

扫描器在 owner 匹配前排除仅测试路径。排除路径包括名为 `test`、`tests`、`__tests__`、`__snapshots__`、`benches` 或 `stress-tests` 的目录；顶层 `benchmarks` 与 `snapshots` 树；`packages/test-support`；`scripts/fixtures` 与 `scripts/snapshots`；以 `.bench.<ext>`、`.corpus.<ext>`、`.e2e.<ext>`、`.perf.<ext>`、`.snapshot.<ext>`、`.spec.<ext>`、`.stress.<ext>` 或 `.test.<ext>` 结尾的文件名；以及 Python 的 `test_*.py`、`*_test.py` 或 `*_tests.py` 文件。像 `vitest*.config.ts` 与门禁实现这类测试基础设施仍可评审，因为它们改变仓库证据如何产生。[纯注释路由决策](2026-09-08-comment-only-review-routing.zh.md) 拥有额外的文档与注释排除。

工作流在任何评审请求变更之前打印变更代码路径、每个排除类别、每文件 owner 匹配与变更 LOC、聚合 owner 相关性、因已有批准而从新请求中省略的 owner、当前个人请求、计划取消后的可用计数槽位，以及最终评审者动作。对非 draft 拉取请求，它拉取完整按时间排序的评审列表，并把每位 owner 未撤销的 `APPROVED` 与 `CHANGES_REQUESTED` 评审收敛为最近一次决定性状态；`COMMENTED` 与 `PENDING` 评审不改变该状态。它从匹配的个人 owner 中移除拉取请求作者、持有有效批准的 owner，以及仍被请求的用户。有效批准在后续 synchronize 事件后仍然足够，而之后的 changes-requested 评审会再次使该 owner 符合条件。评审列表操作在达到 3,000 条或遇到无效记录时于变更前失败。

工作流除 `@turtle1999` 外最多保留一个当前个人评审请求。现有的 `@turtle1999` 请求不占用该槽位，但每次工作流运行最多新增一名评审者。已有非 turtle 请求则没有槽位，因此工作流不添加任何人，包括 `@turtle1999`。现有个人请求即使不匹配所有权映射也占用槽位。owner 的相关性是每条可评审变更文件记录（其当前或先前路径匹配该 owner）的 GitHub 报告新增与删除之和。每条记录对每个 owner 计一次，包括重命名的两条路径匹配同一 owner 时。当可用槽位无法覆盖剩余 owner 时，更高变更 LOC 优先选出候选人；登录名顺序打破平分。

当存在当前评审请求时，工作流在变更前读取完整评审请求时间线。仅当最新匹配的 `review_requested` 事件将 `github-actions[bot]` 标识为 `review_requester` 时，当前评审者才视为由工作流发起；没有可归属事件的请求予以保留。非 draft 运行会取消不再匹配当前候选人的工作流发起评审者，以及超出计数上限的多余工作流发起非 turtle 评审者；当前相关性顺序决定保留哪位匹配的工作流评审者。计划取消在工作流选择新评审者之前释放容量。draft 运行取消每一个当前工作流发起的请求。由人发起的请求保持不变。带有无效出处的可归属事件，以及超过 3,000 事件的时间线，在变更前失败。

## 验证

[扫描器测试](../../../../.github/review-ownership/request-review.test.mjs) 覆盖已接受所有权语法、被拒语法、每个排除类别、生产名称负例对照、重命名、最后匹配行为、未匹配文件、变更 LOC 聚合与排序、完整分页、文件与评审上限、批准状态收敛、已批准 owner 抑制与下一 owner 选择、变更前日志顺序、作者与现有评审者过滤、非 draft 调和、draft 取消出处，以及 API 失败。[工作流测试](../../../../scripts/ci-workflow.spec.ts) 固定事件集、最小权限、可信默认分支检出、不引用拉取请求 head 与密钥，以及已执行命令。门禁图把两套套件纳入静态 CI 与 `check-all`。

## 曾考虑的替代方案

**使用原生 CODEOWNERS。** 原生路由无法忽略仅测试变更，也没有在请求评审者之前由仓库持有的决策日志。

**在 `pull_request` 下运行并检出拉取请求 head。** 来自分叉的工作流拿不到可写 token，而把写权限 token 交给不可信 head 上的代码不安全。

**在 `pull_request_target` 下执行拉取请求自己的扫描器或 owner 映射。** 这让不可信拉取请求可以选择自己的可写行为或 owner。

**按登录名顺序选择有上限的候选人。** 登录名顺序稳定，但忽略每位 owner 目录下可评审代码变更了多少。变更 LOC 使有限请求跟随拉取请求最强的所有权相关性，同时在平局时保留登录名顺序。

**取消每一个不再匹配的评审者。** 人可能因所有权映射之外的原因请求评审者。只有归属到工作流身份的请求才可安全地自动调和。

**把空的当前请求当作仍需评审的 owner。** 评审者提交评审后 GitHub 会移除挂起请求。再次请求已有有效批准的 owner 不会增加所有权覆盖，并在后续 synchronize 事件后制造重复通知。

**从 patch 或语言解析器推断任意语义源码变更。** GitHub 可能省略或截断 patch，且仓库跨越多种语言。扫描器不试图证明两个程序行为相同。之后的 [纯注释路由决策](2026-09-08-comment-only-review-routing.zh.md) 仅在变更行数证明 GitHub 提供了完整 patch 时，才增加一次窄词法比较。

## 后果

评审者变更可从可信策略、工作流日志中打印的文件分类，以及拉取请求时间线中的评审请求出处复现。被排除的变更不请求 owner；规则与变更文件更新会在下次运行时移除过时的工作流发起请求；draft 拉取请求不保留工作流发起的请求。所有权变更仅在合并后生效，因此更改策略的拉取请求不能把自己的不可信策略应用到自身。

工作流每次运行最多请求一名评审者，在该 owner 持有有效批准期间不重复请求，除 `@turtle1999` 外最多保留一名当前个人评审者，并优先选择其匹配可评审文件携带更多变更 LOC 的 owner。现有的 `@turtle1999` 请求使计数槽位仍可用；现有非 turtle 请求阻止一切额外请求。共享所有权让每位 owner 获得相同的文件级相关性，而不会对同一 owner 把一个重命名文件计两次。`GITHUB_TOKEN` 生成的评审请求事件可能不会启动依赖递归触发事件的其他工作流；那些工作流不得把本请求当作唯一触发源。

任何不匹配显式排除的变更，在已拥有目录下仍保持合格。未匹配路径记入日志且不请求任何人。超过文件、评审或时间线 API 上限的拉取请求在不施加部分评审者变更的情况下失败。

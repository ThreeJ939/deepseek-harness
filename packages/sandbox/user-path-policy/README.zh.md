# @deepseek-ai/dsh-user-path-policy

English | [中文](README.md)

多租户 `tools/pre-execute` 策略。当执行会话 header 带有 `ownerUserId` 时，工具参数中的绝对路径必须落在 `$DSH_HOME/workspaces/<ownerUserId>/` 下。无 owner 的会话不受本插件约束（单用户部署）。

通过 [`dsh-multi-user`](../../bundle/multi-user/README.zh.md) 挂载。测试与其它路径门可用导出的 `isPathInside`、`collectAbsolutePaths`。

## 配置

- `dshHome` — 可选，覆盖用于解析每用户工作区根的 harness home。

## 模型体验

不单独贡献 prompt；拒绝时走常规 tool-result 路径。

不发布不变式伴生入口，因为本插件只贡献一个 `tools/pre-execute` waterfall 监听器，其效果通过拒绝结果观测，而非注册表之间的持久归属关系。

## 已知限制与延后工作

- **仅绝对路径** — 相对参数不在此改写或重根。
- **字符串形态路径** — 非字符串编码中的路径不会被扫描。

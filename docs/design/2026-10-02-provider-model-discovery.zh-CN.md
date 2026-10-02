# Web Shell 配置向导中的服务商模型发现

[English](2026-10-02-provider-model-discovery.md) | [简体中文](2026-10-02-provider-model-discovery.zh-CN.md)

**状态：** 已在 `feat/provider-model-discovery` 上实现；已通过单元测试，E2E 测试计划见
`.qwen/e2e-tests/2026-10-02-provider-model-discovery.md`。

## 问题陈述

Web Shell 和桌面应用中的“Connect a Provider”向导要求以逗号分隔的自由文本输入模型 ID，即使该服务商的
模型目录可以用已输入的密钥列出。用户必须到别处查找 ID，并且可能保存密钥无法使用的模型。

OpenRouter 的情况更严重：其预设推荐 `z-ai/glm-4.5-air:free` 和 `openai/gpt-oss-120b:free`，这两个模型已
不在 OpenRouter 目录中；而且密钥可能受服务商和 guardrail 设置限制，因此对某个密钥而言，大多数公开模型
可能都不可用。

## 现状

- 终端 `/auth` 流程已经为设置了 `supportsModelDiscovery` 的服务商（Alibaba Coding Plan 和 Token Plan）
  发现模型：`packages/cli/src/ui/auth/ProviderSetupSteps.tsx` 中的 `DiscoveringModelIdsStep` 调用
  `discoverProviderModels`（`packages/core/src/providers/model-discovery.ts`），后者读取
  `GET <baseUrl>/models`。
- Web Shell 向导（`packages/web-shell/client/components/messages/AuthMessage.tsx`）对任何服务商都没有
  模型发现。守护进程目录 `GET /workspace/auth/providers` 不会告诉客户端哪些服务商支持发现，也没有可以执行
  发现的守护进程路由。
- OpenRouter 的公开 `GET /api/v1/models` 返回约 465 个模型（约 763 KB，接近 1 MB 的发现上限）。
  `GET /api/v1/models/user` 只返回经服务商和 guardrail 过滤后该密钥可用的模型，响应结构相同。

## 目标

- 对所有设置了 `supportsModelDiscovery` 的服务商，在 Web Shell 向导的模型步骤中显示已输入密钥可用的
  模型，支持搜索和多选。
- 使用 OpenRouter 按密钥过滤的目录，为其启用模型发现。
- 保留手动输入，并在列出失败时始终回退到手动输入。

## 范围边界

- 不为未选择启用的服务商新增发现；自定义服务商仍为手动输入。
- 不改变服务商的安装或持久化方式。
- 不新增 capability 标签：路由缺失或失败时，客户端回退到手动输入。

## 方案

### Core

- `ProviderConfig.modelListPath`（可选，默认 `/models`）指定 base URL 下的目录路径；
  `discoverProviderModels` 接受该参数。
- 对没有静态预设规格的模型，发现逻辑会把服务端返回的正整数 `context_length` 映射为
  `contextWindowSize`。
- OpenRouter 预设：`supportsModelDiscovery: true`、`modelListPath: '/models/user'`，并改用仍然存在的
  免费预设模型（`qwen/qwen3.8-27b:free`、`nvidia/nemotron-3-super-120b-a12b:free`）。
- 终端 `/auth` 流程透传 `modelListPath`。

### 守护进程

- 对选择启用的服务商，服务商描述符包含 `supportsModelDiscovery: true`。
- 新路由 `POST /workspace/auth/provider/models`，请求 `{ providerId, baseUrl?, apiKey }`，响应
  `{ v: 1, models: ServeAuthProviderModel[] | null }`。其访问控制与安装路由相同
  （`mutate({ strict: true })`）。

### SDK

- `DaemonAuthProviderDescriptor.supportsModelDiscovery`、`DaemonAuthProviderModelsRequest`、
  `DaemonAuthProviderModelsResult` 以及 `DaemonClient.listAuthProviderModels`。

### Web Shell

- 工作区动作 `listAuthProviderModels`。
- 在模型步骤中，如果服务商支持发现且已输入密钥，向导会按服务商、base URL 和密钥各加载一次列表。界面显示
  模型数量、搜索框，以及每个模型一个复选框（已知时附带上下文窗口）。勾选或取消勾选会编辑现有的逗号列表，
  该列表仍是提交 ID 的唯一来源。
- 列表到达时，如果逗号列表仍是未改动的预设默认值，则移除该密钥无法使用的默认值。用户输入的 ID 永不移除。
- 列出失败时，向导显示简短提示，手动输入框照常可用。

## 设计决策与理由

| 决策                                               | 理由                                                        |
| -------------------------------------------------- | ----------------------------------------------------------- |
| 发现在守护进程中执行，而非浏览器                   | 服务商端点不允许浏览器 CORS，且守护进程本就负责服务商请求。 |
| `baseUrl` 必须等于该服务商的某个预设 URL           | 该路由会转发 API 密钥；限制主机可杜绝开放代理或 SSRF 用途。 |
| 列出失败时返回 `200 { models: null }`              | 与终端流程一致：列出失败时静默回退到手动输入。              |
| OpenRouter 使用 `/models/user`，不回退到 `/models` | 公开目录会提供密钥无法使用的模型；手动输入是更安全的回退。  |
| 逗号输入框仍是唯一事实来源                         | 手动 ID、校验、确认和安装逻辑都保持不变。                   |

## 约束与风险

- API 密钥从浏览器传到本地守护进程，与现有安装流程相同。该路由从不记录或回显密钥。
- 大型目录：发现沿用现有的 1 MB 和 5 秒限制；`/models/user` 的结果很小。
- 每个模型渲染一个复选框，对按密钥过滤的列表没有问题。对于返回数百个模型的服务商，可用搜索框缩小列表。

## 受影响的文件

- Core：`packages/core/src/providers/types.ts`、`model-discovery.ts`、`presets/openrouter.ts` 及测试。
- CLI：`packages/cli/src/ui/auth/ProviderSetupSteps.tsx`；守护进程
  `packages/cli/src/serve/types.ts`、`server/auth-provider-helpers.ts`、`routes/workspace-auth.ts`、
  `server.test.ts`。
- SDK：`packages/sdk-typescript/src/daemon/types.ts`、`index.ts`、`DaemonClient.ts`。
- Web Shell：`client/components/messages/AuthMessage.tsx`、`AuthMessage.module.css`、
  `AuthMessage.dom.test.tsx`、`client/daemon/workspace/actions.ts`、`types.ts`、
  `client/daemon/index.ts`、`client/daemon-react-sdk.ts`、`client/i18n.tsx`。

## 验证计划与验收标准

- 单元测试：目录路径和 `context_length` 映射；OpenRouter 预设标志；路由通过预设端点列出模型、以 `null`
  报告失败、在不调用发现的情况下拒绝缺失字段、不支持的服务商和外部 base URL，且从不回显密钥；Web Shell
  列出、过滤、切换、移除不可用的预设、保存所选模型，并在失败时回退。
- E2E：见测试计划。验收条件：桌面向导显示 OpenRouter 按密钥过滤的模型，保存后安装的 ID 与所选完全一致，
  无效密钥时回退到手动输入。

## 待定问题

- 守护进程 REST 参考文档是否应记录服务商配置路由（`GET /workspace/auth/providers`、
  `POST /workspace/auth/provider` 以及新路由）？目前这些路由都没有文档。

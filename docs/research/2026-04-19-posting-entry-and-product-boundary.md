---
title: 发布入口与产品边界调研
status: done
updated_at: 2026-04-19
related_docs:
  - vision.md
  - docs/goals/2026-04-19-future-direction.md
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
---

# 发布入口与产品边界调研

## Research Question

当前仓库是否应该增加“发布竞赛/招标/需求”的入口，以及这个入口应当属于哪种产品边界。

## Scope

- 讨论政府/公司/个人三类发布方
- 讨论“官方机会提交”与“个人住宅需求发布”的差异
- 不展开具体实现方案和页面设计

## Current Local Context

- 仓库主定位不是通用竞赛目录，而是面向持证建筑师和事务所的 `procurement-first intelligence surface`
- 官方事实、证据链、规范化字段和来源优先级是核心约束
- 网站目前的主入口是 `discover`，不是供给侧发布后台

相关本地文档：

- `docs/AI_CONSTRAINTS.md`
- `docs/ARCHITECTURE.md`
- `AGENTS.md`

## Source Summary

### Repo facts

- `docs/AI_CONSTRAINTS.md` 明确产品不是 generic competition gallery，而是 procurement-first intelligence surface。
- `docs/ARCHITECTURE.md` 明确 `apps/web` 的 public surface 是 discover/detail/search，operator surface 是 dashboard/ops/review flows。

### External facts

- EU 官方规则说明：中高价值公共合同通常必须在 TED 等官方渠道发布，平台不能替代法定公告链路。  
  Source: <https://europa.eu/youreurope/business/selling-in-eu/public-contracts/public-tendering-rules/index_en.htm>
- TED 官方说明强调其核心能力是 notices 浏览、搜索、提醒、下载和 API，属于上游官方发布与检索基础设施。  
  Source: <https://ted.europa.eu/en/help/about-ted>

## Options Compared

| Option | Description | Fit with repo | Main risk |
| --- | --- | --- | --- |
| A | 任何人都能直接发布机会/需求 | 低 | 破坏证据链与 procurement-first 定位 |
| B | 官方机会提交入口，人工审核后入库 | 高 | 审核成本上升 |
| C | 个人住宅改造/建造需求发布 | 很低 | 变成 homeowner marketplace |
| D | 仅做线索提交，不直接上架 | 高 | 覆盖率提升速度受人工审核限制 |

## Findings

1. “发布入口”不是一个单一需求，而是至少两条完全不同的业务线。

- `官方机会提交` 仍属于情报系统的上游采集问题。
- `个人住宅需求发布` 则属于交易市场或 lead marketplace。

2. 对当前仓库最兼容的是 `官方机会提交` 或 `线索提交`，而不是 `自由发帖`。

- 仓库规则要求每条 canonical record 保留 `official_url` 和 `source_url`
- 规则还要求缺失信息保持空值或 `unknown`，不能为了上线速度而脑补事实
- 这决定了“提交后即公开”的路径与现有约束冲突

3. “个人住宅需求发布”会把产品从 intelligence tool 推向 marketplace。

这不是加一个表单的问题，而是要新增：

- 身份验证
- 反垃圾与反欺诈
- 预算真实性判断
- 地域匹配
- 报价与沟通机制
- 平台责任与争议处理

4. 如果把 homeowner 需求和官方采购机会混在同一主发现面里，用户心智会混乱。

- 当前产品的核心价值是高信噪比、可验证、偏公共采购与专业机会
- homeowner 需求流会引入更高噪音和更低标准化程度

## Recommendation

推荐先走 `B + D`，不走 `A + C`。

更具体地说：

- 不做“任何人都能直接发布”的公开入口
- 可以做“提交官方机会/提交线索”入口
- 所有外部提交必须进入审核队列
- 审核通过后才进入 canonical store 和 discover surface

推荐的第一阶段输入要求：

- `official_url`
- `source_url`
- `authority_name`
- `official_notice_id` 或等价标识
- `deadline_at`
- 提交人机构邮箱或可验证身份

## Impact on This Repo

如果后续要做该能力，应落在以下边界内：

- Web 端增加 locale-aware 的提交入口，但不直接写公开数据
- 提交流程产物进入 `ops` 审核队列
- 规范化与事实校验继续放在 `apps/worker` 和 `packages/storage`
- 公开站点仍然只消费审核后的 normalized records

## Risks and Open Questions

- 是否有足够人力做审核，不让提交入口变成垃圾线索池
- 审核 SLA 是否会影响提交方体验
- 是否要区分政府机构、采购代理、协会、媒体线索提供者
- 是否需要单独的“未核验线索”内部数据表，而不是直接写主机会表

## Next Step

如果要继续推进，建议下一步写一份最小 PRD：

- 名称建议：`官方机会提交 / Official Opportunity Submission`
- 范围：线索提交、审核状态、入库规则、拒绝原因、最小字段
- 明确不包含 homeowner marketplace 能力

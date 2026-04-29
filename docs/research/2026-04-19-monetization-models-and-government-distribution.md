---
title: 商业化路径与政府增量分发调研
status: done
updated_at: 2026-04-19
related_docs:
  - vision.md
  - docs/goals/2026-04-19-future-direction.md
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
---

# 商业化路径与政府增量分发调研

## Research Question

这个产品更适合赚哪种钱：事务所订阅费、homeowner lead 佣金，还是政府/机构的增量曝光费用。

## Scope

- 对比 B2B 订阅与 B2C/B2B2C 撮合
- 评估政府是否可能为额外曝光付费
- 不展开完整定价模型

## Current Local Context

- 本仓库的产品锚点是面向专业事务所的采购机会 intelligence，而不是 homeowner marketplace
- 当前路线天然更接近“提高获客/投标效率”，而不是“撮合住宅项目交易”

## Source Summary

### Architecture market demand

- AIA/Deltek 在 `2026-01-21` 公布：`2025` 年底 ABI 为 `48.5`，低于 `50` 代表账单仍在收缩，建筑事务所的业务环境偏弱。  
  Source: <https://www.aia.org/about-aia/press/2025-ends-continued-weak-business-conditions-architecture-firms-aiadeltek-abi-finds>

### Homeowner marketplace / residential business software

- Houzz Pro 官方公开价显示 `30` 天试用后 `Pro` 方案为 `$249/mo`，并强调 project management、CRM、payment、marketing 一体化。  
  Source: <https://www.houzz.com/houzz-pro/pricing>
- Houzz 对 remodeler 的定位是“all-in-one software + access to our growing network of hiring homeowners”。  
  Source: <https://www.houzz.com/for-pros/software-remodeler>
- Thumbtack 官方对 pros 的表述是：只有当客户联系你时，你才付费。  
  Source: <https://www.thumbtack.com/pro/jobs>
- ANGI 的对外口径是帮助 homeowners 完成项目、帮助 pros 获客和增长。  
  Source: <https://ir.angi.com/node/11556/pdf>

### Government/public-sector distribution context

- EU 官方规则说明：落入 EU 规则的公共合同通常必须先走官方公告链路，尤其是 TED。  
  Source: <https://europa.eu/youreurope/business/selling-in-eu/public-contracts/public-tendering-rules/index_en.htm>
- 英国 GCS 官方指南说明，政府确实会采购 communication support 和 media buying，但通常通过 framework、agency 或集中采购安排来完成。  
  Source: <https://www.communications.gov.uk/guidance/marketing/delivering-government-campaigns/buying-communication-support/>

## Options Compared

| Model | Buyer | Value proposition | Difficulty | Fit |
| --- | --- | --- | --- | --- |
| 事务所订阅 | Architects / studios | 更快发现、更准筛选、更少无效投标 | 中 | 高 |
| 线索佣金 | Homeowners + pros | 帮 pros 接单 | 高 | 低 |
| 政府增强分发服务 | Authorities / agencies | 在法定公告之后补充分发给专业受众 | 中 | 中高 |

## Findings

1. 对当前产品最容易跑通的收入是 `B2B 订阅费`。

原因：

- 用户已经被教育过为行业软件与情报服务付费
- 价值可以直接绑定到“节省筛选时间、减少无效投标、提升 hit rate”
- 与当前仓库的 procurement-first 定位一致

2. `homeowner marketplace` 的市场可能更大，但更难做。

原因：

- 需要双边网络
- 对 lead 质量极度敏感
- 要处理地理密度、报价、履约、争议、安全与信任问题
- 这是一整条不同的公司能力曲线

3. 政府/机构“买广告”的说法不够准确，更合适的产品叫 `官方机会增强分发服务`。

更贴近真实采购语言的卖点是：

- 官方公告已发布后的专业受众触达
- 增加合格参与者覆盖
- 可审计的曝光、点击、brief 下载、线索触达数据

4. 公共部门可以为额外传播买单，但前提不是“广告位好看”，而是“受众足够专业且可证明”。

因此卖点不应是：

- 普通展示广告

更应是：

- verified official notice amplification
- targeted outreach to licensed architects and design firms
- buyer-profile syndication
- post-publication analytics

## Recommendation

收入路径优先级建议如下：

1. `事务所订阅`
2. `政府/机构增强分发服务`
3. `官方线索提交后的审核服务`
4. `homeowner marketplace`

原因：

- 第 1 条最贴近当前产品
- 第 2 条要求先建立专业受众资产，但与现有方向一致
- 第 4 条虽然想象空间大，但会把公司带进完全不同的运营模型

## Impact on This Repo

如果沿当前路径继续，产品更适合补齐：

- saved searches
- alerts
- bid/no-bid scoring
- team workflow
- AI qualification summary
- verified official distribution package

而不是补 homeowner 侧的：

- profile/reviews
- quote flows
- payments
- messaging/disputes

## Risks and Open Questions

- 事务所是否会优先把预算给“机会情报”而非 CRM/PM 工具
- 政府/代理方是否愿意为 niche audience 分发单独采购
- 政府分发服务是否需要更强的品牌背书和合规材料
- 是否先从协会、专业媒体、主办方而不是纯政府客户切入

## Next Step

建议下一步写一份 monetization brief，至少明确：

- 事务所订阅的第一个收费包卖什么
- 官方增强分发服务卖什么
- 哪些能力三个月内可交付

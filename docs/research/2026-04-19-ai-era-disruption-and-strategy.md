---
title: AI 时代机会判断与方向收敛
status: done
updated_at: 2026-04-19
related_docs:
  - vision.md
  - docs/goals/2026-04-19-future-direction.md
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
---

# AI 时代机会判断与方向收敛

## Research Question

AI 时代是否足以“轻易颠覆” competitionline 这类公司，以及当前仓库最值得押注的方向是什么。

## Scope

- 评估 AI 对垂直机会平台的真实冲击层
- 输出可执行的方向收敛结论
- 不进入详细 implementation plan

## Current Local Context

- 当前仓库已经具备数据、worker、storage、discover、ops 的基础骨架
- 产品主轴清晰：官方来源、规范化机会、采购优先
- 当前最大不确定性不在技术可行性，而在“战略切口是否足够尖锐”

## Source Summary

- competitionline 公开强调大量来源的人工筛选、会员服务、邮件流和团队协作式招标服务。  
  Sources:  
  <https://www.competitionline.com/de/ueber-uns>  
  <https://www.competitionline.com/de/news/buero/schneller-zu-relevanten-ausschreibungen-14164.html>  
  <https://www.competitionline.com/de/news/markt/ausschreibungen-im-newsletter-was-sich-aendert-und-was-das-fuer-sie-bedeutet-16530.html>
- Deltek GovWin IQ 的公开价值主张集中在 early intelligence、short-bid response mitigation、analyst support。  
  Source: <https://www.deltek.com/en/products/business-development/govwin/state-local-government>
- ConstructConnect 强调 real-time updates、daily researcher refresh、pipeline tracking、team collaboration。  
  Source: <https://projects.constructconnect.com/about-project-intelligence>

## Borrowability Rubric

| Field | Assessment |
| --- | --- |
| automation_stage | `L1-L2`。现有成熟平台多数仍是“数据+编辑/分析+workflow”的组合，不是真正 autonomous system |
| grounding_mode | 以官方数据、研究团队、产品化搜索与手工校验为主 |
| human_intervention_boundary | 数据收集、分类、纠错、市场内容和客户支持仍大量依赖人 |
| object_model_maturity | 高。notice、agency、project、status、documents、watchlists 等对象清晰 |
| auditability | 中高。公共采购与专业服务场景天然要求来源、更新时间和可解释性 |

## Findings

1. “AI 会轻易颠覆这类公司”这个判断只说对了一半。

AI 最先压缩的是这些环节：

- 文本抽取
- 多语种理解
- 规范化标签
- 摘要生成
- 个性化推荐
- 邮件/brief 生成

AI 不会自动消失的壁垒仍包括：

- 稳定来源覆盖
- 长期行业品牌
- 专业用户分发能力
- 数据责任与纠错机制
- 深度嵌入客户工作流

2. 真正的机会不是“做一个带 AI 的目录站”，而是“用 AI 重构它背后高人工成本的工作流”。

如果只是：

- 加 AI 搜索
- 加自动摘要
- 重新做前端

那么很容易变成低壁垒包装层。

如果能做到：

- 跨国官方源统一
- 建筑师专属 qualification reasoning
- bid/no-bid scoring
- 团队级判断、标记、协作

那才是 AI 真正创造结构性优势的地方。

## Directions Compared

### Direction 1: AI 包装版目录站

- Goal: 用 AI 搜索、摘要和新界面重做老平台
- Value: 上线快，视觉差异明显
- Cost: 低
- Key Risks: 容易同质化，护城河弱
- Recommendation Level: `no`

### Direction 2: 跨国官方采购情报雷达

- Goal: 把 TED、national procurement hubs、authority pages 汇成建筑师专用雷达
- Value: 贴近当前仓库，AI 可以降低数据加工成本
- Cost: 中
- Key Risks: 数据质量与持续维护
- Recommendation Level: `strong_yes`

### Direction 3: AI bid/no-bid 决策助手

- Goal: 从“告诉你有什么”升级为“告诉你值不值得投”
- Value: 更接近付费核心价值
- Cost: 中
- Key Risks: 必须强约束、强证据链，不能幻觉化
- Recommendation Level: `strong_yes`

### Direction 4: 团队级 pursuit workspace

- Goal: 支持标记、分派、组队、决策和跟进
- Value: 提高留存和嵌入度
- Cost: 中高
- Key Risks: 做太重会分散注意力
- Recommendation Level: `yes`

### Direction 5: 官方增强分发服务

- Goal: 给主办方/机构提供专业受众触达和增量曝光
- Value: 直接收入来源
- Cost: 中
- Key Risks: 要先有专业流量资产
- Recommendation Level: `conditional`

### Direction 6: homeowner marketplace

- Goal: 打通个人住宅需求与设计/建造服务
- Value: 市场更大
- Cost: 高
- Key Risks: 业务模型完全不同
- Recommendation Level: `no`

## Recommendation

最值得押注的前三个方向：

1. `跨国官方采购情报雷达`
2. `AI bid/no-bid 决策助手`
3. `团队级 pursuit workspace`

它们胜出的原因：

- 与当前仓库结构一致
- AI 能带来真实效率优势
- 能直接绑定事务所的时间成本与胜率提升
- 不要求先建立 homeowner 双边市场

## Impact on This Repo

这意味着后续产品演进要从这几个切口发力：

- 让 `worker` 和 `storage` 的结构化质量成为核心资产
- 让 `discover` 不只是列表，而是决策入口
- 让 `dashboard` 和 `ops` 从展示页逐步变成判断与协同系统

## Risks and Open Questions

- 如何在保证证据链的前提下使用 LLM 做资格判断
- 是否要引入人工复核阈值与 confidence gating
- 多语种 procurement taxonomy 的长期维护成本有多高
- 当前窄市场是否足以支撑初始商业化

## Next Step

建议下一步从这两份文档中选一条继续：

- goal doc: 定义 `AI-first procurement intelligence for architects`
- structure doc: 定义 bid/no-bid、watchlist、team workflow 的 capability map

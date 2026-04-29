---
title: 竞品格局与产品定位调研
status: done
updated_at: 2026-04-19
related_docs:
  - vision.md
  - docs/goals/2026-04-19-future-direction.md
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
---

# 竞品格局与产品定位调研

## Research Question

哪些外部产品真正接近当前仓库的方向，哪些只是表面相似但底层逻辑不同。

## Scope

- 对比 homeowner marketplace、政府合同 intelligence、建筑竞赛/招标平台
- 输出定位结论，不做逐页拆解

## Current Local Context

- 当前仓库定位是“建筑事务所的公共机会雷达”
- 核心价值在于官方来源、证据链、资格判断和 procurement-first 排序

## Source Summary

### Residential marketplace / business OS

- Houzz Pro：面向 remodelers 和 designers 的 all-in-one business software，公开价 `Pro` 方案 `$249/mo`。  
  Sources:  
  <https://www.houzz.com/houzz-pro/pricing>  
  <https://www.houzz.com/for-pros/software-remodeler>
- Thumbtack：pros 只有在客户联系时才付费。  
  Source: <https://www.thumbtack.com/pro/jobs>
- ANGI：帮助 homeowners 找到并雇佣 pros，同时帮助 pros 增长。  
  Source: <https://ir.angi.com/node/11556/pdf>

### Government / construction intelligence

- Deltek GovWin IQ：强调 early insights、short-bid response mitigation、decision-maker access、win more contracts。  
  Sources:  
  <https://www.deltek.com/en/products/business-development/govwin/state-local-government>  
  <https://www.deltek.com/en/government-contracting/govwin/websites>
- ConstructConnect Project Intelligence：强调 public/private projects、daily updates、pipeline tracking、bid management。  
  Sources:  
  <https://www.constructconnect.com/products/project-intelligence>  
  <https://projects.constructconnect.com/about-project-intelligence>

### Architecture-specific opportunity platforms

- competitionline：官方宣称每年发布 `41,000+` 手工筛选招标，来源 `50,000+`。  
  Source: <https://www.competitionline.com/de/ueber-uns>
- Europaconcorsi：官方首页将自己定位为面向建筑师和工程师的 `servizio bandi di progettazione`。  
  Source: <https://europaconcorsi.com/>
- TED：是欧盟公共采购 notices 的官方基础设施，属于上游事实源而非垂直情报产品。  
  Source: <https://ted.europa.eu/en/help/about-ted>

## Options Compared

| Product | Core buyer | Core job-to-be-done | Similarity to this repo |
| --- | --- | --- | --- |
| Houzz Pro | Remodelers/design pros | 跑住宅生意 | 低 |
| Thumbtack / ANGI | Home service pros | 获取 homeowner leads | 低 |
| GovWin IQ | Gov contractors | 提前发现、塑造并拿下公共合同 | 中高 |
| ConstructConnect | Contractors/subs/suppliers | 跟踪建设项目并投标 | 中高 |
| competitionline | Architects/engineers | 跟踪竞赛、招标、结果和排名 | 高 |
| Europaconcorsi | Architects/engineers | 获取设计招标与竞赛信息 | 高 |
| TED | All public procurement users | 官方 notices 检索与再利用 | 上游数据基础设施 |

## Findings

1. Houzz/Thumbtack/ANGI 和当前仓库的表面相似点只有“都连接项目与专业服务方”。

但底层完全不同：

- 它们主要连接 homeowner 与 pros
- 依赖 profile、reviews、quote、lead pricing
- 信任来自用户评价与成交机制

当前仓库则依赖：

- official notice
- source trace
- normalization
- qualification fit
- implementation path

2. GovWin 和 ConstructConnect 在商业逻辑上更接近当前仓库。

相似点：

- 卖给专业团队而不是 homeowner
- 核心价值是更早、更快、更准地发现机会
- 强调 pre-RFP/pre-bid intelligence、pipeline tracking 和 team workflow

不同点：

- GovWin 更广泛，面向整体政府合同市场
- ConstructConnect 更偏商业建造项目
- 当前仓库更窄，聚焦建筑师/设计团队与公共设计机会

3. competitionline 和 Europaconcorsi 是最接近的直接竞品参考。

原因：

- 受众是建筑师/工程师
- 内容是竞赛、招标、结果、机会
- 平台既有信息服务，也有行业媒体属性

4. 当前仓库真正的差异化机会，不在于“做一个更现代的目录站”，而在于：

- 跨国官方采购源统一
- procurement-first 筛选
- 建筑师资格与后续委托路径判断
- bilingual / cross-border evidence handling
- AI-supported bid/no-bid workflow

## Recommendation

定位上应明确对标：

- `直接产品参考`: competitionline, Europaconcorsi
- `商业模式参考`: GovWin IQ, ConstructConnect
- `明确不跟`: Houzz Pro, Thumbtack, ANGI

建议的对外定位句式可以往以下方向收敛：

`AI-first procurement intelligence for licensed architects and design teams screening public opportunities with a credible path to built work.`

## Impact on This Repo

这意味着后续产品能力优先级应偏向：

- 筛选与搜索质量
- official-source trace
- qualification scoring
- alerts and watchlists
- team collaboration around pursuit decisions

而不是：

- homeowner intake
- review system
- quoting marketplace

## Risks and Open Questions

- competitionline 的德国本地网络和品牌是否会显著提高切换门槛
- Europaconcorsi 在意大利与南欧语境下的供给密度是否难以复制
- 当前仓库是做“更窄更深”的 intelligence，还是做“更广更浅”的目录

## Next Step

建议下一步基于本调研做一个四象限定位图，明确：

- 当前仓库的左邻右舍是谁
- 哪个差异点值得成为主页首屏叙事

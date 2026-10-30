# arch-competition-ops 全面代码审计（2026-10-21）

仓库：https://github.com/Enmani/arch-competition-ops（公开仓库，26 次提交，354 个跟踪文件，约 4.4 万行源码）
本地位置：`C:\Users\di\Projects\arch-competition-ops`
审计方式：只读。四个并行审读（Python worker、TypeScript 存储与认证、Next.js 前端与图片管线、仓库卫生与运维）加主控抽查复现。高影响结论都经过主控二次核实。

## 一、实测验证结果

| 检查项 | 结果 |
|---|---|
| `uv run arch-competition-ops doctor` / `verify` | 全部 OK，14 个启用源 |
| `uv run pytest` | **7 失败 / 115 通过**（写死日期已过期，见 W6） |
| `uv run ruff check apps/worker` | 5 个错误（均在 tests） |
| `npm run test:storage` | 34 通过 |
| `npx tsx --test apps/web/src/lib/*.test.ts` | 126 通过，但没有任何 npm 脚本会跑它 |
| `npm run lint:web` | 通过 |
| `tsc --noEmit`（apps/web） | 18 个错误，全部在测试文件 |
| `npm run build:web` | 通过，39 秒 |
| 国家包 | 11 个启用，3 个仅脚手架，40 个空壳 |
| PowerShell 5.1 下运行 `uv run` 并设 `$ErrorActionPreference=Stop` | **被 uv 弃用警告中断**（复现 O1） |
| 运行 `build:web` 后 git 状态 | `opportunity-preview-revision.ts` 被改写变脏 |

验证清单本身有缺口：`AGENTS.md` 规定的健康检查不含 pytest 和 web lib 测试，所以上面这些失败在"全绿"下一直存在。

## 二、跨层的根本问题（按优先级）

### P1. 产品真值规则在抽取层被系统性违反
`AGENTS.md` 规则 1–4 要求"没有证据就留空，不得发明费用、组织者、官方链接"。实际代码：
- `extractors/common.py:301-302` 所有记录一律写 `registration_fee_eur=0.0, submission_fee_eur=0.0`，Web 端本地版本 `packages/storage/src/index.ts:884` 据此显示 "No participation fee"；Cloudflare 版本 `cloudflare.ts:870` 显示 "Fee pending"。同一条数据两种说法。
- `extractors/common.py:268` `organizer=source.name`：组织者字段存的是平台名（如 "ANAC BDNCP"），Web 端当作采购人展示。
- `extractors/common.py:270` `official_url=official_url or source_url`：没有官方链接时用来源链接冒充。
- `extraction_confidence=0.78` 是常量；`review_queue.py:11` 阈值 0.8。**每条记录都进低置信度复核队列**。
- 7 个 collector 和 4 个 extractor 写死 `implementationPath`；TED 缺失时写 `"Unknown authority"` 并给评分加分。
- `normalizers/competition.py:177-227` 用关键词出现与否推断 `licensed_architect_required`、`local_partner_required`，输入是正文摘要而非资格条款。

### P2. 记录身份与覆盖策略会丢数据
- 主键 `build_competition_key(title, organizer, deadline)`（`storage/database.py:439`、`normalizers/keys.py`）。organizer 是平台名，所以同平台同标题的不同采购人会得到同一个 id，`ON CONFLICT(id) DO UPDATE` 静默覆盖。截止日更正后生成新 id，旧行成孤儿。`official_notice_id` 有索引却不参与身份。
- `database.py:537` `status = excluded.status`，`official_url`、`evidence_note` 整列覆盖：重新入库会把 shortlisted/verified/discarded/archived 重置为 discovered，人工冲突记录丢失。
- `database.py:1007` 复核决定每次刷新回到 pending，而刷新在每次 ingest 和 verify 后执行，运营决定一轮即失效。
- `delete_competitions`（`database.py:705-738`）硬删除时连带删除用户关注记录与审核历史。
- GGZY `ggzy.py:379` 把 "页面生成时间" 作为截止日候选（权重 -20），`_choose_best_deadline_candidate` 不要求分数大于 0。已复现：无截止信息的正文返回发布日作为截止日，7 天后被当过期丢弃。

### P3. 认证系统没有接到授权，整个系统只有一个租户
- `apps/web/src/lib/auth.ts` 只被 `app/[locale]/layout.tsx:20` 用来显示邮箱。没有 `middleware.ts`。
- `workspace.ts` 的工作区键来自全局环境变量 `ARCH_WORKSPACE_KEY`，默认 `"local_practice"`，所有访问者共用。写入只受 `ARCH_ENABLE_WORKSPACE_WRITES` 全局开关控制，开启即对所有匿名访问者开放增删。
- `GET /api/ops/review` 无任何开关，公开返回 `payload_json`、`evidence_note`、诊断信息；`/[locale]/ops` 页面公开展示来源健康和 `last_error`。
- `PATCH /api/ops/review/[queueId]` 的 `actorLabel` 来自请求体，审计记录可伪造。
- 密码哈希：Node 端 hex 编码且把 hex 字符串本身当盐，Workers 端 base64url 并解码成字节，格式头都是 `scrypt$`，实际互不兼容；scrypt 参数 N=16384,r=8,p=1 低于 OWASP 下限。用户不存在时直接返回不计算哈希（可计时枚举）。登录/注册无限速，登出用 GET，无 CSRF 保护。
- 违反核心原则 4（多租户、最小权限）。

### P4. 两套存储运行时复制粘贴约 2065 行，已经出现行为分叉
- `packages/storage/src/index.ts`(1628) + `watchlists.ts`(727) + `ops-review.ts`(477) + `auth.ts`(437) 与 `cloudflare.ts`(2961) 逐行比对，机会查询区段 90% 相同，运维审核 80%，关注列表 66%。
- 已分叉：费用文案（P1）、程序类型别名（本地读 `config/procedure-type-registry.json`，D1 版硬编码在 `cloudflare.ts:224-261`）、密码哈希编码（P3）。
- `server-storage.ts:58-83` 手写 `LocalStorageModule` 是函数签名的第三份副本，用 `as` 强转，编译器无法检查。
- `cloudflare-auth.test.ts:17-48` 已证明 30 行就能把 better-sqlite3 包成 `D1DatabaseLike`，说明 `cloudflare.ts` 与运行时无关，可以作为唯一实现。
- 表结构有 6 个来源（Python `SCHEMA_SQL`、D1 migrations、`auth.ts` DDL、`cloudflare.ts` DDL、运行时回退列、测试里 11 份手写 CREATE TABLE），目前一致，但没有任何检查守住。

### P5. 发现页每请求全表扫描，图片请求放大查询
- `getStoredDiscoverSurfaceData` / `getD1DiscoverSurfaceData` 不传 `sqlLimit`，`SELECT *` 读全部可见行后在 JS 里 `slice`，每行做 3 次分类、5–7 次 `JSON.parse`。每次查询前还有 `COUNT(*)` 和 2 次 `PRAGMA table_info`。D1 按读行计费。
- 一页 36 张卡片各请求一次 `/api/opportunities/[slug]/image`，每个请求再做 COUNT + 2 PRAGMA + SELECT，一次页面浏览约 144 次 D1 查询。
- `dashboard/page.tsx:23-37` 对最多 24 条关注记录逐条查库（N+1）。
- `competitions` 表只有 3 个索引，国家、截止日、采集时间、金额都没有；`COALESCE`、`LOWER(title) LIKE '%…%'` 写法本身用不上索引。
- `discover.ts:182-183` 的 `limit`/`offset` 无范围校验，默认 500；`publishedWithinDays=1e9` 会抛 RangeError 变 500。
- Node 端每次调用新开 SQLite 连接再关闭，一次发现页渲染约 7 次；Python 与 Node 共写同一个文件，没有 WAL 和 `busy_timeout`，`SQLITE_BUSY` 被 29 处 `catch {}` 吞掉后显示"没有机会"。

### P6. 卫星预览管线放在请求路径上，且产物不可复现
- `apps/web/src/lib/opportunity-satellite-preview.ts`（4667 行，仓库最大文件）在一次请求里做：多语言地址抽取、百度/高德/Nominatim/Photon 地理编码、抓 3 个 HTML + 最多 3 个 12MB PDF 并调本机 `pdftotext`、拉 9–16 块 ArcGIS 瓦片、用 sharp 合成。sharp、`child_process`、本地 fs 在 workerd 上不可用；子请求数轻易超过 Workers 限制。
- `image/route.ts:96-131` 对约 9 个候选文件名逐个向自己的域名发 HTTP 请求探测静态资源（`global_fetch_strictly_public` 下走公网），而 wrangler 已绑定 `ASSETS` 却未使用。
- Nominatim 节流 `waitForNominatimWindow` 只比时间戳，36 张卡片并发时无效；429/5xx 被当作"查不到"持久化到 `geocode-cache.json`，一次限流让该地址永久显示占位图。
- 无限流、无在途去重；对找不到坐标的记录每次请求都重新抓网页和 PDF，一个外部请求放大为对第三方政府网站的多次抓取。
- ArcGIS 影像无署名，瓦片请求伪装 Chrome UA（合规风险）。
- 预览图只存在原作者本机的 `artifacts/`（gitignore），`predev/prebuild/prestart` 钩子拷贝到 `public/`（也 gitignore）；新机器部署得到空集合。同步脚本把旧图重命名成当前 revision，让 revision 失去意义。
- `opportunity-preview-revision.ts` 被钩子改写又被 git 跟踪；无 `.gitattributes`，CRLF/LF 不同机器算出的 hash 不同（实测三个值互不相同），图片 URL 跨机器不一致。
- 这个模块同时被 Python `card_previews.py` 动态拼 Node 脚本调用，`operations.py:413-425` 用正则从 TS 源码里解析 revision。

### P7. D1 同步会清空生产用户数据
- `scripts/export-d1-data.mjs:16-24,58-62` 对 7 张表 `DELETE FROM` 后全量 INSERT，包括 `workspace_saved_searches`、`workspace_watchlist_entries`、`ops_review_decisions`。每按 runbook 同步一次，生产端的用户写入全部被本地快照覆盖。runbook 没有导入前备份与回滚步骤。
- 导出脚本读 `ARCH_COMPETITION_DB_PATH`，worker 读 `ARCH_COMPETITION_OPS_DB`，两边可能指向不同库。
- D1 端多语句写入（`writeD1OpsReviewDecision`、`createD1SavedSearch`）不是原子的，保存搜索无唯一约束，并发会重复。

### P8. 定时抓取在当前环境必然失败且无人知晓（已复现）
- `scripts/run-ingest-batch.ps1:10` 设 `$ErrorActionPreference="Stop"`，`:92,103` 用 `& $uvPath ... 2>&1 | Tee-Object`，计划任务用 `powershell.exe` 5.1。PS 5.1 下原生命令写 stderr 即为终止错误；uv 0.12 对 `[tool.uv] dev-dependencies` 每次打印弃用警告。第一步 `cleanup-expired-competitions` 即中止，异常不进日志。
- 任务用 `-LogonType Interactive` 注册，用户未登录不运行；无 `ExecutionTimeLimit`；三个批次无锁文件可重叠写 SQLite；日志无轮转。
- `run-ingest-batch.ps1:73-90` 靠 state 文件判断每日清理是否已跑，但 CLI 不写该文件，所以每批都清理一次。

### P9. 没有 CI，公开仓库 gitignore 漏密钥文件
- 无 `.github/`、pre-commit、husky、dependabot、`.gitattributes`；根 `package.json` 无 `test`/`typecheck` 脚本，全仓库无 `tsc --noEmit`。
- `.gitignore` 只有 `.env`，实测未忽略 `.env.local`、`.dev.vars`（wrangler 本地密钥）、`*.sqlite-wal/-shm`、`data/inbox/*`、`data/eval/*`。runbook 最后一步是 `git add .`。历史扫描未发现真实密钥，但 account_id、D1 database_id、个人邮箱已公开。
- 根目录混入 11 张 PNG（2.03 MB，占仓库 85%）、playwright 快照、已完成任务的 `findings/progress/task_plan.md`、过时的根 `CHANGELOG.md`。`data/geocoding-cache.json` 运行时缓存被提交 3 次。

### P10. AI 指令互相矛盾，文档落后代码
- `AGENTS.md` 说 GitNexus 可选，`CLAUDE.md` 全文是 GitNexus 模板"MUST run impact analysis before editing any symbol"，且不引用 `AGENTS.md`，Claude 会话拿不到 3400 端口、i18n、验证清单等仓库规则。模板声称有 PostToolUse hook，仓库无 `.claude/settings.json`。
- `docs/ARCHITECTURE.md`、`AI_CONSTRAINTS.md` 停在 04-20，0 处提到 Cloudflare/D1；README 仍说从 SQLite 服务网站，快速开始路径是 `C:\Users\fangx\`；`.env.example` 的 `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` 代码零引用，`packages/ai`、`packages/sources`、`config/prompts`、`modes/` 都没有代码读取。
- 408 行 `doc-governance.mjs`、六层文档、7 个模板，对 26 次提交的单人仓库过重，且只查 frontmatter 不查新鲜度。

## 三、各层详细发现

### Worker（Python）
- W1 层边界：`operations.py:554-749` 写死 ANAC/GETS 专属逻辑；storage 用 `WHERE organizer='ANAC BDNCP'` 字符串筛选，YAML 改名即失效；ANAC 状态判断两份实现不一致（`extractors/anac.py:14` vs `operations.py:590`）；`normalizers/competition.py:49` 用 `Path(__file__).parents[5]` 读 config，打成 wheel 后失效；抽取层实际为空，字段抽取在 collector 完成，13 个源的 `generic_listing_html` 只是 JSON 映射器。
- W2 注册表：`collectors/registry.py` 15 个 key 有 7 个是具体 source_id，查找先按 source_id 再按 `collector`，与 README 的"collector family"约定相反；`ingest_source` 不检查 `enabled`。
- W3 HTTP：urllib、requests、crawlee 三套；只有 GGZY 有重试、只有 Nominatim 有限速；GGZY 先拉全部候选（30 词 × 1–3 页 × 20 条，6 线程）再截 `limit`；响应无大小上限；解码一律 utf-8 忽略 charset；无协议/主机白名单，urllib 支持 `file://`，SIMAP verifier 会跟随 robots 指向任意主机的 Sitemap 并用无头浏览器渲染。
- W4 相关性过滤：`normalize_text` 去掉所有非 ASCII，`is_design_relevant('建筑设计 招标')` 返回 False；`"student"`/`"award"` 子串匹配误杀 "Student housing architecture competition"；`"maîtrise d'oeuvre"` 归一化后永远匹配不到；`filters.yml` 的关键词从未用于实际过滤。
- W5 币种/日期：TED `estimated-value-lot` 不查币种直接当欧元；`parse_iso_date('2026-11-03+01:00')` 返回 None（需真实 payload 确认）；斜杠日期一律 dd/mm；截止日只存日期丢时区。
- W6 测试：6 个 ingest 测试截止日写死 `2026-06-30`，`test_storage.py:366` 写死 `today=date(2026,5,13)` 但 SQL 用 `date('now')`；时钟不可注入。`test_collectors.py` 4103 行，内联 sources.yml 重复 15 次。
- W7 SQLite：`with connect()` 不关连接；每次 upsert 先 `executescript` 建表（隐式 COMMIT）；一次 ingest 不是一个事务；geocode 缓存每次未命中整文件非原子重写。
- W8 配置：`countries/` 54 个文件 40 个空壳；根 `source_packs/{france,germany,italy,switzerland}.yml` 是未被引用的死副本（只差 BOM）；50 个文件带 BOM 4 个不带；`SourceDefinition` 无 `extra="forbid"`。
- W9 工具链：ruff 只有 `line-length`，151 处 E501 未检查，`# noqa: S310/BLE001` 指向未启用规则；`[tool.uv] dev-dependencies` 已弃用（P8 诱因）；`scripts/doctor.py`、`verify.py` 是 CLI 的 5 行副本，`ingest_batch.py` 是独立 argparse 入口；wheel 不含 `procedure-type-registry.json`。
- W10 死代码：`restore_legacy_competitions`、`cleanup_expired_competitions_once_per_day` 只有测试用；`enrich_records_geocode` 无人用；`seed-demo` 把虚构记录带真实官方 URL 写进正式库。

### 存储与认证（TypeScript）
- S1 见 P3、P4、P5、P7。
- S2 校验：zod 在依赖里但没有一个路由用；`deadlineBefore` 不校验 ISO；LIKE 不转义 `%`/`_`；SQLite `LOWER()` 只处理 ASCII，"Österreich" 搜不到。
- S3 可观测：29 处 `catch {}`，存储层和 Web 层零日志；500 响应原样回传内部错误。
- S4 测试：D1 版本的筛选、发现页、关注列表、运维审核全部无测试；"D1 测试"在 Node 下用 better-sqlite3 跑，发现不了 workerd 限制（PBKDF2 事故即此）；无跨运行时一致性测试。
- S5 类型：`packages/core` 唯一的 zod schema 从未 `parse`；`Stored*` 类型手写两份；枚举散落 5 处且与 `taxonomy.yml` 无关联；`ProfessionalOpportunity` 含英文展示文案（视图模型漏进存储层）。
- S6 死代码：`/api/competitions`、`login/actions.ts`、`register/actions.ts`、`queryWebOpportunityFeed`、`countWebAuthUsers`、`deleteWebAuthSessionsForUser`、`getStoredRadarSnapshot`；`package.json` 的 `workerd` 条件导出未生效。

### 前端（Next.js）
- F1 见 P6。
- F2 `discover-feed.tsx:51-79` `startTransition` 包同步返回的 async IIFE，`isPending` 立即变 false，连点产生重复 offset 请求和重复 key；`!response.ok` 静默 return；`watch-toggle-button.tsx:68-105` 同样写法。
- F3 hydration：根布局写死 `<html lang="en">`，`useEffect` 后改；客户端日期格式化不指定 `timeZone`，非 UTC 用户不一致。
- F4 无 `not-found.tsx`、`error.tsx`、`loading.tsx`、`generateMetadata`，所有页面标题都是英文 "Arch Competition Ops"，详情页无 OG/hreflang。
- F5 Discover：分页状态不在 URL，返回丢失；合并不去重；`DiscoverFeed` 缺少与筛选绑定的 key；表单缺 `procedureType`、`implementationPath`、`minQualificationScore` 字段提交即丢；无错误状态。
- F6 无障碍：非交互元素上 `aria-label`；`aria-disabled` 的 Link 仍可点；焦点样式 1px 内阴影；计数和错误无 `aria-live`。
- F7 `opportunity-card-placeholder.ts:2` 引入 756KB `countries-50m.json` 只画 13 国轮廓，模块初始化时转换全部国家。
- F8 `opportunity-card-image.ts`（856 行）只对 stadt-zuerich.ch 调用，hamburg/boamp/doffin 等分支执行不到。
- F9 i18n：`dictionaries.ts` 1906 行，手写类型 480 行可用 `typeof zh` 替代；`format.ts:103,107`、`opportunity-detail-surface.tsx:58-61` 硬编码中英三元；整份字典作 props 传给客户端组件。
- F10 CSS：2220 行有 token 体系（好），约 28 个未引用选择器，5 个媒体查询全堆文件末尾，字体加载 9 个字重只用 2 个，无中文回退栈。
- F11 配置：`images.localPatterns` 无作用（唯一 `<Image>` 设了 `unoptimized`）；无 `headers()` 安全头；ESLint 未启用 `next/typescript`；wrangler 无 R2/KV/限流绑定、无 `observability`。
- F12 死代码：`competition-card.tsx` 无引用且英文硬编码；辖区映射 3 份；`decodeHtmlEntities`、`stripHtmlToText` 两份；`satellitePreviewTestUtils` 挂在生产模块上。

### 仓库与运维
- O1 见 P8、P9、P10。
- O2 `docs/plans/` 用中文状态前缀命名文件（`已完成-`/`施工中-`），与 frontmatter `status` 重复，状态一变就要改名；状态值 11 个 `done` 32 个 `已完成` 混用。
- O3 依赖：`@types/react`、`typescript` 在根目录，apps/web 靠 hoisting；`export-d1-data.mjs` 直接 import 根目录未声明的 `better-sqlite3`（幽灵依赖）；无 `engines`、`.nvmrc`、`.python-version`；`test:storage` 的 glob 参数需 Node 21+ 但 SETUP 写 20+。
- O4 `dev-port.ps1` 535 行只管一个端口，测试在端口未被排除的机器上直接 skip；全部运维脚本仅 Windows 可用。
- O5 `.gitignore` 中 `artifacts/html/*.html` 等 4 行冗余；`.claude/skills/gitnexus/**` 为第三方生成文档。
- O6 首次提交 297 文件 42k 行，04-29 之前历史丢失；`aac7c1a` 把功能、数据缓存、截图混在一起。

## 四、建议的执行顺序

**第一批（止血，1–2 天）**
1. 修定时抓取：`pyproject.toml` 改 `[dependency-groups] dev`；`run-ingest-batch.ps1` 调用原生命令时临时 `Continue` 并用 `$LASTEXITCODE` 判断；加锁文件、`ExecutionTimeLimit`、失败通知。
2. 改 D1 同步：不再导出 `workspace_*`、`ops_review_decisions`；`competitions` 等表按主键 upsert；导入前 `wrangler d1 export --remote` 备份；runbook 补回滚。
3. 补 `.gitignore`（`.env*`、`.dev.vars`、`*.sqlite-*`、`data/inbox/*`、`data/eval/*`）；删根目录截图、playwright 文件、过期任务文件；加 `.gitattributes`；不再跟踪 `opportunity-preview-revision.ts`、`next-env.d.ts`、`geocoding-cache.json`。
4. 修 7 个到期失效测试（注入时钟或 `ARCH_COMPETITION_TODAY`）；加根 `test`/`typecheck` 脚本；上最小 CI（ruff、pytest、doctor/verify、lint、tsc、test:storage、web lib 测试、build）。
5. `CLAUDE.md` 改为 `@AGENTS.md` 加简短补充，删除强制 GitNexus 模板。

**第二批（数据真值与身份，1 周）**
6. `build_base_record` 无证据一律留空（费用、audience、implementation_path、official_url）；organizer 改真实采购人，平台名另存 `source_name`；删 collector 写死的 `implementationPath` 和 TED 占位值；补"无证据即为空"回归测试。
7. 稳定 id 改 `source_id + official_notice_id`，缺失时退回 `source_url` 哈希；`dedup_key` 只作跨源查重信号。
8. 字段级 upsert 合并：不覆盖 status 与运营决定；`official_url`/`evidence_note` 不被空值覆盖；复核决定只在 payload 哈希变化后重开；按源校准置信度。
9. GGZY 截止日只接受正向标签候选；统一 `normalizers/dates.py` 保留时区。

**第三批（认证与存储，1–2 周）**
10. 认证接授权：`workspace_key` 由 `user_id` 派生或加 `owner_user_id` 迁移；`/api/watchlists`、`/api/saved-searches`、`/api/ops/*`、`/ops`、`/dashboard` 要求登录；运维加角色；`actorLabel` 取会话用户。
11. 统一密码哈希为 PHC 格式单一实现，参数 N=2^14,r=8,p=5 并在 Workers 实测；假哈希防枚举；登录注册限速；登出改 POST。
12. 合并两套存储实现：`D1DatabaseLike` 加 `batch()` 作驱动接口，Node 用 `fromBetterSqlite3` 适配，按领域拆成 400 行内文件，删约 3000 行重复与 `LocalStorageModule`。
13. 筛选分页下推 SQL（`LIMIT/OFFSET` + 单独 `COUNT`）；去掉每请求的 `hasD1Opportunities` 和 `hasColumn`；补索引 `(status, deadline_at)`、`jurisdiction`、`discovered_at`、`estimated_contract_value_eur`；搜索改 FTS5；分类在 Python 写入时做一次。
14. 表结构只以 migrations 为真源；测试库从 migrations 生成；CI 比对 `SCHEMA_SQL` 与 migrations。
15. zod 统一 API 输入契约；`limit/offset/publishedWithinDays` 设上下限；`catch {}` 改记日志；500 不回传内部错误；Node 端缓存连接；两端开 WAL + `busy_timeout`。

**第四批（预览管线，1–2 周）**
16. 预览生成移出请求路径：离线 CLI 由 Python 摄取触发，产物写 R2，D1 存 `preview_key`；route 只查 D1、读 R2/ASSETS、否则占位 SVG。
17. 落地前止血：`env.ASSETS.fetch` 替代自请求；带版本 URL 返回 `immutable`；`caches.default`；总时限与子请求预算；在途去重；基本限流。
18. 地理编码：Promise 队列串行化 Nominatim/Photon；非 2xx 不写持久负缓存；缓存防抖原子写；revision 不含 `opportunity-location.ts`。
19. 按边界拆 `opportunity-satellite-preview.ts` 为 `packages/` 独立包，词表进 JSON；删同步脚本的旧图重命名与双份拷贝；`prestart` 不再改写源码。

**第五批（前端体验与清理）**
20. 修加载更多竞态（自管 loading、按 id 去重、错误提示、feed 加 key）；`discover.ts` 限制范围；并行服务端请求；dashboard 批量查询。
21. 加本地化 `not-found/error/loading.tsx`、`generateMetadata`、hreflang；SSR 输出正确 `<html lang>`；日期格式化指定 `timeZone`。
22. 加 `test:web` 进验证清单；启用 `next/typescript` lint；删 `competition-card`、未用 server action、`/api/competitions`、28 个无用选择器、多余字重；`countries-50m.json` 换预计算轮廓；字典按语言拆文件并从数据推导类型。
23. 拆 `ggzy.py`、`database.py`、`operations.py`、`test_collectors.py`；ANAC/GETS 后处理插件化；共享 HTTP 客户端（重试、限速、大小上限、charset、协议/主机白名单）；原始响应落盘 `artifacts/html` 留证；删 4 个根目录死 pack；统一 BOM；`extra="forbid"`。
24. 文档：规则只保留 `AGENTS.md` 一个权威来源；更新 ARCHITECTURE 的 D1/Workers；修 README 路径；`.env.example` 删无用 key 补实际变量并统一 `ARCH_COMPETITION_DB_PATH`/`ARCH_COMPETITION_OPS_DB`；doc-governance 只保留 `scan`；文件名去状态前缀。

## 五、未核实项
- TED 截止日是否带时区偏移、`estimated-value-lot` 币种，需真实 payload。
- D1 远程 `execute --file` 是否原子执行。
- OpenNext 是否能把 sharp 打进 Workers 包（推断为不能）。
- 是否存在 PBKDF2 时期注册的真实用户（切换到 scrypt 后无法登录）。
- Web 端是否会把 `javascript:` 形式的 `official_url` 渲染成链接。
- `DiscoverFeed` 在 searchParams 变化时是否真的显示旧列表，需浏览器验证。

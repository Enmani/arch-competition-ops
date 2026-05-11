import type { AppLocale } from "@/i18n/config";

type ValueMap = Record<string, string>;

export type AppDictionary = {
  common: {
    unknown: string;
    unstated: string;
    pending: string;
    unscored: string;
    explicitRequired: string;
    notExplicitInNotice: string;
    likelyRequired: string;
    notSignaledInNotice: string;
    primaryOfficialSource: string;
    secondarySource: string;
    noParticipationFee: string;
    feePending: string;
    valuePending: string;
    closesPrefix: string;
    deadlinePending: string;
    capturedPrefix: string;
    updatedPrefix: string;
    seedSample: string;
    openRecord: string;
    officialNotice: string;
    briefPdf: string;
    documentsPortal: string;
    sourceTrace: string;
    officialPage: string;
    backToRadar: string;
  };
  shell: {
    brandKicker: string;
    officialFirst: string;
    brandTitle: string;
    captions: {
      discover: string;
      dashboard: string;
      ops: string;
      support: string;
      auth: string;
      fallback: string;
    };
    nav: {
      radar: string;
      workspace: string;
      pipeline: string;
    };
    utility: {
      support: string;
      login: string;
      register: string;
      logout: string;
    };
    surfaces: {
      browse: string;
      operator: string;
      port3400: string;
    };
    ariaLabels: {
      primaryNav: string;
      context: string;
    };
    localeSwitcherLabel: string;
    localeAbbreviations: Record<AppLocale, string>;
    localeNames: Record<AppLocale, string>;
  };
  discover: {
    heroEyebrow: string;
    heroTitle: string;
    heroIntro: string;
    deckRules: [string, string, string];
    searchEyebrow: string;
    noFilterSummary: string;
    activeFilterSuffix: string;
    autoExpandedMetadata: string;
    feedRegionLabel: string;
    filterLabels: {
      search: string;
      country: string;
      capturedWithin: string;
      deadlineBefore: string;
      minValue: string;
      sort: string;
      projectType: string;
      buildingCategory: string;
      designScope: string;
      projectMode: string;
      deadlineAfter: string;
      maxValue: string;
      qualificationGate: string;
      includeExpired: string;
    };
    filterOptions: {
      allCountries: string;
      anyCaptureDate: string;
      last7Days: string;
      last30Days: string;
      last90Days: string;
      last365Days: string;
      sortByDeadline: string;
      sortByLatest: string;
      sortByContractValue: string;
      allProjectTypes: string;
      allBuildingCategories: string;
      requireLicensedArchitect: string;
      includeExpired: string;
    };
    placeholders: {
      search: string;
    };
    buttons: {
      applyScreen: string;
      resetFilters: string;
      clearFilters: string;
      loadMore: string;
      loadingMore: string;
    };
    card: {
      deadline: string;
      location: string;
      value: string;
    };
    empty: {
      eyebrow: string;
      title: string;
      body: string;
    };
  };
  feed: {
    band: {
      authority: string;
      implementationRoute: string;
      serviceValue: string;
    };
    sections: {
      commercial: string;
      qualification: string;
      trace: string;
    };
    fields: {
      opportunity: string;
      procedure: string;
      estimatedValue: string;
      participationCost: string;
      prizeNote: string;
      eligibility: string;
      licensedArchitect: string;
      localPartner: string;
      qualificationScore: string;
      audience: string;
      noticeId: string;
      evidenceStack: string;
      discoveryTrail: string;
      extractionConfidence: string;
      languages: string;
      regions: string;
      competitionTags: string;
      cpv: string;
    };
  };
  detail: {
    eyebrow: string;
    keyFacts: string;
    evidenceActions: string;
    sourceNote: string;
    links: string;
    fields: {
      authority: string;
      opportunityType: string;
      procedure: string;
      implementationRoute: string;
      qualification: string;
      eligibility: string;
      commercialSignal: string;
      projectCategory: string;
      officialSectors: string;
      builtAssetTypes: string;
      designScopes: string;
      projectModes: string;
    };
  };
  dashboard: {
    eyebrow: string;
    title: string;
    description: string;
    table: {
      competition: string;
      status: string;
      deadline: string;
      watchedAt: string;
      actions: string;
    };
    empty: {
      title: string;
      body: string;
    };
    roadmap: {
      eyebrow: string;
      title: string;
      items: string[];
    };
  };
  workspace: {
    readOnly: string;
    savedSearches: {
      eyebrow: string;
      title: string;
      description: string;
      nameLabel: string;
      placeholder: string;
      save: string;
      saving: string;
      remove: string;
      empty: string;
      noActiveFilters: string;
      current: string;
      errors: {
        save: string;
        remove: string;
      };
    };
    watchlist: {
      watch: string;
      unwatch: string;
      saving: string;
      watched: string;
      readOnly: string;
      errors: {
        update: string;
      };
    };
  };
  ops: {
    eyebrow: string;
    title: string;
    description: string;
    table: {
      totalTracked: string;
      verified: string;
      primarySourceBacked: string;
      opsReading: string;
      opsReadingValue: string;
    };
    snapshot: {
      eyebrow: string;
      title: string;
    };
    duplicateSummary: {
      groups: string;
      groupsDescription: string;
      records: string;
      recordsDescription: string;
      maxGroupSize: string;
      maxGroupSizeDescription: string;
    };
    health: {
      eyebrow: string;
      title: string;
      description: string;
      pending: string;
      emptyTitle: string;
      emptyBody: string;
      table: {
        source: string;
        freshness: string;
        lastRun: string;
        volume: string;
        parseFailures: string;
        duplicatePressure: string;
        status: string;
      };
      freshness: {
        fresh: string;
        watch: string;
        stale: string;
        never: string;
      };
      status: {
        success: string;
        completedWithFailures: string;
        failed: string;
        empty: string;
      };
      volume: {
        documents: string;
        upserted: string;
      };
      duplicate: {
        none: string;
        groups: string;
        maxCluster: string;
      };
    };
    review: {
      eyebrow: string;
      title: string;
      description: string;
      mode: {
        enabled: string;
        readOnly: string;
      };
      readOnly: {
        title: string;
        body: string;
      };
      empty: {
        title: string;
        body: string;
      };
      errors: {
        load: string;
        decision: string;
      };
      summary: {
        active: string;
        pending: string;
        needsFollowUp: string;
        accepted: string;
        rejected: string;
      };
      filters: {
        statusLabel: string;
        reasonLabel: string;
        allStatuses: string;
        allReasons: string;
        pending: string;
        needsFollowUp: string;
        accepted: string;
        rejected: string;
      };
      table: {
        record: string;
        reason: string;
        detected: string;
        status: string;
        actions: string;
      };
      status: {
        pending: string;
        needsFollowUp: string;
        accepted: string;
        rejected: string;
      };
      reasons: {
        sourceParseFailures: string;
        sourceRunFailed: string;
        duplicateCluster: string;
        lowConfidenceRecord: string;
        evidenceConflict: string;
        submissionPendingReview: string;
      };
      actions: {
        refresh: string;
        accept: string;
        followUp: string;
        reject: string;
        reopen: string;
      };
      meta: {
        source: string;
        competition: string;
        noticeId: string;
        parseFailures: string;
        duplicateCount: string;
        confidence: string;
        latestDecision: string;
        active: string;
        inactive: string;
      };
    };
  };
  auth: {
    fields: {
      email: string;
      password: string;
      passwordConfirmation: string;
    };
    login: {
      eyebrow: string;
      title: string;
      description: string;
      submit: string;
      secondaryPrompt: string;
      secondaryAction: string;
    };
    register: {
      eyebrow: string;
      title: string;
      description: string;
      submit: string;
      secondaryPrompt: string;
      secondaryAction: string;
    };
    errors: {
      email_taken: string;
      invalid_credentials: string;
      invalid_email: string;
      missing_fields: string;
      password_mismatch: string;
      unexpected: string;
      weak_password: string;
    };
  };
  support: {
    heroEyebrow: string;
    heroTitle: string;
    heroIntro: string;
    heroActions: {
      primary: string;
      secondary: string;
    };
    contact: {
      eyebrow: string;
      title: string;
      body: string;
      items: Array<{
        label: string;
        value: string;
        href: string;
      }>;
    };
    principles: {
      eyebrow: string;
      title: string;
      items: Array<{
        label: string;
        value: string;
      }>;
    };
    rationale: {
      eyebrow: string;
      title: string;
      body: string;
      points: string[];
    };
    tracks: {
      eyebrow: string;
      title: string;
      intro: string;
      items: Array<{
        eyebrow: string;
        title: string;
        summary: string;
        points: string[];
        note: string;
      }>;
    };
    roadmap: {
      eyebrow: string;
      title: string;
      items: Array<{
        label: string;
        value: string;
      }>;
    };
    closing: {
      eyebrow: string;
      title: string;
      body: string;
      disclaimer: string;
      primary: string;
      secondary: string;
    };
  };
  taxonomy: {
    statuses: ValueMap;
    jurisdictions: ValueMap;
    regions: ValueMap;
    opportunityTypes: ValueMap;
    procedures: ValueMap;
    implementationPaths: ValueMap;
    evidenceLevels: ValueMap;
    projectTypes: ValueMap;
    buildingCategories: ValueMap;
    designScopes: ValueMap;
    projectModes: ValueMap;
    officialSectors: ValueMap;
    builtAssetTypes: ValueMap;
    competitionTags: ValueMap;
    audiences: ValueMap;
  };
};

export const dictionaries: Record<AppLocale, AppDictionary> = {
  zh: {
    common: {
      unknown: "未知",
      unstated: "未说明",
      pending: "待确认",
      unscored: "未评分",
      explicitRequired: "明确要求",
      notExplicitInNotice: "公告中未明确要求",
      likelyRequired: "大概率需要",
      notSignaledInNotice: "公告中未出现信号",
      primaryOfficialSource: "官方来源",
      secondarySource: "其他来源",
      noParticipationFee: "无参赛费用",
      feePending: "费用待定",
      valuePending: "金额待定",
      closesPrefix: "截止",
      deadlinePending: "截止日期待定",
      capturedPrefix: "抓取于",
      updatedPrefix: "更新于",
      seedSample: "演示样本",
      openRecord: "查看详情",
      officialNotice: "官方链接",
      briefPdf: "任务书 PDF",
      documentsPortal: "资料入口",
      sourceTrace: "来源链接",
      officialPage: "官方链接",
      backToRadar: "返回列表",
    },
    shell: {
      brandKicker: "建筑机会数据库",
      officialFirst: "官方来源",
      brandTitle: "Arch Competition Ops",
      captions: {
        discover: "面向有资质建筑师与事务所的公共设计机会列表。",
        dashboard: "用于内部筛选、标记和跟进。",
        ops: "用于查看抓取、解析和入库状态。",
        support: "说明支持方式，以及支持会优先推进什么。",
        auth: "用于进入个人工作台。",
        fallback: "公共设计机会界面。",
      },
      nav: {
        radar: "机会",
        workspace: "工作台",
        pipeline: "运维",
      },
      utility: {
        support: "支持",
        login: "登录",
        register: "注册",
        logout: "退出",
      },
      surfaces: {
        browse: "列表页",
        operator: "管理页",
        port3400: "端口 3400",
      },
      ariaLabels: {
        primaryNav: "主导航",
        context: "上下文",
      },
      localeSwitcherLabel: "语言",
      localeAbbreviations: {
        zh: "CH",
        en: "EN",
      },
      localeNames: {
        zh: "中文",
        en: "英文",
      },
    },
    discover: {
      heroEyebrow: "机会列表",
      heroTitle: "公共设计机会列表",
      heroIntro:
        "官方来源中的公共设计机会。可按国家、抓取时间、截止日期和金额筛选。",
      deckRules: ["官方来源", "资格要求", "金额与截止日期"],
      searchEyebrow: "筛选",
      noFilterSummary: "显示全部记录。",
      activeFilterSuffix: "个筛选条件生效。",
      autoExpandedMetadata: "展开字段",
      feedRegionLabel: "机会列表",
      filterLabels: {
        search: "搜索",
        country: "国家",
        capturedWithin: "抓取时间",
        deadlineBefore: "截止日期早于",
        minValue: "最低金额 EUR",
        sort: "排序",
        projectType: "项目类型",
        buildingCategory: "建筑项目类别",
        designScope: "设计阶段",
        projectMode: "建设方式",
        deadlineAfter: "截止日期晚于",
        maxValue: "最高金额 EUR",
        qualificationGate: "资格门槛",
        includeExpired: "已过期项目",
      },
      filterOptions: {
        allCountries: "全部国家",
        anyCaptureDate: "任意抓取时间",
        last7Days: "最近 7 天",
        last30Days: "最近 30 天",
        last90Days: "最近 90 天",
        last365Days: "最近 365 天",
        sortByDeadline: "按截止日期",
        sortByLatest: "按最近更新",
        sortByContractValue: "按合同金额",
        allProjectTypes: "全部项目类型",
        allBuildingCategories: "全部建筑项目类别",
        requireLicensedArchitect: "只看明确要求持证建筑师的机会",
        includeExpired: "包含已过期项目",
      },
      placeholders: {
        search: "机构、主办方、公告编号、标题",
      },
      buttons: {
        applyScreen: "筛选",
        resetFilters: "重置筛选",
        clearFilters: "清空筛选",
        loadMore: "加载更多项目",
        loadingMore: "正在展开",
      },
      card: {
        deadline: "截止日期",
        location: "位置",
        value: "报酬",
      },
      empty: {
        eyebrow: "无结果",
        title: "没有匹配结果。",
        body: "请调整筛选条件。",
      },
    },
    feed: {
      band: {
        authority: "发布机构",
        implementationRoute: "落地路径",
        serviceValue: "服务价值",
      },
      sections: {
        commercial: "商业面",
        qualification: "资格面",
        trace: "证据面",
      },
      fields: {
        opportunity: "机会类型",
        procedure: "程序类型",
        estimatedValue: "估算金额",
        participationCost: "参与成本",
        prizeNote: "奖金说明",
        eligibility: "资格要求",
        licensedArchitect: "持证建筑师",
        localPartner: "本地合作方",
        qualificationScore: "资格评分",
        audience: "目标对象",
        noticeId: "公告编号",
        evidenceStack: "证据",
        discoveryTrail: "抓取轨迹",
        extractionConfidence: "抽取置信度",
        languages: "语言",
        regions: "地区",
        competitionTags: "竞赛标签",
        cpv: "CPV",
      },
    },
    detail: {
      eyebrow: "详情",
      keyFacts: "事实",
      evidenceActions: "证据和链接",
      sourceNote: "备注",
      links: "链接",
      fields: {
        authority: "发布机构",
        opportunityType: "机会类型",
        procedure: "程序类型",
        implementationRoute: "落地路径",
        qualification: "资格",
        eligibility: "资格要求",
        commercialSignal: "金额",
        projectCategory: "项目归类",
        officialSectors: "官方分类",
        builtAssetTypes: "建筑对象",
        designScopes: "设计阶段",
        projectModes: "建设方式",
      },
    },
    dashboard: {
      eyebrow: "工作台",
      title: "事务所工作台",
      description: "查看已观察机会，并继续资格、组队与落地路径筛查。",
      table: {
        competition: "项目",
        status: "状态",
        deadline: "截止日期",
        watchedAt: "加入观察时间",
        actions: "动作",
      },
      empty: {
        title: "还没有观察中的机会。",
        body: "先在 discover 或详情页标记观察对象，工作台才会出现后续清单。",
      },
      roadmap: {
        eyebrow: "后续功能",
        title: "计划功能",
        items: [
          "提醒与摘要",
          "追踪工作流",
          "登录与事务所级状态",
          "已验证提交入口",
        ],
      },
    },
    workspace: {
      readOnly: "当前为只读模式。设置 ARCH_ENABLE_WORKSPACE_WRITES 后，才允许保存筛选和观察机会。",
      savedSearches: {
        eyebrow: "已存筛选",
        title: "保存当前筛选",
        description: "把当前 discover 屏幕固化为一个可复用入口。",
        nameLabel: "筛选名称",
        placeholder: "例如：意大利高价值教育项目",
        save: "保存当前筛选",
        saving: "保存中",
        remove: "删除",
        empty: "还没有保存的筛选。",
        noActiveFilters: "至少启用一个筛选条件后，才能保存当前视图。",
        current: "当前视图",
        errors: {
          save: "保存筛选失败。",
          remove: "删除筛选失败。",
        },
      },
      watchlist: {
        watch: "加入观察",
        unwatch: "取消观察",
        saving: "更新中",
        watched: "已观察",
        readOnly: "当前为只读模式。",
        errors: {
          update: "更新观察状态失败。",
        },
      },
    },
    ops: {
      eyebrow: "运维",
      title: "抓取与入库状态",
      description: "查看抓取源的新鲜度、解析失败和重复压力。",
      table: {
        totalTracked: "总跟踪数",
        verified: "已核验",
        primarySourceBacked: "官方来源",
        opsReading: "规则",
        opsReadingValue: "采购优先",
      },
      snapshot: {
        eyebrow: "记录",
        title: "当前记录",
      },
      duplicateSummary: {
        groups: "重复组",
        groupsDescription: "基于 canonical dedup key 的重复簇数量。",
        records: "重复记录",
        recordsDescription: "当前落在重复簇里的记录总数。",
        maxGroupSize: "最大簇",
        maxGroupSizeDescription: "单个重复簇里最多的记录数。",
      },
      health: {
        eyebrow: "源健康",
        title: "来源新鲜度与解析健康",
        description: "优先处理陈旧、解析失败多、重复压力高的来源。",
        pending: "待运行",
        emptyTitle: "还没有来源健康数据。",
        emptyBody: "先运行 ingest，ops 页才会出现来源级诊断。",
        table: {
          source: "来源",
          freshness: "新鲜度",
          lastRun: "最近运行",
          volume: "量级",
          parseFailures: "解析失败",
          duplicatePressure: "重复压力",
          status: "状态",
        },
        freshness: {
          fresh: "新鲜",
          watch: "观察",
          stale: "陈旧",
          never: "未成功运行",
        },
        status: {
          success: "成功",
          completedWithFailures: "部分失败",
          failed: "失败",
          empty: "空运行",
        },
        volume: {
          documents: "文档",
          upserted: "入库",
        },
        duplicate: {
          none: "无",
          groups: "组数",
          maxCluster: "最大簇",
        },
      },
      review: {
        eyebrow: "复核队列",
        title: "人工复核队列",
        description: "把解析失败、证据冲突、重复簇和低置信记录集中到一个可操作队列。",
        mode: {
          enabled: "决策写入已开启",
          readOnly: "当前只读",
        },
        readOnly: {
          title: "当前为只读模式。",
          body: "设置 ARCH_ENABLE_OPS_REVIEW 后，才允许在产品内记录接受、拒绝或需跟进的决策。",
        },
        empty: {
          title: "当前筛选下没有复核项。",
          body: "先运行 ingest 或 verify，或者切换状态与原因筛选。",
        },
        errors: {
          load: "加载复核队列失败。",
          decision: "写入复核决策失败。",
        },
        summary: {
          active: "活跃项",
          pending: "待处理",
          needsFollowUp: "需跟进",
          accepted: "已接受",
          rejected: "已拒绝",
        },
        filters: {
          statusLabel: "按状态筛选",
          reasonLabel: "按原因筛选",
          allStatuses: "全部状态",
          allReasons: "全部原因",
          pending: "待处理",
          needsFollowUp: "需跟进",
          accepted: "已接受",
          rejected: "已拒绝",
        },
        table: {
          record: "记录",
          reason: "原因",
          detected: "最近检测",
          status: "状态",
          actions: "动作",
        },
        status: {
          pending: "待处理",
          needsFollowUp: "需跟进",
          accepted: "已接受",
          rejected: "已拒绝",
        },
        reasons: {
          sourceParseFailures: "来源解析失败",
          sourceRunFailed: "来源运行失败",
          duplicateCluster: "重复簇",
          lowConfidenceRecord: "低置信记录",
          evidenceConflict: "证据冲突",
          submissionPendingReview: "待审核提交",
        },
        actions: {
          refresh: "刷新队列",
          accept: "接受",
          followUp: "跟进",
          reject: "拒绝",
          reopen: "重新打开",
        },
        meta: {
          source: "来源",
          competition: "记录 ID",
          noticeId: "公告号",
          parseFailures: "失败数",
          duplicateCount: "重复数",
          confidence: "置信度",
          latestDecision: "最近决策",
          active: "活跃",
          inactive: "已失活",
        },
      },
    },
    auth: {
      fields: {
        email: "邮箱",
        password: "密码",
        passwordConfirmation: "再次输入密码",
      },
      login: {
        eyebrow: "登录",
        title: "进入工作台",
        description: "使用邮箱和密码进入你的本地工作台。",
        submit: "登录",
        secondaryPrompt: "还没有账号？",
        secondaryAction: "注册",
      },
      register: {
        eyebrow: "注册",
        title: "创建账号",
        description: "创建一个邮箱密码账号，用于保存后续工作状态。",
        submit: "注册",
        secondaryPrompt: "已有账号？",
        secondaryAction: "登录",
      },
      errors: {
        email_taken: "这个邮箱已经注册。",
        invalid_credentials: "邮箱或密码不正确。",
        invalid_email: "请输入有效邮箱。",
        missing_fields: "请填写所有字段。",
        password_mismatch: "两次输入的密码不一致。",
        unexpected: "认证请求失败，请稍后重试。",
        weak_password: "密码至少需要 8 个字符。",
      },
    },
    support: {
      heroEyebrow: "支持项目",
      heroTitle: "为建筑师/建筑事务所整理\n可参与的项目机会",
      heroIntro:
        "Arch Competition Ops 跟踪公共公告和官方采购页面，把它们整理成可追溯的机会情报，帮助事务所判断哪些机会值得投入。支持会先用在来源覆盖、资格判断和团队工作流上。",
      heroActions: {
        primary: "查看支持方式",
        secondary: "浏览机会雷达",
      },
      contact: {
        eyebrow: "联系与仓库",
        title: "支持、合作或反馈，都可以从这里开始",
        body:
          "如果你想交流支持方式、提出改进建议，或先看项目当前进展，可以直接发邮件，或者查看公开仓库。",
        items: [
          {
            label: "个人邮箱",
            value: "fangxiaoyandi@gmail.com",
            href: "mailto:fangxiaoyandi@gmail.com",
          },
          {
            label: "仓库目录",
            value: "github.com/Enmani/arch-competition-ops",
            href: "https://github.com/Enmani/arch-competition-ops",
          },
        ],
      },
      principles: {
        eyebrow: "立场",
        title: "核心规则保持不变",
        items: [
          {
            label: "官方信息",
            value: "收集政府发布的真实招标信息",
          },
          {
            label: "灵活筛选",
            value: "支持按时间、地区、价格等条件快速筛选",
          },
          {
            label: "每日更新",
            value: "每天更新两次，及时获取新的项目机会",
          },
        ],
      },
      rationale: {
        eyebrow: "为什么支持",
        title: "支持会先用于这些地方",
        body:
          "支持会先投到来源覆盖、资格判断、证据整理和团队后续动作里。",
        points: [
          "更快把官方公告整理成可用情报。",
          "让事务所在筛选阶段就看到资格门槛。",
        ],
      },
      tracks: {
        eyebrow: "支持方式",
        title: "三种合作方式",
        intro:
          "当前支持按合作项目沟通。",
        items: [
          {
            eyebrow: "事务所试点",
            title: "事务所试点支持",
            summary:
              "适合希望更早参与产品定义的事务所、业务拓展负责人和投标团队。优先推进筛选、提醒和资格摘要。",
            points: [
              "适合希望提前影响工作流的团队。",
              "按明确试点范围推进。",
            ],
            note: "试点范围按案例约定。",
          },
          {
            eyebrow: "机构增强分发",
            title: "机构与主办方分发支持",
            summary:
              "适合需要在公告发布之后补一层专业触达的主办方、公共机构和代理合作方。",
            points: [
              "重点是专业受众触达。",
              "优先支持核验后分发和反馈读数。",
            ],
            note: "按分发合作沟通。",
          },
          {
            eyebrow: "研究与数据伙伴",
            title: "研究与数据合作",
            summary:
              "适合高校、研究机构、基金会和数据伙伴。",
            points: [
              "优先支持来源扩展和多语标准化。",
              "让公开机会情报继续可追溯、可复用。",
            ],
            note: "合作边界按项目约定。",
          },
        ],
      },
      roadmap: {
        eyebrow: "下一阶段",
        title: "支持会优先推进这些能力",
        items: [
          {
            label: "保存筛选条件",
            value: "把固定筛选条件沉淀成团队级长期雷达。",
          },
          {
            label: "资格摘要",
            value: "把资格门槛、落地路径和风险提示压缩成追标摘要。",
          },
          {
            label: "核验后分发",
            value: "为机构侧提供官方发布后的专业增量分发和反馈读数。",
          },
        ],
      },
      closing: {
        eyebrow: "当前状态",
        title: "当前支持按合作项目沟通",
        body:
          "公开联系入口和支付方式会后续补上。当前先按合作项目确认范围。",
        disclaimer:
          "支持范围和资料形式按案例约定。",
        primary: "回到支持方式",
        secondary: "浏览当前机会面",
      },
    },
    taxonomy: {
      statuses: {
        verified: "已核验",
        shortlisted: "已入围",
        discovered: "已发现",
        archived: "已归档",
        discarded: "已剔除",
      },
      jurisdictions: {
        global: "全球",
        eu: "欧盟",
        asia: "亚洲",
        north_america: "北美",
        oceania: "大洋洲",
        australia: "澳大利亚",
        canada: "加拿大",
        china: "中国",
        italy: "意大利",
        france: "法国",
        switzerland: "瑞士",
        germany: "德国",
        new_zealand: "新西兰",
        netherlands: "荷兰",
        czechia: "捷克",
        bulgaria: "保加利亚",
        slovenia: "斯洛文尼亚",
        norway: "挪威",
        poland: "波兰",
        portugal: "葡萄牙",
        belgium: "比利时",
        spain: "西班牙",
        united_kingdom: "英国",
        austria: "奥地利",
        iberia: "伊比利亚",
        nordics: "北欧",
        lithuania: "立陶宛",
        latvia: "拉脱维亚",
        north_macedonia: "北马其顿",
      },
      regions: {
        global: "全球",
        europe: "欧洲",
        asia: "亚洲",
        north_america: "北美",
        oceania: "大洋洲",
        australia: "澳大利亚",
        canada: "加拿大",
        china: "中国",
        germany: "德国",
        italy: "意大利",
        france: "法国",
        switzerland: "瑞士",
        new_zealand: "新西兰",
        netherlands: "荷兰",
        norway: "挪威",
        portugal: "葡萄牙",
        belgium: "比利时",
        spain: "西班牙",
        united_kingdom: "英国",
        austria: "奥地利",
        iberia: "伊比利亚",
        nordics: "北欧",
      },
      opportunityTypes: {
        public_design_contest: "公共设计竞赛",
        public_design_services_procurement: "公共设计服务采购",
        framework_design_services: "框架协议设计服务",
        negotiated_follow_on_services: "后续协商委托服务",
      },
      procedures: {
        design_contest: "设计竞赛",
        negotiated_procedure_after_contest: "竞赛后协商程序",
        public_design_services_tender: "公共设计服务招标",
        maitrise_d_oeuvre_procurement: "设计总负责采购",
        planning_competition: "规划竞赛",
        selective: "选择性程序",
        framework_agreement: "框架协议",
        negotiated_procedure: "协商程序",
        adapted_procedure: "适应性程序",
        open: "公开程序",
        "neg-w-call": "有公告的谈判程序",
        "neg-wo-call": "无公告的谈判程序",
      },
      implementationPaths: {
        winner_or_winners_progress_to_negotiated_service_award: "获胜方案进入后续协商委托",
        service_contract_award_after_competitive_selection: "竞争遴选后授予服务合同",
        framework_selection_for_repeated_design_commissions: "通过框架遴选承接持续设计委托",
        unknown: "暂未确认后续实施路径",
      },
      evidenceLevels: {
        official_notice: "官方公告",
        official_listing: "官方列表",
        authority_page: "主管机构页面",
        secondary: "二手来源",
        tertiary: "三手来源",
      },
      projectTypes: {
        urban_regeneration: "城市更新",
        environment_design: "环境设计",
        urban_planning: "城市规划",
        interior_project: "室内项目",
        building_project: "建筑项目",
      },
      buildingCategories: {
        healthcare: "医院与医疗",
        education: "学校与教育",
        housing: "住宅与居住",
        civic_public: "公共建筑",
        sport_leisure: "体育与休闲",
        culture_heritage: "文化与遗产",
        transport_infrastructure: "交通与基础设施",
      },
      designScopes: {
        interior_design: "室内设计",
        architectural_design: "建筑设计",
        scheme: "方案设计",
        preliminary: "初步设计",
        construction_docs: "施工图设计",
        planning: "详细规划",
        design_service: "设计服务",
      },
      projectModes: {
        new_build: "新建",
        renovation: "改造",
        extension: "扩建",
      },
      officialSectors: {
        building_construction: "房屋建筑",
        design_consulting: "勘察设计",
      },
      builtAssetTypes: {
        interior: "室内",
        healthcare: "医疗",
        education: "教育",
        housing: "住宅",
        office_research: "办公与研发",
        civic_culture: "公共文化",
        welfare: "福利养老",
        hospitality_commercial: "酒店商业",
        land_use_planning: "用地规划",
        urban_renewal: "城市更新",
      },
      competitionTags: {
        architecture: "建筑",
        landscape: "景观",
        interior: "室内",
        adaptive_reuse: "更新改造",
        built_work: "落地实施",
        housing: "住宅",
        pavilion: "展亭",
        healthcare: "医疗",
        masterplan: "总体规划",
        public_building: "公共建筑",
        urban_design: "城市设计",
        education: "教育",
        infrastructure: "基础设施",
        professionals: "专业事务所",
        multidisciplinary: "多专业团队",
      },
      audiences: {
        students: "学生",
        young_architects: "青年建筑师",
        professionals: "专业事务所",
        open: "开放参与",
        multidisciplinary: "多专业团队",
      },
    },
  },
  en: {
    common: {
      unknown: "Unknown",
      unstated: "Unstated",
      pending: "Pending",
      unscored: "Unscored",
      explicitRequired: "Explicitly required",
      notExplicitInNotice: "Not explicit in notice",
      likelyRequired: "Likely required",
      notSignaledInNotice: "Not signaled in notice",
      primaryOfficialSource: "Official source",
      secondarySource: "Other source",
      noParticipationFee: "No participation fee",
      feePending: "Fee pending",
      valuePending: "Value pending",
      closesPrefix: "Closes",
      deadlinePending: "Deadline pending",
      capturedPrefix: "Captured",
      updatedPrefix: "Updated",
      seedSample: "Seed sample",
      openRecord: "View details",
      officialNotice: "Official link",
      briefPdf: "Brief PDF",
      documentsPortal: "Documents portal",
      sourceTrace: "Source link",
      officialPage: "Official link",
      backToRadar: "Back to list",
    },
    shell: {
      brandKicker: "Architecture Opportunity Index",
      officialFirst: "Official source",
      brandTitle: "Arch Competition Ops",
      captions: {
        discover: "Public design opportunities for licensed architects and practices.",
        dashboard: "Internal review, tagging, and follow-up.",
        ops: "Source, parsing, and storage status.",
        support: "How support fits the product and what it funds next.",
        auth: "Practice account access.",
        fallback: "Public design opportunity interface.",
      },
      nav: {
        radar: "Opportunities",
        workspace: "Workspace",
        pipeline: "Ops",
      },
      utility: {
        support: "Support",
        login: "Log in",
        register: "Register",
        logout: "Log out",
      },
      surfaces: {
        browse: "Browse",
        operator: "Ops",
        port3400: "Port 3400",
      },
      ariaLabels: {
        primaryNav: "Primary",
        context: "Context",
      },
      localeSwitcherLabel: "Language",
      localeAbbreviations: {
        zh: "CH",
        en: "EN",
      },
      localeNames: {
        zh: "中文",
        en: "英文",
      },
    },
    discover: {
      heroEyebrow: "Opportunity list",
      heroTitle: "Public design opportunities",
      heroIntro:
        "Public design opportunities from official sources. Filter by country, capture time, deadline, and value.",
      deckRules: ["Official source", "Qualification", "Value and deadline"],
      searchEyebrow: "Filters",
      noFilterSummary: "Showing all records.",
      activeFilterSuffix: "filters active.",
      autoExpandedMetadata: "Expanded fields",
      feedRegionLabel: "Opportunity list",
      filterLabels: {
        search: "Search",
        country: "Country",
        capturedWithin: "Captured within",
        deadlineBefore: "Deadline before",
        minValue: "Min value EUR",
        sort: "Sort",
        projectType: "Project type",
        buildingCategory: "Building category",
        designScope: "Design scope",
        projectMode: "Project mode",
        deadlineAfter: "Deadline after",
        maxValue: "Max value EUR",
        qualificationGate: "Qualification gate",
        includeExpired: "Expired opportunities",
      },
      filterOptions: {
        allCountries: "All countries",
        anyCaptureDate: "Any capture date",
        last7Days: "Last 7 days",
        last30Days: "Last 30 days",
        last90Days: "Last 90 days",
        last365Days: "Last 365 days",
        sortByDeadline: "Sort by deadline",
        sortByLatest: "Sort by latest",
        sortByContractValue: "Sort by contract value",
        allProjectTypes: "All project types",
        allBuildingCategories: "All building categories",
        requireLicensedArchitect: "Require explicit licensed-architect signal",
        includeExpired: "Include expired opportunities",
      },
      placeholders: {
        search: "Authority, organizer, notice ID, title",
      },
      buttons: {
        applyScreen: "Filter",
        resetFilters: "Reset",
        clearFilters: "Clear",
        loadMore: "Continue the opportunity stream",
        loadingMore: "Expanding",
      },
      card: {
        deadline: "Deadline",
        location: "Location",
        value: "Compensation",
      },
      empty: {
        eyebrow: "No results",
        title: "No results.",
        body: "Adjust the filters.",
      },
    },
    feed: {
      band: {
        authority: "Authority",
        implementationRoute: "Implementation route",
        serviceValue: "Service value",
      },
      sections: {
        commercial: "Commercial",
        qualification: "Qualification",
        trace: "Trace",
      },
      fields: {
        opportunity: "Opportunity",
        procedure: "Procedure",
        estimatedValue: "Estimated value",
        participationCost: "Participation cost",
        prizeNote: "Prize note",
        eligibility: "Eligibility",
        licensedArchitect: "Licensed architect",
        localPartner: "Local partner",
        qualificationScore: "Qualification score",
        audience: "Audience",
        noticeId: "Notice ID",
        evidenceStack: "Evidence",
        discoveryTrail: "Discovery trail",
        extractionConfidence: "Extraction confidence",
        languages: "Languages",
        regions: "Regions",
        competitionTags: "Competition tags",
        cpv: "CPV",
      },
    },
    detail: {
      eyebrow: "Detail",
      keyFacts: "Facts",
      evidenceActions: "Evidence and links",
      sourceNote: "Note",
      links: "Links",
      fields: {
        authority: "Authority",
        opportunityType: "Opportunity type",
        procedure: "Procedure",
        implementationRoute: "Implementation route",
        qualification: "Qualification",
        eligibility: "Eligibility",
        commercialSignal: "Value",
        projectCategory: "Project classification",
        officialSectors: "Official sectors",
        builtAssetTypes: "Built asset types",
        designScopes: "Design scopes",
        projectModes: "Project modes",
      },
    },
    dashboard: {
      eyebrow: "Workspace",
      title: "Practice workspace",
      description: "Review watched opportunities and continue qualification, teaming, and delivery screening.",
      table: {
        competition: "Competition",
        status: "Status",
        deadline: "Deadline",
        watchedAt: "Watched at",
        actions: "Actions",
      },
      empty: {
        title: "No watched opportunities yet.",
        body: "Watch opportunities from discover or detail to build a follow-up list here.",
      },
      roadmap: {
        eyebrow: "Planned",
        title: "Planned features",
        items: [
          "Alerts and digests",
          "Pursuit workflow",
          "Sign-in and practice status",
          "Verified submission intake",
        ],
      },
    },
    workspace: {
      readOnly:
        "This workspace is currently read-only. Set ARCH_ENABLE_WORKSPACE_WRITES to enable saved searches and watch actions.",
      savedSearches: {
        eyebrow: "Saved screens",
        title: "Save current screen",
        description: "Persist the current discover screen as a reusable entry point.",
        nameLabel: "Saved-search name",
        placeholder: "For example: Italy high-value education work",
        save: "Save current screen",
        saving: "Saving",
        remove: "Remove",
        empty: "No saved searches yet.",
        noActiveFilters: "Activate at least one filter before saving the current screen.",
        current: "Current screen",
        errors: {
          save: "Failed to save the search.",
          remove: "Failed to remove the search.",
        },
      },
      watchlist: {
        watch: "Watch",
        unwatch: "Unwatch",
        saving: "Saving",
        watched: "Watched",
        readOnly: "Read-only mode.",
        errors: {
          update: "Failed to update the watchlist.",
        },
      },
    },
    ops: {
      eyebrow: "Ops",
      title: "Ingestion and storage status",
      description: "Review source freshness, parser failures, and duplicate pressure.",
      table: {
        totalTracked: "Total tracked",
        verified: "Verified",
        primarySourceBacked: "Official sources",
        opsReading: "Rule",
        opsReadingValue: "Procurement-first",
      },
      snapshot: {
        eyebrow: "Records",
        title: "Current records",
      },
      duplicateSummary: {
        groups: "Duplicate groups",
        groupsDescription: "Canonical dedup-key clusters that need review.",
        records: "Records in groups",
        recordsDescription: "Total records currently sitting inside duplicate clusters.",
        maxGroupSize: "Largest cluster",
        maxGroupSizeDescription: "The biggest duplicate cluster in canonical storage.",
      },
      health: {
        eyebrow: "Source health",
        title: "Freshness and parser health by source",
        description: "Triage stale, failing, and duplicate-heavy sources first.",
        pending: "Pending",
        emptyTitle: "No source health recorded yet.",
        emptyBody: "Run ingest first so the ops surface has source-level diagnostics to show.",
        table: {
          source: "Source",
          freshness: "Freshness",
          lastRun: "Last run",
          volume: "Volume",
          parseFailures: "Parse failures",
          duplicatePressure: "Duplicate pressure",
          status: "Status",
        },
        freshness: {
          fresh: "Fresh",
          watch: "Watch",
          stale: "Stale",
          never: "Never succeeded",
        },
        status: {
          success: "Success",
          completedWithFailures: "Completed with failures",
          failed: "Failed",
          empty: "Empty run",
        },
        volume: {
          documents: "Docs",
          upserted: "Upserts",
        },
        duplicate: {
          none: "None",
          groups: "Groups",
          maxCluster: "Max cluster",
        },
      },
      review: {
        eyebrow: "Review queue",
        title: "Operator review queue",
        description:
          "Work through parser failures, evidence conflicts, duplicate clusters, and low-confidence records in one queue.",
        mode: {
          enabled: "Decision writes enabled",
          readOnly: "Read-only mode",
        },
        readOnly: {
          title: "This queue is currently read-only.",
          body:
            "Set ARCH_ENABLE_OPS_REVIEW to enable accept, reject, and needs-follow-up decisions inside the product.",
        },
        empty: {
          title: "No review items match the current filters.",
          body: "Run ingest or verify first, or change the status and reason filters.",
        },
        errors: {
          load: "Failed to load the review queue.",
          decision: "Failed to write the review decision.",
        },
        summary: {
          active: "Active items",
          pending: "Pending",
          needsFollowUp: "Needs follow-up",
          accepted: "Accepted",
          rejected: "Rejected",
        },
        filters: {
          statusLabel: "Filter by status",
          reasonLabel: "Filter by reason",
          allStatuses: "All statuses",
          allReasons: "All reasons",
          pending: "Pending",
          needsFollowUp: "Needs follow-up",
          accepted: "Accepted",
          rejected: "Rejected",
        },
        table: {
          record: "Record",
          reason: "Reason",
          detected: "Last detected",
          status: "Status",
          actions: "Actions",
        },
        status: {
          pending: "Pending",
          needsFollowUp: "Needs follow-up",
          accepted: "Accepted",
          rejected: "Rejected",
        },
        reasons: {
          sourceParseFailures: "Source parse failures",
          sourceRunFailed: "Source run failed",
          duplicateCluster: "Duplicate cluster",
          lowConfidenceRecord: "Low-confidence record",
          evidenceConflict: "Evidence conflict",
          submissionPendingReview: "Submission pending review",
        },
        actions: {
          refresh: "Refresh queue",
          accept: "Accept",
          followUp: "Follow up",
          reject: "Reject",
          reopen: "Reopen",
        },
        meta: {
          source: "Source",
          competition: "Record ID",
          noticeId: "Notice ID",
          parseFailures: "Parse failures",
          duplicateCount: "Duplicate count",
          confidence: "Confidence",
          latestDecision: "Latest decision",
          active: "Active",
          inactive: "Inactive",
        },
      },
    },
    auth: {
      fields: {
        email: "Email",
        password: "Password",
        passwordConfirmation: "Repeat password",
      },
      login: {
        eyebrow: "Log in",
        title: "Enter workspace",
        description: "Use your email and password to enter the local workspace.",
        submit: "Log in",
        secondaryPrompt: "No account yet?",
        secondaryAction: "Register",
      },
      register: {
        eyebrow: "Register",
        title: "Create account",
        description: "Create an email and password account for workspace state.",
        submit: "Register",
        secondaryPrompt: "Already registered?",
        secondaryAction: "Log in",
      },
      errors: {
        email_taken: "That email is already registered.",
        invalid_credentials: "Email or password is incorrect.",
        invalid_email: "Enter a valid email address.",
        missing_fields: "Fill in all fields.",
        password_mismatch: "The two passwords do not match.",
        unexpected: "Authentication failed. Try again later.",
        weak_password: "Password must be at least 8 characters.",
      },
    },
    support: {
      heroEyebrow: "Support the project",
      heroTitle: "Organize project opportunities architects and practices can pursue",
      heroIntro:
        "Arch Competition Ops tracks public notices and authority pages, then turns them into traceable opportunity intelligence for architecture firms. Support goes first into source coverage, qualification review, and team workflows.",
      heroActions: {
        primary: "See support options",
        secondary: "Browse the radar",
      },
      contact: {
        eyebrow: "Contact and repo",
        title: "Support, collaboration, or feedback can start here",
        body:
          "If you want to discuss support, suggest improvements, or review current progress first, send an email or open the public repository.",
        items: [
          {
            label: "Email",
            value: "fangxiaoyandi@gmail.com",
            href: "mailto:fangxiaoyandi@gmail.com",
          },
          {
            label: "Repository",
            value: "github.com/Enmani/arch-competition-ops",
            href: "https://github.com/Enmani/arch-competition-ops",
          },
        ],
      },
      principles: {
        eyebrow: "Position",
        title: "Core rules stay fixed",
        items: [
          {
            label: "Official-source first",
            value: "Official notices and authority pages stay above aggregators and reposts.",
          },
          {
            label: "Procurement-first",
            value: "The product is organized around screening and bid decisions.",
          },
          {
            label: "Multilingual support",
            value: "Product copy is structured for multilingual expansion for cross-border teams.",
          },
        ],
      },
      rationale: {
        eyebrow: "Why support",
        title: "Support goes here first",
        body:
          "Support goes into source coverage, qualification review, evidence handling, and the workflow after discovery.",
        points: [
          "Faster path from official notice to usable intelligence.",
          "Qualification gates earlier in the screening stage.",
        ],
      },
      tracks: {
        eyebrow: "Ways to support",
        title: "Three ways to support",
        intro:
          "Support is arranged through project-based partnerships for now.",
        items: [
          {
            eyebrow: "Studio pilots",
            title: "Studio pilot backing",
            summary:
              "For practices, business-development leads, and bid teams that want early influence on the product. Priority goes to screening, alerts, and qualification briefs.",
            points: [
              "Good fit for teams that want input before the workflow hardens.",
              "Runs as a defined pilot.",
            ],
            note: "Each pilot is scoped case by case.",
          },
          {
            eyebrow: "Authority distribution",
            title: "Organizer and institution distribution backing",
            summary:
              "For organizers, public institutions, and agency-side partners that need qualified reach after publication.",
            points: [
              "Built around professional reach.",
              "Funds verified distribution and reporting.",
            ],
            note: "Handled as a distribution partnership.",
          },
          {
            eyebrow: "Research and data",
            title: "Research and data partnerships",
            summary:
              "For schools, research institutions, foundations, and data partners.",
            points: [
              "Prioritizes source expansion and multilingual normalization.",
              "Keeps the public intelligence layer traceable and reusable.",
            ],
            note: "Partnership shape depends on research scope and data boundaries.",
          },
        ],
      },
      roadmap: {
        eyebrow: "Next phase",
        title: "Support funds these capabilities next",
        items: [
          {
            label: "Saved searches",
            value: "Turn recurring filters into persistent team radar.",
          },
          {
            label: "Qualification briefs",
            value: "Compress eligibility and risk into actionable pursuit summaries.",
          },
          {
            label: "Verified distribution",
            value: "Give authority-side partners a professional post-publication reach layer.",
          },
        ],
      },
      closing: {
        eyebrow: "Current status",
        title: "Support is handled project by project",
        body:
          "Public contact and payment options will be added later. For now, support is scoped around the partnership itself.",
        disclaimer:
          "Scope and materials are agreed case by case.",
        primary: "Back to support options",
        secondary: "Review the live opportunity surface",
      },
    },
    taxonomy: {
      statuses: {
        verified: "Verified",
        shortlisted: "Shortlisted",
        discovered: "Discovered",
        archived: "Archived",
        discarded: "Discarded",
      },
      jurisdictions: {
        global: "Global",
        eu: "EU",
        asia: "Asia",
        north_america: "North America",
        oceania: "Oceania",
        australia: "Australia",
        canada: "Canada",
        china: "China",
        italy: "Italy",
        france: "France",
        switzerland: "Switzerland",
        germany: "Germany",
        new_zealand: "New Zealand",
        netherlands: "Netherlands",
        czechia: "Czechia",
        bulgaria: "Bulgaria",
        slovenia: "Slovenia",
        norway: "Norway",
        poland: "Poland",
        portugal: "Portugal",
        belgium: "Belgium",
        spain: "Spain",
        united_kingdom: "United Kingdom",
        austria: "Austria",
        iberia: "Iberia",
        nordics: "Nordics",
        lithuania: "Lithuania",
        latvia: "Latvia",
        north_macedonia: "North Macedonia",
      },
      regions: {
        global: "Global",
        europe: "Europe",
        asia: "Asia",
        north_america: "North America",
        oceania: "Oceania",
        australia: "Australia",
        canada: "Canada",
        china: "China",
        germany: "Germany",
        italy: "Italy",
        france: "France",
        switzerland: "Switzerland",
        new_zealand: "New Zealand",
        netherlands: "Netherlands",
        norway: "Norway",
        portugal: "Portugal",
        belgium: "Belgium",
        spain: "Spain",
        united_kingdom: "United Kingdom",
        austria: "Austria",
        iberia: "Iberia",
        nordics: "Nordics",
      },
      opportunityTypes: {
        public_design_contest: "Public design contest",
        public_design_services_procurement: "Public design services procurement",
        framework_design_services: "Framework design services",
        negotiated_follow_on_services: "Negotiated follow-on services",
      },
      procedures: {
        design_contest: "Design contest",
        negotiated_procedure_after_contest: "Negotiated procedure after contest",
        public_design_services_tender: "Public design services tender",
        maitrise_d_oeuvre_procurement: "Maitrise d oeuvre procurement",
        planning_competition: "Planning competition",
        selective: "Selective procedure",
        framework_agreement: "Framework agreement",
        negotiated_procedure: "Negotiated procedure",
        adapted_procedure: "Adapted procedure",
        open: "Open procedure",
        "neg-w-call": "Negotiated procedure with call",
        "neg-wo-call": "Negotiated procedure without call",
      },
      implementationPaths: {
        winner_or_winners_progress_to_negotiated_service_award: "Winner or winners progress to negotiated service award",
        service_contract_award_after_competitive_selection: "Service contract award after competitive selection",
        framework_selection_for_repeated_design_commissions:
          "Framework selection for repeated design commissions",
        unknown: "Implementation path pending",
      },
      evidenceLevels: {
        official_notice: "Official notice",
        official_listing: "Official listing",
        authority_page: "Authority page",
        secondary: "Secondary source",
        tertiary: "Tertiary source",
      },
      projectTypes: {
        urban_regeneration: "Urban regeneration",
        environment_design: "Environmental design",
        urban_planning: "Urban planning",
        interior_project: "Interior project",
        building_project: "Building project",
      },
      buildingCategories: {
        healthcare: "Healthcare and hospitals",
        education: "Schools and education",
        housing: "Housing and residential",
        civic_public: "Civic and public buildings",
        sport_leisure: "Sports and leisure",
        culture_heritage: "Culture and heritage",
        transport_infrastructure: "Transport infrastructure",
      },
      designScopes: {
        interior_design: "Interior design",
        architectural_design: "Architectural design",
        scheme: "Scheme design",
        preliminary: "Preliminary design",
        construction_docs: "Construction documents",
        planning: "Detailed planning",
        design_service: "Design services",
      },
      projectModes: {
        new_build: "New build",
        renovation: "Renovation",
        extension: "Extension",
      },
      officialSectors: {
        building_construction: "Building construction",
        design_consulting: "Design consulting",
      },
      builtAssetTypes: {
        interior: "Interior",
        healthcare: "Healthcare",
        education: "Education",
        housing: "Housing",
        office_research: "Office and research",
        civic_culture: "Civic and culture",
        welfare: "Welfare and elderly care",
        hospitality_commercial: "Hospitality and commercial",
        land_use_planning: "Land-use planning",
        urban_renewal: "Urban renewal",
      },
      competitionTags: {
        architecture: "Architecture",
        landscape: "Landscape",
        interior: "Interior",
        adaptive_reuse: "Adaptive reuse",
        built_work: "Built work",
        housing: "Housing",
        pavilion: "Pavilion",
        healthcare: "Healthcare",
        masterplan: "Masterplan",
        public_building: "Public building",
        urban_design: "Urban design",
        education: "Education",
        infrastructure: "Infrastructure",
        professionals: "Professionals",
        multidisciplinary: "Multidisciplinary",
      },
      audiences: {
        students: "Students",
        young_architects: "Young architects",
        professionals: "Professionals",
        open: "Open",
        multidisciplinary: "Multidisciplinary",
      },
    },
  },
};

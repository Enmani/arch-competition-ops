/** Document metadata: titles, descriptions and Open Graph wording per route. */
export const meta = {
  siteName: "Arch Competition Ops",
  ogLocale: "zh_CN",
  description: "来自官方来源的公共设计机会，面向有资质的建筑师与事务所。",
  pages: {
    discover: {
      title: "设计机会列表",
      description: "按国家、截止日期、金额和资格要求筛选来自官方来源的公共设计机会。",
    },
    dashboard: {
      title: "工作台",
      description: "查看已观察的机会和已保存的筛选。",
    },
    ops: {
      title: "运维",
      description: "来源健康、解析失败与人工复核队列。",
    },
    support: {
      title: "支持项目",
      description: "了解项目如何运作，以及支持会优先投入哪里。",
    },
    login: {
      title: "登录",
      description: "登录后观察机会并保存筛选。",
    },
    register: {
      title: "注册",
      description: "创建账号，保存观察列表和筛选。",
    },
  },
  /** Detail page description: `{facts}` is the joined authority, place and deadline. */
  detailDescription: "{facts}。来源：官方公告与可追溯链接。",
  detailFallbackTitle: "机会详情",
};

import type { LegalSection } from "../legal-section";

const sections: LegalSection[] = [
  {
    id: "project",
    heading: "这是什么",
    paragraphs: [
      "Arch Competition Ops 是 {name} 制作的公益项目，帮助执业建筑师和设计团队更快找到政府和公共机构发布的设计采购与竞赛公告。",
      "网站每天自动更新两次。每条记录都尽量附上官方来源链接，方便你核对原文。",
      "这里的信息整理自公开来源，仅供参考。报名和投标请一律以官方公告为准。",
    ],
    items: [],
  },
  {
    id: "data",
    heading: "数据从哪里来",
    paragraphs: [
      "公告主要来自各国政府的官方采购平台，另有少量公共机构网站和汇总网站。汇总网站与官方来源不一致时，以官方来源为准，并在记录中注明差异。",
      "公告中没有写明的信息会留空或显示为“未知”，不作推断。",
    ],
    items: [],
  },
  {
    id: "reading",
    heading: "怎样看一条记录",
    paragraphs: ["一条记录里有两类内容，页面上分开显示："],
    items: [
      "官方字段：截止日期、金额、发布机构、资格要求等，按公告原文整理，并附原文链接。",
      "AI 筛选结论：AI 根据公告写出的项目概要和值得关注的原因，以及它判断项目是否值得建筑师关注。供快速筛选参考，可能有误。",
    ],
  },
  {
    id: "contact",
    heading: "联系",
    paragraphs: ["发现错误、想推荐数据来源，或有其他建议，欢迎来信。源代码公开在 GitHub。"],
    items: [],
  },
  {
    id: "legal",
    heading: "法律信息",
    paragraphs: ["使用规则、个人数据的处理方式和退款规则分别见以下页面。"],
    items: [],
  },
  {
    id: "cookies",
    heading: "Cookie 和本地存储",
    paragraphs: [
      "本站只在你的浏览器中保存下表列出的内容：登录所需的 Cookie，以及记住语言和主题的偏好。本站没有分析、广告或第三方跟踪，因此不需要征求 Cookie 同意。",
    ],
    items: [],
  },
];

export const about = {
  title: "关于本站",
  description: "Arch Competition Ops 是什么、数据从哪里来、如何联系，以及本站使用的 Cookie。",
  lede: "一个帮助建筑师查找公共设计项目的公益网站。",
  sections,
  cookies: {
    caption: "本站在浏览器中保存的内容",
    columns: { name: "名称", purpose: "用途", lifetime: "保存时间" },
    kinds: { cookie: "Cookie", localStorage: "本地存储" },
    purposes: {
      session: "保持登录状态。",
      locale: "记住你上次使用的语言，使不带语言的网址（如首页）用这种语言打开。",
      theme: "记住你选择的浅色或深色主题。",
    },
    when: {
      session: "只在登录后设置，退出登录时删除。",
      locale: "每次打开另一种语言的页面时设置。",
      theme: "选择浅色或深色时保存，改回“跟随系统”时删除。",
    },
    lifetime: { days: "{days} 天", untilChanged: "直到你更改设置或清除网站数据" },
    flagsLabel: "属性：{flags}",
    stripe: "付款和管理订阅的页面由 Stripe 托管，Stripe 会在这些页面设置自己的 Cookie。",
    stripeLink: "Stripe 隐私说明",
    reset: {
      button: "清除保存的偏好",
      hint: "清除语言 Cookie 和主题设置，登录状态不受影响。",
      done: "已清除。主题现在跟随设备设置；打开下一个页面时，本站会重新记住该页面的语言。",
    },
  },
};

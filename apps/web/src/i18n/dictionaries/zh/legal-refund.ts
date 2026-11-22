import type { LegalPageCopy } from "../legal-section";

export const refund: LegalPageCopy = {
  title: "退款政策",
  description: "Pro 订阅如何取消、什么情况可以退款、退款多久到账。",
  lede: "本政策适用于 Pro 套餐的按月和按年订阅。",
  sections: [
    {
      id: "cancel",
      heading: "随时取消",
      paragraphs: [
        "你可以随时在工作台打开客户中心取消订阅。取消后不再扣费，已付费的周期结束前仍可使用 Pro，之后回到免费 Key 套餐。",
      ],
      items: [],
    },
    {
      id: "first-payment",
      heading: "首次付款 14 天内可全额退款",
      paragraphs: [
        "某个套餐（按月或按年）第一次付款后的 14 天内，你可以要求全额退款。请从注册邮箱写信到 {email}，说明要退款的订阅。",
      ],
      items: [],
    },
    {
      id: "renewals",
      heading: "续订费用",
      paragraphs: ["续订产生的费用一般不退，以下两种情况除外："],
      items: ["法律要求退款。", "服务在该付费周期的大部分时间无法使用。"],
    },
    {
      id: "how",
      heading: "退款如何到账",
      paragraphs: ["退款经 Stripe 退回你付款时使用的方式，通常在 5 到 10 个工作日内到账，具体时间取决于你的银行。"],
      items: [],
    },
    {
      id: "plan",
      heading: "退款后的套餐",
      paragraphs: [],
      items: [
        "退还最近一期的全部费用：Pro 立即结束，账号回到免费 Key 套餐。",
        "只退还部分费用：Pro 保留到该期结束。",
      ],
    },
    {
      id: "withdrawal",
      heading: "欧盟消费者的撤回权",
      paragraphs: ["如果你是欧盟消费者，你依法享有的 14 天撤回权不受本政策影响。"],
      items: [],
    },
    {
      id: "contact",
      heading: "联系",
      paragraphs: ["关于付款或退款的问题，请写信到 {email}。"],
      items: [],
    },
  ],
};

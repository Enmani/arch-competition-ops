import { privacy } from "./legal-privacy";
import { refund } from "./legal-refund";
import { terms } from "./legal-terms";

export const legal = {
  updated: "最后更新：{date}",
  toc: "本页内容",
  links: {
    label: "法律信息",
    about: "关于",
    terms: "服务条款",
    privacy: "隐私说明",
    refund: "退款政策",
    cookies: "Cookie",
  },
  footer: {
    label: "网站信息",
    copyright: "© {year} {name}",
  },
  operator: {
    address: "地址",
    taxId: "税号",
    country: "国家",
  },
  garante: "在意大利，这一机构是意大利个人数据保护局（Garante per la protezione dei dati personali）。",
  planColumn: "套餐",
  cookiesLink: "查看 Cookie 列表",
  consent: {
    text: "创建账号即表示你同意{terms}和{privacy}。",
    terms: "服务条款",
    privacy: "隐私说明",
  },
  terms,
  privacy,
  refund,
};

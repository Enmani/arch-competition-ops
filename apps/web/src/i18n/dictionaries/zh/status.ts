/** Copy for the framework-level states: 404, error boundary, loading and 403. */
export const status = {
  notFound: {
    eyebrow: "404",
    title: "没有找到这个页面",
    body: "链接可能已过期，或该机会已被移除。",
    action: "返回机会列表",
  },
  error: {
    eyebrow: "出错了",
    title: "页面暂时无法显示",
    body: "这是我们这边的问题，不是你的操作有误。可以重试一次，若仍然失败请稍后再来。",
    retry: "重试",
    action: "返回机会列表",
    reference: "错误编号",
  },
  forbidden: {
    eyebrow: "403",
    title: "没有权限查看此页面",
    body: "运维页面只对管理员开放。如需访问，请联系管理员，或换用管理员账号登录。",
    action: "返回机会列表",
  },
  loading: {
    label: "正在加载",
  },
};

export const auth = {
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
    invalid_credentials: "邮箱或密码不正确。",
    invalid_email: "请输入有效邮箱。",
    missing_fields: "请填写所有字段。",
    password_mismatch: "两次输入的密码不一致。",
    registration_failed: "无法用这个邮箱完成注册。请检查填写内容；如果你已有账号，请直接登录。",
    too_many_attempts: "尝试次数过多，请稍后再试。",
    unexpected: "认证请求失败，请稍后重试。",
    weak_password: "密码至少需要 8 个字符。",
  },
};

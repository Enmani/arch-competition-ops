---
title: Port Script
status: 已完成
updated_at: 2026-04-20
related_docs:
  - AGENTS.md
  - docs/AI_CONSTRAINTS.md
  - README.md
---

# Port Script

脚本：`dev-port.ps1`

用途：
- 拉起本项目开发服
- 重启 `3400` 端口
- 停止当前 `3400` 端口
- 查看当前端口状态
- 避免误杀不是脚本自己启动的 `3400` 进程

最常用：

```powershell
.\dev-port.ps1
.\dev-port.ps1 restart
```

完整命令：

```powershell
.\dev-port.ps1 up
.\dev-port.ps1 restart
.\dev-port.ps1 stop
.\dev-port.ps1 status
```

如果本机限制脚本执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\dev-port.ps1 restart
```

说明：
- 默认端口固定为 `3400`
- `up` 会优先复用已存在的 `3400` 服务；如果该端口被外部进程占用，会直接报告状态，不会强制杀进程
- `restart` 和 `stop` 只会管理 `dev-port.ps1` 自己启动的开发服，不会误杀外部 `3400` 进程
- `status`、`up`、`stop`、`restart` 都会直接打印明确状态，不再静默返回
- 脚本会把受管开发服 PID 记录到 `artifacts\web-dev.pid.json`
- `stop` 和 `restart` 会按受管启动器进程树结束开发服，并在端口实际释放后才清理状态文件
- 启动后会做本地健康检查，而不是只盲等几秒
- 如果 Windows 把 `3400` 放进 excluded TCP range，脚本会直接报出端口范围并返回失败退出码
- 日志输出到 `artifacts\web-dev.out.log` 和 `artifacts\web-dev.err.log`
- 地址：`http://localhost:3400`

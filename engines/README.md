# 象棋引擎

把 Pikafish 放在这个目录下（可以带子目录），对弈场启动时会自动找到它，用于胜率条、着法质量评估和「Pikafish 守关」选手。

- 官方发布页：https://github.com/official-pikafish/Pikafish/releases
- 发布包是一个 7z 压缩包，里面有 Windows、Linux、macOS 各种 CPU 版本；对弈场会优先选当前系统的 universal 版。
- 放好后，在网页「设置 → 胜率评估」点「重新检测」，或重启服务。
- Pikafish 使用 GPL-3.0 许可证，对弈场只把它作为独立进程调用。

没有 Pikafish 时，胜率条用内置 AI 粗略估算，其他功能照常可用。

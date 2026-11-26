# 引擎

支持三个引擎：Pikafish（中国象棋）、Rapfi（五子棋）、Stockfish（国际象棋）。用 Docker 部署时只需要 Linux 版（容器里把 `./engines` 挂到 `/app/engines`）。

## Pikafish

把 Pikafish 放在这个目录下（可以带子目录），电子斗蛐蛐启动时会自动找到它，用于胜率条、着法质量评估和「Pikafish 守关」选手。

- 官方发布页：https://github.com/official-pikafish/Pikafish/releases
- 发布包是一个 7z 压缩包，里面有 Windows、Linux、macOS 的 universal 版和权重文件 `pikafish.nnue`；整包解压到这个目录的子目录里即可（权重文件要和程序放在一起）。Windows 可以用系统自带的 `tar -xf 文件名.7z` 解压。
- 测试过的版本：2026-09-06 版。
- 放好后，在网页「设置 → 胜率评估」点「重新检测」，或重启服务。
- Pikafish 使用 GPL-3.0 许可证，电子斗蛐蛐只把它作为独立进程调用。

没有 Pikafish 时，胜率条用内置 AI 粗略估算，其他功能照常可用。

## Rapfi

- 发布页：https://github.com/dhbloo/rapfi/releases ，测试过的版本：250615。整包解压到子目录，`config.toml` 和权重文件要和程序放在一起。
- 用 Piskvork 协议调用；Linux 用 `pbrain-rapfi-linux-clang-avx2`，需要 CPU 支持 AVX2。

## Stockfish

- 发布页：https://github.com/official-stockfish/Stockfish/releases ，测试过的版本：Stockfish 19（Windows 版和 Linux 版 `stockfish-linux-x86-64-universal`）。
- Stockfish 使用 GPL-3.0 许可证，同样只作为独立进程调用。

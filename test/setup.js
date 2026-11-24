// 全部测试共用的环境（package.json 里 node --import 先加载这个文件，测试子进程继承环境变量）：
// 框架在步与步之间按游戏要求停顿（公告动画、发言逐字打完），测试里缩成 0，不然整盘狼人杀要跑好几分钟
process.env.ARENA_PAUSE_SCALE ??= '0';

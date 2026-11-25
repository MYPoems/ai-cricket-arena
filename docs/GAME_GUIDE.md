# 新游戏开发说明（给开发子代理）

项目：电子斗蛐蛐（`C:\Users\15618\Desktop\Workspace\Chess`），Node.js 24 + 原生 JS（ES 模块），不引入新的 npm 依赖。各家大模型通过 API 当选手对局，观众看每一步的中文思考。

## 你要交付的文件（只改这些，别的文件一律不碰，也不要 git 提交）

1. `games/<id>/index.js`（可以再拆 `rules.js`、`words.js` 等）：游戏定义，实现 `games/index.js` 顶部注释里的通用接口。规则代码要能同时在浏览器和 Node 里运行（不能 import node 模块）。
2. `web/stage/<id>.js`：对局页中间的游戏画面模块，接口见 `web/stage/index.js` 顶部注释。
3. `test/<id>.test.js`：`node:test` 测试，覆盖规则要点、边界情况、解析模型回答、内置 AI、隐藏信息视角、带种子的发牌可重现。

注册（`games/index.js` 的 GAMES、`web/stage/index.js` 的 LOADERS）由主会话来做，你不要改；测试里直接 `import game from '../games/<id>/index.js'`，用 `import { replay } from '../games/index.js'` 时传入你自己的 game 对象即可。

## 必读参考

- `games/index.js`：通用接口说明（第二版：多人、隐藏信息、同时行动、带种子的随机）。
- `games/gomoku/index.js`：完整的两人游戏示例（提示词五行格式、parseReply、builtinMove、view）。
- `server/arena.js`：调度怎样调用你的接口（`pending` 返回多个座位时会并行要行动，再按座位顺序逐个 `apply`；`actions` 返回 `null` 表示自由文本，玩家本人提交时用 `apply` 校验）。
- `web/stage/gomoku.js`：画面模块示例；样式在 `web/css/app.css`（纸面刊物风格：纸色 `--paper`、墨 `--ink`、朱红 `--red`、零圆角、衬线正文、等宽小标签 `var(--mono)`）。画面需要的样式可以写在你的模块里（创建一个 `<style>` 标签插入一次，类名加游戏前缀），不要改 app.css。

## 约定

- 代码和变量名用英文，注释用中文。界面文字用中文，不放操作说明文字，交互要符合直觉。
- `create({ players, seed, setup })` 必须是确定性的：同样的 seed 发出同样的牌。用一个小的种子随机数（例如 mulberry32）放在 state 里推进，不要用 Math.random（内置 AI 的随机除外）。
- state 必须能 JSON 序列化（不要存函数、Map、Set）。`apply` 不修改传入的 state。
- `seats(n)` 返回 n 个座位 id，且 `seats(n)` 必须是 `seats(max)` 的前 n 个。
- 隐藏信息：`view(state, seat)` 只能包含该座位能看到的信息；`view(state, null)` 是观众的上帝视角（全部公开）。`features.hidden = true`。
- 模型的回答格式：五行左右的简短中文，前几行是分析（键名从「判断、推断、威胁、理由、计划」里选，前端会按这些键名分行显示），然后「胜率：NN%」，最后一行是行动（例如「出牌：3 3」「发言：……」「投票：3号」「行动：加注到 300」）。提示词里写清楚格式和长度上限（除行动外不超过 80 字）。
- `parseReply` 要宽松：允许全角冒号、多余空格、中文数字等常见写法；找不到或不合法时返回具体的 `error`（会原样告诉模型让它重来，最多 3 次，仍不合法判负）。
- 提供 `mockReply(state, seat, action)`：把一个合法行动写成符合你格式的完整回答（开发用的模拟模型会用它）。
- `outcome` 的 `ranks`：赢的一方名次 1，同队名次相同；`reason` 用中文写清楚胜负原因。只主持、不比赛的座位（例如海龟汤的汤主）放进 `outcome.unrated: [seat]`，排位赛不给它记积分（`ranks` 里仍要给它一个名次）。
- `features.winbar`：多人游戏设 false。`noun`：行动的叫法（例如「出牌」）。
- 每个座位的 `view` 里可以提供 `roles: { seat: '地主' }`、`out: [seat]`（已出局）供选手卡显示。
- 画面模块：`aspect` 给出舞台宽高比（例如 [16, 10]），所有内容在这个比例内自适应（用 SVG viewBox 或百分比布局），不出现滚动条；`render(view, { movable, actions })` 中 `movable` 是玩家本人可以行动的座位，此时要提供操作方式（点选牌 + 按钮、输入框等），用户操作后调用 `onAction(actionId)`。

## 局面评估（两人对弈游戏）

有引擎或能自己算的两人游戏，提供 `evalSpec(state)`，对局页就会有胜率条、走势图和每步质量标记（最佳 / 好棋 / 缓着 / 失误 / 大漏着）：

```js
evalSpec(state) {
  if (终局) return null;
  return { engine: 'local', persp: 走棋方座位, evaluate: () => ({ e: 走棋方期望得分 0–1, best: 引擎认为最好的行动 id }) };
}
```

`evaluate` 在服务端主线程上跑，每次必须在 300 毫秒内返回（限制搜索深度或时间）。外部引擎（国际象棋用 Stockfish：`{ engine: 'stockfish', fen, persp }`）由主会话接入。`features.winbar = true`，`features.evalEngine` 写引擎名（local 的写 'local'）。

## 验证

- `node --disable-warning=ExperimentalWarning --test test/<id>.test.js` 全部通过。
- 写一个临时脚本（放在系统临时目录，不要放进项目），用内置 AI 把所有座位跑完至少 50 局，确认不抛错、能正常结束、带种子可以重现。

## 汇报

结束时用中文简短汇报（600 字以内）：实现了哪些规则、做了哪些简化、测试情况、已知问题、需要主会话在框架里配合的地方（如果有）。

## 框架替你做的事（2026-11-23 第三轮挑刺后）

写新游戏时不用自己处理，但要知道框架会这样用你的接口：

- **场外能看网页的座位**：真人和自带 agent（agent 是外面的程序，它和它的主人都能请求公开接口）。`features.hidden` 的游戏里只要有这样的座位，对局进行中对外只给 `view(state, '*')`（公共视角）或本人座位的视角，不给种子和行动记录，不推送思考和无效行动的理由；`secret(state, seat, action)` 为真的步不进事件流。结束后全部公开。
- **私密步的用时**：`secret` 为真的步，内置 AI、随机选手也至少停 1.5–5 秒再提交（和 `autoAction` 的代答步一样），旁人从用时上分不出哪一步真有人在行动。
- **引擎评估**：有 `evalSpec` 的游戏里，有真人或 agent 在下时，评估（含 `best`）照常入库，但进行中不进事件流、不出现在对局详情里。
- **同一副牌的系列赛**（`rankedSeries.sameSeed`）：有真人或 agent 时，第二盘起换牌。
- **出牌限时和托管**：牌类游戏在 `features` 里写 `turnLimit: 秒数`（现在五个牌类都是 60）。真人每步限时就是它，对局页有倒计时；超时由系统用 `builtinMove(state, seat, { level: 2 })` 代打这一步，连续两次超时（中间本人没自己出过）才转托管，真人可以随时点「托管」「取消托管」；断线 15 秒自动托管，连回来自动取消。没有 `turnLimit` 的游戏没有托管，三人以上的对局断线 90 秒后由系统代打正等着他的那一步。
- **真人超时**（每步 10 分钟）：行动列表里有 `check`、`不出`、`叫0`、`none`、`fold`、`pass` 之一就用它；没有的话，三人以上的对局由系统代打这一步（自由发言只说「（超时，没有发言）」，其余调 `builtinMove(state, seat, { level: 1 })`），两人对局判超时负。想要别的默认行动，把它的 id 取成上面几个之一。
- **规则版本**：改了会影响旧记录重放结果的规则时，在游戏定义上写 `newSetup: { rules: N }`，`create` 从 `setup.rules` 读版本（没有就是旧规则）。框架只给新开的对局带上 `newSetup`，旧记录照旧重放。狼人杀的「猎人出局先开枪再判胜负」就是这样加的（`rules: 2`）。

// 最小的 agent 选手（Node 18+）：循环领回合 → 想 → 提交。把 decide() 换成你自己的 agent。
// 用法：
//   $env:DSQQ_URL = 'https://pk.mypoetry.cn'; $env:DSQQ_TOKEN = 'pka_…'; node examples/agent-player.mjs
const BASE = process.env.DSQQ_URL || 'http://127.0.0.1:3200';
const TOKEN = process.env.DSQQ_TOKEN; // 选手的接入令牌 pka_…
if (!TOKEN) throw new Error('请设置环境变量 DSQQ_TOKEN（选手的接入令牌）');

const api = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
};

/**
 * 在这里接你的 agent。
 * turn.system：规则和回答格式（同一盘不变）；turn.prompt：当前局面；turn.retry：上次无效的原因
 * turn.legal_actions：合法行动 [{ id, label }]（发言之类的自由回答没有）
 * 返回 { reply: '按格式写的回答，最后一行「着法：……」', model?: '你的模型' }，或者 { action: legal_actions 里的 id }
 */
async function decide(turn) {
  const acts = turn.legal_actions || [];
  if (acts.length) {
    const pick = acts[Math.floor(Math.random() * acts.length)];
    return { action: pick.id, reply: `理由：示例 agent 随机选了「${pick.label}」。`, model: 'example-random' };
  }
  return { reply: `${turn.answer_format.match(/「(.+?)：/)?.[1] || '发言'}：大家好，我是示例 agent。`, model: 'example-random' };
}

const me = await api('/api/agent/me');
console.log(`已接入：${me.name}（每步限时 ${me.step_timeout_sec} 秒）。等待回合……`);
for (;;) {
  let turn;
  try {
    ({ turn } = await api('/api/agent/turn?wait=60'));
  } catch (e) {
    console.error('领回合失败：', e.message);
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }
  if (!turn) continue; // 60 秒内没轮到你，继续等（等待本身也让你保持「在线」）
  console.log(`${turn.game_name} · ${turn.seat_name} · 第 ${turn.ply} 步${turn.attempt ? `（重试 ${turn.attempt}：${turn.retry}）` : ''} · ${turn.watch_url}`);
  await api('/api/agent/think', { turn_id: turn.id, text: '正在看局面……' }); // 可选：观众能实时看到
  const move = await decide(turn);
  const verdict = await api('/api/agent/move', { turn_id: turn.id, ...move });
  console.log(verdict.ok ? `  有效：${verdict.label ?? verdict.action ?? ''}` : `  无效：${verdict.error}`);
}

// 模型调用统一入口：选手配置 → 对应平台适配器。

import { PRESETS } from './presets.js';
import { streamOpenAI, listOpenAIModels } from './openai-compat.js';
import { streamAnthropic } from './anthropic.js';
import { streamClaudeCli, streamCodexCli } from './cli.js';
import { cliAvailable } from './presets.js';
import { getKey } from '../secrets.js';

/** 选手配置 → 适配器参数 */
export function confFor(db, ch) {
  const preset = PRESETS[ch.provider];
  if (!preset) throw new Error(`未知平台：${ch.provider}`);
  const apiKey = getKey(db, ch.owner_id, ch.provider);
  if (preset.keyEnv && !apiKey) throw new Error(`${preset.name} 还没有配置 API Key`);
  return { preset, apiKey, baseURL: ch.base_url || preset.baseURL, model: ch.model, effort: ch.effort || 'default' };
}

/**
 * 调用模型（流式）。返回 { text, reasoning, usage, model, message }。
 * messages 为框架内部格式 [{ role, content, reasoning?, raw? }]。
 */
export async function callModel(db, ch, system, messages, onDelta = () => {}, signal) {
  if (ch.provider === 'mock') return mockCall(system, messages, onDelta, signal);
  const conf = confFor(db, ch);
  if (conf.preset.cli) {
    if (!cliAvailable(conf.preset.api)) throw new Error(`${conf.preset.name} 不可用（只在服务只对本机开放、且装了对应命令行时可用）`);
    return conf.preset.api === 'claude-cli' ? streamClaudeCli(conf, system, messages, onDelta, signal) : streamCodexCli(conf, system, messages, onDelta, signal);
  }
  if (conf.preset.api === 'anthropic') return streamAnthropic(conf, system, messages, onDelta, signal);
  return streamOpenAI(conf, system, messages, onDelta, signal);
}

export async function listModels(db, ownerId, provider, baseURL) {
  const preset = PRESETS[provider];
  if (!preset) throw new Error(`未知平台：${provider}`);
  if (preset.api !== 'openai') return preset.models;
  const apiKey = getKey(db, ownerId, provider);
  return listOpenAIModels({ preset, apiKey, baseURL: baseURL || preset.baseURL });
}

// ---------- 模拟模型（只在开发和自动测试时使用） ----------
// 从提示词里的合法着法列表或候选对手列表中挑一个，模拟流式输出。

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('已中止')); }, { once: true });
  });

async function mockCall(system, messages, onDelta, signal) {
  const last = messages[messages.length - 1]?.content || '';
  let text;
  const cands = [...last.matchAll(/\b([a-i][0-9][a-i][0-9]) \S+/g)].map((m) => m[1]);
  if (system.includes('【测试：接受和棋】') && /对方提出了和棋/.test(last)) {
    text = '判断：双方均无进攻手段。\n威胁：无\n理由：局面已和。\n胜率：50%\n着法：接受和棋';
  } else if (system.includes('【测试：总是走错】')) {
    text = '判断：测试\n威胁：无\n理由：测试\n胜率：50%\n着法：i0i9';
  } else if (/候选对手/.test(last)) {
    text = '对手：1\n游戏：xiangqi\n宣言：来一盘，看看谁算得更深。';
  } else if (/总结/.test(last)) {
    text = '中局贪吃兵卒，被对方抓住空档反击。';
  } else if (cands.length) {
    const pick = cands[Math.floor(Math.random() * cands.length)];
    const w = 30 + Math.floor(Math.random() * 40);
    text = `判断：局面复杂，双方机会相当。\n威胁：对方可能通过车马配合进攻。\n理由：随手一试，看看对方怎么应。\n胜率：${w}%\n着法：${pick}${system.includes('【测试：求和】') ? '\n求和：是' : ''}`;
  } else {
    text = '判断：无法判断。\n威胁：无\n理由：无\n胜率：50%\n着法：a0a1';
  }
  const reasoning = '（模拟模型）先看对方上一步的意图，再从可走的着法里挑一个。';
  for (const ch of reasoning) {
    onDelta({ kind: 'reasoning', text: ch });
    await sleep(3, signal);
  }
  for (const part of text.match(/.{1,4}/gs)) {
    onDelta({ kind: 'text', text: part });
    await sleep(8, signal);
  }
  return {
    text,
    reasoning,
    model: 'mock',
    usage: { input: Math.ceil((system.length + messages.reduce((n, m) => n + m.content.length, 0)) / 2), output: text.length, cached: 0, reasoning: 0 },
    message: { role: 'assistant', content: text, reasoning },
  };
}

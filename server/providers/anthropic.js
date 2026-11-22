// Claude 适配器（官方 @anthropic-ai/sdk）。
//
// - 新模型不返回原始推理过程，用 display: "summarized" 拿推理摘要。
// - 推理强度通过 output_config.effort 控制；Claude Opus 5.5 不能关闭思考。
// - 多轮对话时，上一轮的思考块必须原样回传，所以 message.raw 保存完整的 content。
// - 开启服务端 fallbacks（模型拒答时由平台换一个模型继续），实际服务的模型记在 model 字段里，
//   这样对局记录能看出哪一步不是角色配置的模型下的。

import Anthropic from '@anthropic-ai/sdk';

export async function streamAnthropic(conf, system, messages, onDelta, signal) {
  const client = new Anthropic({ apiKey: conf.apiKey, maxRetries: 2, timeout: conf.timeoutMs || 180000 });
  const msgs = messages.map((m) =>
    m.role === 'assistant' && m.raw ? { role: 'assistant', content: m.raw } : { role: m.role, content: m.content },
  );
  const effort = conf.effort && conf.effort !== 'default' ? conf.effort : null;
  const fallbackOK = /^claude-(opus-5-5|sonnet-5-5|fable-5-2|fable-5-1|opus-5)$/.test(conf.model);

  const stream = client.beta.messages.stream(
    {
      model: conf.model,
      max_tokens: conf.maxTokens || 16000,
      thinking: { type: 'adaptive', display: 'summarized' },
      ...(effort ? { output_config: { effort } } : {}),
      cache_control: { type: 'ephemeral' }, // 自动缓存最后一个可缓存块：整局对话前缀不变，命中率高
      system,
      messages: msgs,
      ...(fallbackOK ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    },
    { signal },
  );

  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'thinking_delta') onDelta({ kind: 'reasoning', text: event.delta.thinking });
      else if (event.delta.type === 'text_delta') onDelta({ kind: 'text', text: event.delta.text });
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    const err = new Error(`模型拒绝回答（${final.stop_details?.category || '未说明原因'}）`);
    err.refusal = true;
    throw err;
  }
  const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const reasoning = final.content.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('\n');
  const u = final.usage || {};
  return {
    text,
    reasoning,
    model: final.model,
    usage: {
      input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      output: u.output_tokens || 0,
      cached: u.cache_read_input_tokens || 0,
      reasoning: 0,
    },
    message: { role: 'assistant', content: text, reasoning, raw: final.content },
  };
}

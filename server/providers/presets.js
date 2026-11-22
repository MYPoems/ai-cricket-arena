// 各平台预置模板。模型 ID、参数名都来自 2026-11-22 查阅的各家官方文档；
// 平台更新后可以在界面上直接改模型 ID，或用「获取模型列表」从接口拉取。
//
// effort：对弈场统一的推理强度三档 low / medium / high，default 表示不传参数（用平台默认）。
// thinkingParams(effort) 返回要合并进请求体的平台专有参数。

export const EFFORTS = { default: '平台默认', low: '低', medium: '中', high: '高' };

const effortParam = (map) => (effort) => (map[effort] ? { reasoning_effort: map[effort] } : {});

export const PRESETS = {
  deepseek: {
    name: 'DeepSeek',
    api: 'openai',
    baseURL: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-v4-pro', 'deepseek-flash'],
    reasoningField: 'reasoning_content',
    // 思考默认开启；强度取值 low / high / max
    thinkingParams: effortParam({ low: 'low', medium: 'high', high: 'max' }),
    echoReasoning: false, // 不带工具时不需要回传思考内容
  },
  kimi: {
    name: 'Kimi',
    api: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    keyEnv: 'MOONSHOT_API_KEY',
    models: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3'],
    reasoningField: 'reasoning_content',
    thinkingParams: effortParam({ low: 'low', medium: 'high', high: 'max' }),
    echoReasoning: true, // 官方要求把整条 assistant 消息（含思考内容）原样回传
    minMaxTokens: 16000,
  },
  qwen: {
    name: '通义千问',
    api: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyEnv: 'DASHSCOPE_API_KEY',
    models: ['qwen4-max', 'qwen3.7-plus', 'qwen3.8-flash'],
    reasoningField: 'reasoning_content',
    thinkingParams: (effort) => {
      const budget = { low: 1024, medium: 4096, high: 16384 }[effort];
      return budget ? { enable_thinking: true, thinking_budget: budget } : {};
    },
    echoReasoning: false,
    note: '百炼新版推荐用工作空间专属地址 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1，可在选手配置里改。',
  },
  glm: {
    name: '智谱 GLM',
    api: 'openai',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    keyEnv: 'ZAI_API_KEY',
    models: ['glm-5.3', 'glm-5.2', 'glm-5.3-flash'],
    reasoningField: 'reasoning_content',
    thinkingParams: (effort) => (effort === 'default' ? {} : { thinking: { type: 'enabled' } }),
    echoReasoning: false,
  },
  doubao: {
    name: '豆包（火山方舟）',
    api: 'openai',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    keyEnv: 'ARK_API_KEY',
    models: ['doubao-seed-2-1-pro-260915', 'doubao-seed-2-1-lite-260915', 'doubao-seed-2-0-mini-260428'],
    reasoningField: 'reasoning_content',
    thinkingParams: effortParam({ low: 'low', medium: 'medium', high: 'high' }),
    echoReasoning: false,
  },
  siliconflow: {
    name: '硅基流动',
    api: 'openai',
    baseURL: 'https://api.siliconflow.cn/v1',
    keyEnv: 'SILICONFLOW_API_KEY',
    models: ['Pro/deepseek-ai/DeepSeek-V3.2'],
    reasoningField: 'reasoning_content',
    thinkingParams: (effort) => {
      const budget = { low: 1024, medium: 4096, high: 16384 }[effort];
      return budget ? { enable_thinking: true, thinking_budget: budget } : {};
    },
    echoReasoning: false,
  },
  openrouter: {
    name: 'OpenRouter',
    api: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    models: [],
    reasoningField: 'reasoning_details',
    thinkingParams: (effort) => (effort === 'default' ? {} : { reasoning: { effort } }),
    echoReasoning: false,
  },
  openai: {
    name: 'OpenAI',
    api: 'openai',
    baseURL: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    models: ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6-luna'],
    reasoningField: null, // Chat Completions 不返回思考内容
    thinkingParams: effortParam({ low: 'low', medium: 'medium', high: 'high' }),
    echoReasoning: false,
  },
  gemini: {
    name: 'Google Gemini',
    api: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    keyEnv: 'GEMINI_API_KEY',
    models: ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-3.8-flash'],
    reasoningField: null,
    thinkingParams: effortParam({ low: 'low', medium: 'medium', high: 'high' }),
    echoReasoning: false,
  },
  ollama: {
    name: 'Ollama（本地）',
    api: 'openai',
    baseURL: 'http://localhost:11434/v1',
    keyEnv: null, // 本地不需要密钥
    models: [],
    reasoningField: 'reasoning',
    thinkingParams: effortParam({ low: 'low', medium: 'medium', high: 'high' }),
    echoReasoning: false,
    local: true,
  },
  anthropic: {
    name: 'Claude（Anthropic）',
    api: 'anthropic',
    baseURL: null,
    keyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    reasoningField: 'thinking',
    echoReasoning: true, // 思考块需要原样回传
  },
  custom: {
    name: '自定义 OpenAI 兼容接口',
    api: 'openai',
    baseURL: '',
    keyEnv: null,
    models: [],
    reasoningField: 'reasoning_content',
    thinkingParams: () => ({}),
    echoReasoning: false,
    custom: true, // 只能下娱乐赛
  },
};

/** 排位赛只允许平台列出的云端模型；本地 Ollama 和自定义接口只能下娱乐赛 */
export const rankedAllowed = (providerId) => {
  const p = PRESETS[providerId];
  return !!p && !p.local && !p.custom;
};

export function presetList() {
  return Object.entries(PRESETS).map(([id, p]) => ({
    id, name: p.name, api: p.api, baseURL: p.baseURL, models: p.models,
    needsKey: !!p.keyEnv || p.custom, ranked: rankedAllowed(id), note: p.note || '',
    showsReasoning: !!p.reasoningField,
  }));
}

// 对称座位版式（狼人杀、谁是卧底）：模拟多盘对局，逐步检查 duoView 在玩家视角下不泄露隐藏信息

import test from 'node:test';
import assert from 'node:assert/strict';
import ww from '../games/werewolf/index.js';
import uc, { setWordBank } from '../games/undercover/index.js';
import { PAIRS, HINTS } from '../server/words/undercover.js';
import wwR from '../web/stage/werewolf.js';
import ucR from '../web/stage/undercover.js';

setWordBank({ PAIRS, HINTS });

let checks = 0, fails = 0;
const fail = (msg) => { fails++; if (fails < 20) console.log('FAIL', msg); };

function runWW(n, seed) {
  let s = ww.create({ players: n, seed });
  for (let step = 0; step < 400 && s.phase !== 'over'; step++) {
    for (const v of s.seats) {
      const view = ww.view(s, v);
      if (view.god) continue;
      const acts = ww.actions(s, v);
      const movable = ww.pending(s).includes(v) ? v : null;
      const dv = wwR.duoView(view, { movable, actions: movable ? acts : null, viewer: v });
      const myRole = s.roles[v];
      const wolves = s.seats.filter((x) => s.roles[x] === 'wolf');
      for (const x of s.seats) {
        const info = dv.seats[x];
        checks++;
        if (x !== v && info.role) {
          const ok = (myRole === 'wolf' && wolves.includes(x) && info.role.text === '狼人')
            || (myRole === 'seer' && ['查杀', '金水'].includes(info.role.text) && s.checks.some((c) => c.target === x));
          if (!ok) fail(`ww 视角 ${v}(${myRole}) 看到 ${x} 身份 ${info.role.text}`);
        }
        if (x === v && info.role?.text !== { wolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', villager: '村民' }[myRole]) fail(`ww 自己身份错 ${v}`);
        const st = info.state.split(' ');
        if (st.includes('lit')) {
          const ok = x === v || (myRole === 'wolf' && wolves.includes(x));
          if (!ok) fail(`ww 视角 ${v}(${myRole}) 夜里看到 ${x} 亮着（阶段 ${s.phase}）`);
        }
        if (view.night && st.includes('speaking') && x !== v && !(myRole === 'wolf' && wolves.includes(x))) fail(`ww 视角 ${v} 夜里看到 ${x} 在行动`);
        if (info.pick && movable !== v) fail('ww 非行动者有 pick');
      }
      // 投票中玩家视角座位卡不显示别人的票
      if ((s.phase === 'vote' || s.phase === 'revote')) for (const x of s.seats) if (dv.seats[x].votes) fail(`ww 投票中显示票数 ${x}`);
      const txt = JSON.stringify(dv.scene);
      if (view.night && /狼人行动|预言家查验|女巫用药/.test(txt) && !movable && !(myRole === 'wolf' && s.phase === 'wolf')) fail(`ww 场景泄露夜间阶段 ${txt} 视角 ${v}(${myRole})`);
    }
    // 上帝视角也跑一遍，确保不报错
    wwR.duoView(ww.view(s, null), {});
    const who = ww.pending(s)[0];
    s = ww.apply(s, who, ww.builtinMove(s, who));
  }
  // 终局
  for (const v of s.seats) wwR.duoView(ww.view(s, v), {});
}

function runUC(n, seed) {
  let s = uc.create({ players: n, seed });
  for (let step = 0; step < 400 && s.phase !== 'over'; step++) {
    for (const v of s.seats) {
      const view = uc.view(s, v);
      const movable = uc.pending(s).includes(v) ? v : null;
      const dv = ucR.duoView(view, { movable, actions: movable ? uc.actions(s, v) : null, viewer: v });
      const outs = s.out.map((o) => o.seat);
      for (const x of s.seats) {
        const info = dv.seats[x];
        checks++;
        if (x !== v && !info.word.back) fail(`uc 视角 ${v} 看到 ${x} 的词`);
        if (x === v && info.word.text !== s.words[v]) fail('uc 自己的词不对');
        if (info.role && !outs.includes(x)) fail(`uc 视角 ${v} 看到未出局 ${x} 的身份`);
      }
      if ((s.phase === 'vote' || s.phase === 'revote')) for (const x of s.seats) if (dv.seats[x].votes) fail('uc 投票中显示票数');
      if (JSON.stringify(dv).includes(s.pair.spy) && s.words[v] !== s.pair.spy && !s.speeches.some((x) => x.text.includes(s.pair.spy))) fail(`uc 卧底词泄露 ${s.pair.spy} ${JSON.stringify(dv).slice(0,300)}`);
      if (JSON.stringify(dv).includes(s.pair.civ) && s.words[v] !== s.pair.civ && !s.speeches.some((x) => x.text.includes(s.pair.civ))) fail('uc 平民词泄露');
    }
    ucR.duoView(uc.view(s, null), {});
    const who = uc.pending(s)[0];
    s = uc.apply(s, who, uc.builtinMove(s, who));
  }
}

test('狼人杀：玩家视角的座位卡和场景不泄露身份、夜间行动、未公开的票', () => {
  for (let seed = 1; seed <= 8; seed++) for (const n of [6, 7, 8, 9]) runWW(n, seed);
  assert.equal(fails, 0);
  assert.ok(checks > 1000);
});

test('谁是卧底：玩家视角看不到别人的词和未出局者的身份', () => {
  for (let seed = 1; seed <= 8; seed++) for (const n of [4, 5, 6, 7, 8]) runUC(n, seed);
  assert.equal(fails, 0);
});

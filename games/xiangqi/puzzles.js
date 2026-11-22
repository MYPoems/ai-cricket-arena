// 同题对比用的内置题目。fen 直接给局面；moves 表示从开局走若干步得到的局面。

export const PUZZLES = [
  { id: 'opening', title: '开局第一步', desc: '红方先走，标准开局。', fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1' },
  { id: 'pingfeng', title: '中炮对屏风马', desc: '炮二平五 马８进７ 马二进三 车９平８ 车一平二 马２进３ 之后，红方走。', moves: ['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b9c7'] },
  { id: 'two-rooks', title: '双车一步杀', desc: '红方一步将死黑方。', fen: '4k4/1R7/9/9/9/9/9/9/9/R2K5 w - - 0 1' },
  { id: 'horse-cannon', title: '马后炮', desc: '红方一步将死黑方。', fen: '4k4/R8/4N4/9/9/9/7C1/9/9/3K5 w - - 0 1' },
  { id: 'defend', title: '双车压境', desc: '黑方走，面对红方双车的压力。', fen: '3ak4/1R7/9/9/9/9/9/9/9/R2K5 b - - 0 1' },
];

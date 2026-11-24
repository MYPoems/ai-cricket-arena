// 自定义接口地址的出站检查：普通用户填的地址不能指向服务器本机或内网。
//
// 「自定义 OpenAI 兼容接口」和「Ollama」的地址由用户填，服务端会替他去请求（测试连接、拉模型列表、对局里每一步），
// 响应内容和报错还会回给他。不拦的话，任何审批通过的账号都能拿这台服务器当跳板去探内网、读内网服务的响应。
// 庄家（服务器的主人）不受限：本机 Ollama、内网中转都是他自己的东西。
//
// 已知边界：这里在发请求前解析一次域名，SDK 发请求时会再解析一次；两次之间把域名改指内网（DNS 重绑定）拦不住。
// 请求不跟随跳转（见 openai-compat.js），公网地址跳到内网这条路是堵上的。

import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';

const blocked = new BlockList();
for (const [addr, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]]) blocked.addSubnet(addr, bits, 'ipv6');

/** 这个 IP 是不是本机、内网、链路本地之类不该由普通用户指过去的地址（IPv4 映射的 IPv6 按 IPv4 判断） */
export function isPrivateAddress(address) {
  const fam = isIP(address);
  if (!fam) return true; // 认不出来的一律当作不安全
  return blocked.check(address, fam === 6 ? 'ipv6' : 'ipv4');
}

export const PRIVATE_URL_ERROR = '这个接口地址指向服务器本机或内网，只有庄家可以用这样的地址';

/** 地址必须是 http(s)，而且解析出来的每个 IP 都是公网地址；否则抛错 */
export async function assertPublicURL(url, resolve = lookup) {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error('接口地址不合法'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('接口地址必须以 http:// 或 https:// 开头');
  if (u.username || u.password) throw new Error('接口地址里不能带用户名和密码');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  if (isIP(host)) addrs = [{ address: host }];
  else {
    try { addrs = await resolve(host, { all: true }); } catch { throw new Error(`接口地址的域名解析不了：${host}`); }
  }
  if (!addrs?.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error(PRIVATE_URL_ERROR);
}

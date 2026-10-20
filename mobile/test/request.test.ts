/* request.ts のテスト：node --experimental-strip-types test/request.test.ts */
import { buildCompletion, checkRequest, countSessions, createThrottle, parseBridgeMessage, wasTruncated, BridgeError, type RunRequest } from '../src/ai/request.ts';

let passes = 0;
let failures = 0;
function check(cond: unknown, name: string) {
  if (cond) passes++;
  else {
    failures++;
    console.log('  ✗ ' + name);
  }
}
function eq(a: unknown, b: unknown, name: string) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  check(ok, name + (ok ? '' : '\n      実際: ' + JSON.stringify(a) + '\n      期待: ' + JSON.stringify(b)));
}

console.log('■ メッセージの確かめ');
{
  eq(parseBridgeMessage('not json'), null, 'JSON でない');
  eq(parseBridgeMessage('{"t":"hello"}'), { t: 'hello' }, 'hello');
  eq(parseBridgeMessage('{"t":"ai.stop"}'), null, 'id のない stop');
  eq(parseBridgeMessage('{"t":"evil","id":"x"}'), null, '知らない種類');
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const m = parseBridgeMessage(JSON.stringify({
    t: 'ai.run', id: 'r1', mode: 'json', task: 'suggest_units', system: 'SYS',
    messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'こんにちは' }, { role: 'user', content: 3 }],
    images: [png, 'http://evil/x.png', 'data:text/html;base64,AAAA', png, png], schema: { type: 'object' },
  })) as RunRequest;
  eq([m.mode, m.task, m.messages.length, m.images.length], ['json', 'suggest_units', 1, 2], '役割・写真の形・枚数を制限');
  const m2 = parseBridgeMessage(JSON.stringify({ t: 'ai.run', id: 'r2', mode: 'weird', task: 'hack', messages: [{ role: 'user', content: 'a' }], schema: [1] })) as RunRequest;
  eq([m2.mode, m2.task, m2.schema, m2.system], ['text', 'other', null, ''], '知らない値は安全な既定に');
}

console.log('■ 指示の長さ');
{
  const base: RunRequest = { t: 'ai.run', id: 'a', mode: 'text', task: 'chat', system: '', messages: [{ role: 'user', content: 'q' }], images: [], schema: null };
  let threw = '';
  try { checkRequest({ ...base, messages: [] }); } catch (e) { threw = (e as BridgeError).code; }
  eq(threw, 'bad_request', '発言がない');
  threw = '';
  try { checkRequest({ ...base, messages: [{ role: 'user', content: 'x'.repeat(70000) }] }); } catch (e) { threw = (e as BridgeError).code; }
  eq(threw, 'too_long', '長すぎる');
  threw = '';
  try { checkRequest({ ...base, messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] }); } catch (e) { threw = (e as BridgeError).code; }
  eq(threw, 'bad_request', '最後が AI の発言');
}

console.log('■ llama.rn に渡す引数');
{
  const req: RunRequest = {
    t: 'ai.run', id: 'a', mode: 'json', task: 'session_advice', system: 'あなたは学習アドバイザー',
    messages: [{ role: 'user', content: '<input>{"sessions":[{"phase":"learn"},{"phase":"review"},{"phase":"final"}]}</input>' }],
    images: [], schema: { type: 'object', properties: {} },
  };
  const p = buildCompletion(req);
  eq(p.messages.map((m) => m.role), ['system', 'user'], 'system と user に分ける');
  eq(p.response_format, { type: 'json_schema', json_schema: { strict: true, schema: { type: 'object', properties: {} } } }, 'スキーマで JSON の形を強制');
  eq([p.n_predict, p.temperature, p.enable_thinking, p.penalty_present], [120 + 260 * 3, 0.3, false, 0], '進め方：コマの数に合わせた長さ・低い温度');
  eq(countSessions('{"phase":"a"} {"phase" : "b"}'), 2, 'コマの数');
  const toc = buildCompletion({ ...req, task: 'toc', schema: null, images: ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'], system: '' });
  eq(toc.response_format, { type: 'json_object' }, 'スキーマがない JSON は json_object');
  eq(toc.messages.length, 1, 'system が空なら入れない');
  const parts = toc.messages[0].content as Array<{ type: string }>;
  eq(parts.map((x) => x.type), ['image_url', 'image_url', 'text'], '写真を文の前に置く');
  const chat = buildCompletion({ ...req, mode: 'text', task: 'chat', schema: null, messages: [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1' }, { role: 'user', content: 'Q2' }] });
  eq([chat.response_format, chat.messages.map((m) => m.role), chat.n_predict], [undefined, ['system', 'user', 'assistant', 'user'], 600], '質問：会話をそのまま・JSON にしない');
  const many = buildCompletion({ ...req, messages: [{ role: 'user', content: '"phase":'.repeat(20) }] });
  eq(many.n_predict, 2400, '進め方の長さの上限');
}

console.log('■ 途中で切れたか');
{
  eq(wasTruncated({ stopped_limit: 1, stopped_eos: false }), true, '長さの上限で止まった');
  eq(wasTruncated({ stopped_limit: 0, stopped_eos: true }), false, '最後まで書いた');
  eq(wasTruncated({ context_full: true }), true, '文脈がいっぱい');
}

console.log('■ 書きながらの文字の間引き');
{
  let t = 0;
  const sent: string[] = [];
  const th = createThrottle((x) => sent.push(x), 100, () => t);
  th.push('a'); t = 50; th.push('ab'); t = 120; th.push('abc'); t = 130; th.push('abcd');
  th.flush();
  eq(sent, ['a', 'abc', 'abcd'], '100ms ごとに最新の全文・最後は必ず送る');
}

console.log(`\n結果：${passes} 件成功、${failures} 件失敗`);
process.exit(failures ? 1 : 0);

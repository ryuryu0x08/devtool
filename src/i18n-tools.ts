// UI strings of the tools added after the first release, merged into DICT (src/i18n.ts).

export const zhT = {
  ui: {
    enc: '编码', dec: '解码', escape: '转义', unescape: '还原', upper: '大写', indent: '缩进', spaces: '{n} 空格', tab: 'Tab',
    chars: '{n} 个字符', lines: '{n} 行', switched: '已按内容切换到「{m}」', empty: '结果实时显示', ok: '格式正确',
    regen: '重新生成', count: '数量', length: '长度', download: '下载', textView: '文本', hexView: '十六进制', swap: '交换',
    zone: '时区：{z}', bytesTo: '{a} 字节 → {b} 字节', loneSur: '结果含孤立代理字符（已标出），它们无法按 UTF-8 保存', notUtf8Out: '{n} 字节 · 不是有效的 UTF-8 文本，以十六进制显示', utf8Out: 'UTF-8 文本 · {n} 字节',
  },
  url: {
    component: '组件', uri: '整个链接', form: '表单（空格写成 +）', plusSpace: '+ 表示空格',
    ph: '输入要编码的文本，或粘贴要解码的 %XX 文本', pct: '「%」后面应是两位十六进制数字', utf8: '解码得到的字节既不是 UTF-8，也不是 GB18030',
    gbk: '这段字节不是 UTF-8，已按 GB18030 解码', plusKept: '有 {n} 个「+」按原样保留为加号；如果这是表单数据，请打开「+ 表示空格」',
  },
  urlp: {
    ph: '粘贴一个链接，如 https://example.com/a?b=1', notUrl: '无法识别为链接（需要以 https:// 这样的协议开头）', assumed: '没有写协议，已按 https:// 解析',
    normalized: '浏览器标准化后的写法与输入不同', protocol: '协议', username: '用户名', password: '密码', host: '主机', port: '端口', defPort: '{p}（默认）',
    path: '路径', pathDec: '路径（解码后）', query: '查询字符串', hash: '片段', origin: '源', params: '查询参数 · {n} 个', key: '名称', value: '值', addParam: '添加参数', remove: '删除',
    rebuilt: '修改后的链接', noParams: '没有查询参数',
  },
  jwt: {
    ph: '粘贴 JWT（可以带 Bearer 前缀）', header: '头部', payload: '载荷', sig: '签名', alg: '算法 {a}', expired: '已过期', notYet: '尚未生效', valid: '在有效期内',
    exp: '过期时间 exp', iat: '签发时间 iat', nbf: '生效时间 nbf', verify: '校验签名', keyPh: 'HS*：填密钥；RS* / PS* / ES* / EdDSA：粘贴公钥（PEM 或 JWK）', keyNote: '密钥只在本页内存中使用，不会保存',
    ok: '✓ 签名有效', bad: '✗ 签名无效', unsupported: '不支持校验算法 {a}', nocrypto: '当前页面不是 HTTPS，浏览器不提供签名校验', key: '密钥或公钥无法使用（格式不对，或与算法不匹配）', none: '算法为 none：没有签名，任何人都能伪造',
    e: { parts: 'JWT 应由两个「.」分成三段', jwe: '这是加密的 JWE（五段），没有密钥无法看到内容', b64: '第 {n} 段不是有效的 Base64URL', utf8: '第 {n} 段解码后不是 UTF-8 文本', json: '第 {n} 段不是 JSON', obj: '第 {n} 段应是 JSON 对象' },
    dup: '{p} 有重复的键，多数程序只读取最后一个',
  },
  uni: {
    ph: '输入文本，或粘贴 \\u4e2d、\\u{1F600}、&#x4e2d;、U+4E2D 这样的写法', all: 'ASCII 也转义', table: '字符明细（前 {n} 个）', ch: '字符', cp: '码点',
    roundtrip: '原文里已经有 \\u 或 &# 这样的写法，还原时它们也会被当作转义，得不到原文', bad: '这里的转义写法不完整（\\u 后应是 4 位十六进制，或 \\u{…}）', n: '还原了 {n} 处',
  },
  html: { min: '仅必要字符', nonascii: '非 ASCII 也转', named: '能用名称的都转', ph: '输入文本，或粘贴 &lt;、&amp;、&#20013; 这样的实体', legacy: '有 {n} 处实体没有结尾的「;」（如 &amp），已按原样保留；浏览器在网页正文里会把它们也解码', n: '解码了 {n} 处' },
  hex: {
    toHex: '文本 → Hex', toText: 'Hex → 文本', sep: '分隔', none: '无', space: '空格', colon: '冒号', prefix: '前缀', ph: '输入文本或拖入文件', hexPh: '粘贴十六进制，如 48 65 6c 6c 6f、0x48,0x65、\\x48\\x65',
    char: '「{c}」不是十六进制数字', tooBig: '文件超过 {n} MB，十六进制结果过大，未处理', odd: '这里的十六进制数字是奇数个，最后一个字节不完整',
  },
  base: {
    ph: '输入整数，如 255、0xFF、0b1010、-42；可用 _ 或 , 分组', from: '输入进制', auto: '自动', other: '其他', bin: '二进制', oct: '八进制', dec: '十进制', hex: '十六进制', baseN: '{n} 进制',
    widths: '固定位宽', unsigned: '{n} 位无符号', signed: '{n} 位有符号', hexW: '{n} 位十六进制', readAs: '按 {n} 进制读取',
    e: { char: '「{c}」不是 {n} 进制的数字', frac: '只支持整数，不支持小数', empty: '没有数字' },
  },
  gzip: {
    zip: '压缩', unzip: '解压', ph: '输入文本或拖入文件', unPh: '粘贴 Base64 或十六进制的压缩数据，或拖入 .gz 文件', fmt: '格式', detected: '识别为 {f}', ratio: '{a} 字节 → {b} 字节（{p}%）',
    fail: '无法按 {f} 解压：数据不完整或不是这种格式', notData: '无法识别输入：请粘贴 Base64 或十六进制，或拖入文件', out64: '结果（Base64）', dlOnly: '结果超过 {n} MB，不在页面显示，请下载', tooBig: '文件超过 {n} MB，未处理',
  },
  yaml: { ph: '粘贴 YAML…', valid: '有效 YAML · {n} 个文档', changed: '{n} 处写法有变化（值不变），如 {a} → {b}', verify: '格式化结果校验未通过（{p}），为避免改动数据，已停止输出' },
  xml: {
    ph: '粘贴 XML…', verify: '格式化结果校验未通过，为避免改动数据，已停止输出', note: '只调整了元素之间的空白；含正文的元素和 xml:space="preserve" 的内容保持原样',
    e: { unclosed: '<{a}> 没有结束标签', mismatch: '结束标签与开始标签 <{a}> 不匹配', name: '这里应是标签名', attr: '属性写法不对，应为 名称="值"', dupAttr: '属性 {a} 重复', amp: '「&」必须写成 &amp;（或是完整的实体，如 &lt;）', text: '根元素之外不能有文本', multiRoot: '只能有一个根元素', noRoot: '没有根元素', eof: '内容没有结束', lt: '属性值里不能有「<」', stray: '多出的结束标签 </{a}>' },
  },
  sql: { ph: '粘贴 SQL…', dialect: '方言', kw: '关键字', keep: '保持', lower: '小写', reindented: '多行注释的缩进随之调整（注释内容不变）', verify: '格式化结果校验未通过（这里的内容会被改动），为避免改动数据，已停止输出' },
  schema: {
    schema: 'Schema', data: '数据', schemaPh: '粘贴 JSON Schema…', dataPh: '粘贴要校验的 JSON…', pass: '✓ 通过校验', fail: '✗ {n} 处不符合', draft: '按 {d} 规范校验',
    ignored: '已忽略：{w}', inexact: '{n} 个数字超出双精度，校验时只能按近似值比较：{p}', need: '两侧都填入后显示结果',
    e: { draft4: '不支持 draft-04 及更早的规范（{d}）', ref: '不支持引用外部 schema：{d}', compile: 'Schema 本身有错：{d}', dup: '{d} 有重复的键，无法确定应使用哪个值', notSchema: 'Schema 应是 JSON 对象或 true / false' },
  },
  tdiff: { a: 'A · 原始', b: 'B · 修改后', ignoreWs: '忽略空白差异', ignoreCase: '忽略大小写', onlyDiff: '仅显示差异', same: '两段文本完全一致', added: '+ {n} 行', removed: '− {n} 行', hidden: '… {n} 行未变化', ph: '粘贴文本…', need: '两侧都填入后显示差异', capped: '仅显示前 {n} 行，共 {t} 行' },
  regex: {
    pattern: '正则表达式', patternPh: '如 (\\d{4})-(\\d{2})，也可以粘贴 /abc/gi', text: '测试文本', textPh: '粘贴要匹配的文本…', repl: '替换为', replPh: '可选，如 $2/$1、$<name>',
    flags: { g: '全部匹配', i: '忽略大小写', m: '多行（^ $ 按行）', s: '. 匹配换行', u: 'Unicode', y: '粘连' },
    matches: '{n} 处匹配', none: '没有匹配', first: '没有开启 g：只找第一处', more: '仅显示前 {n} 处，共 {t} 处', timeout: '超过 1.5 秒未完成（可能是灾难性回溯），已停止', replaced: '替换结果',
    group: '分组', at: '位置 {i}', undef: '（未参与匹配）',
  },
  caseConv: { ph: '输入标识符或短语，每行一个，如 user_id、XMLHttpRequest', names: { camel: 'camelCase', pascal: 'PascalCase', snake: 'snake_case', constant: 'CONSTANT_CASE', kebab: 'kebab-case', dot: 'dot.case', title: 'Title Case', lower: '全小写', upper: '全大写' } },
  count: { ph: '粘贴文本…', graphemes: '字符（按显示）', codePoints: 'Unicode 码点', utf16: 'UTF-16 长度（JS length）', utf8: 'UTF-8 字节', lines: '行', nonEmptyLines: '非空行', words: '词（按语言分词）', latinWords: '英文单词', cjk: '中日韩字符', spaces: '空白字符', paragraphs: '段落' },
  proc: { ph: '粘贴文本，每行一项…', trim: '去掉首尾空白', dropBlank: '去掉空行', dedupe: '去重', ignoreCase: '忽略大小写', sort: { none: '不排序', asc: '升序', desc: '降序', natural: '自然顺序', length: '按长度' }, reverse: '反转', stats: '{a} 行 → {b} 行', dupes: '去掉 {n} 行重复', blank: '去掉 {n} 个空行' },
  esc: {
    ph: '输入文本，或粘贴要还原的转义写法', sqlNote: '按标准 SQL：只把「\'」写成「\'\'」。MySQL 默认还把「\\」当转义字符', shellNote: '按 POSIX shell：整段放进单引号，单引号写成 \'\\\'\'', words: '是 {n} 个参数，每行一个',
    e: { bad: '这里的转义写法 {l} 不支持', nul: 'shell 参数里不能有 NUL 字符', expand: '含有 $ 或 ` 展开，不运行 shell 无法还原', op: '含有 shell 运算符（如 | ; &），这不是单纯的参数', quote: '引号没有配对', utf8: '转义得到的字节不是有效的 UTF-8' },
  },
  uuid: {
    gen: '生成', parse: '解析', version: '版本', noHyphen: '不带连字符', parsePh: '粘贴 UUID，看它的版本和其中的时间', notUuid: '不是 UUID',
    canonical: '标准写法', ver: '版本', variant: '变体', time: '时间', clockSeq: '时钟序列', node: '节点（MAC）', nil: 'Nil UUID（全 0）', max: 'Max UUID（全 F）',
    variants: { ncs: 'NCS（保留）', rfc: 'RFC 9562', microsoft: 'Microsoft（保留）', future: '保留' },
    kinds: { '1': 'v1 · 时间 + 节点', '2': 'v2 · DCE 安全', '3': 'v3 · 名称（MD5）', '4': 'v4 · 随机', '5': 'v5 · 名称（SHA-1）', '6': 'v6 · 时间（可排序）', '7': 'v7 · Unix 时间（可排序）', '8': 'v8 · 自定义' },
    v7note: 'v7 的前 48 位是毫秒时间，同一毫秒内依次递增，整批可按字符串排序',
  },
  pwd: { lower: '小写 a-z', upper: '大写 A-Z', digits: '数字 0-9', symbols: '符号 !@#…', extra: '额外字符', noAmbiguous: '排除易混淆（Il1O0o）', eachClass: '每类至少一个', info: '字符集 {n} 个 · 每个约 {b} 位熵', none: '请至少选择一类字符', tooShort: '长度不足以包含每一类字符', notSaved: '用浏览器的安全随机数生成，不会保存' },
  cron: {
    ph: '如 30 9 * * 1-5、0 0/15 * * * ?、@daily', dialect: '规则', auto: '自动', unix: 'Unix（5 位）', spring: 'Spring（6 位，含秒）', quartz: 'Quartz（6–7 位，周日 = 1）', as: '按 {d} 规则解析',
    next: '接下来 {n} 次（{z}）', none: '找不到下一次执行时间（例如 2 月 30 日不存在）', reboot: '系统启动时运行，没有固定时间',
    skipped: '有 {n} 个时刻因夏令时切换不存在，不会执行', repeated: '标 * 的时刻因夏令时回拨会出现两次，这里只算第一次；不同 cron 实现处理方式不同',
    unixOr: '「日」和「星期」都指定时，满足其中一个就执行（Unix cron 的规则）', andRule: '「日」和「星期」都指定时，两者都满足才执行（{d} 的规则）',
    e: { count: '字段数不对：这条规则需要 {w} 个字段，现在是 {n} 个', value: '{i}的「{t}」超出范围或无法识别', range: '{i}的范围「{t}」起点大于终点', step: '{i}的步长「{t}」不对', special: '{i}的「{t}」不是 Unix cron 的写法（L、W、# 只在 Spring / Quartz 里有）', question: '「?」只能用在日或星期字段，且 Unix cron 不支持', quartzQ: 'Quartz 要求「日」和「星期」中有一个写成「?」' },
    fields: { sec: '秒', min: '分', hour: '时', dom: '日', mon: '月', dow: '星期', year: '年' },
  },
  color: {
    ph: '如 #3d6df2、rgb(61 109 242)、hsl(224 87% 59%)、oklch(58% 0.19 264)、tomato', notColor: '无法识别为颜色', pick: '取色',
    mapped: '这个 OKLCH 颜色超出 sRGB 能显示的范围，已降低彩度映射到最接近的可显示颜色', rounded: 'HEX 和 RGB 是 8 位整数，已四舍五入', contrast: '对比度', fg: '前景（文字）', bg: '背景',
    ratio: '{r} : 1', aa: 'AA 正文（≥ 4.5）', aaLarge: 'AA 大号文字（≥ 3）', aaa: 'AAA 正文（≥ 7）', aaaLarge: 'AAA 大号文字（≥ 4.5）', pass: '✓ 通过', fail: '✗ 不通过',
    sample: '示例文字 Sample text 123', alphaNote: '前景有透明度：先叠加到背景上再计算',
  },
  ts2: { ulid: '识别为 ULID · 前 10 位是毫秒时间', snow: 'Snowflake ID（{k}）', twitter: 'X / Twitter', discord: 'Discord', snowNote: '这串数字也可能是 Snowflake ID：' },
};

export type ToolDict = typeof zhT;

export const enT: ToolDict = {
  ui: {
    enc: 'Encode', dec: 'Decode', escape: 'Escape', unescape: 'Unescape', upper: 'Uppercase', indent: 'Indent', spaces: '{n} spaces', tab: 'Tab',
    chars: '{n} characters', lines: '{n} lines', switched: 'Switched to {m} for this content', empty: 'The result appears as you type', ok: 'Well-formed',
    regen: 'Generate again', count: 'Count', length: 'Length', download: 'Download', textView: 'Text', hexView: 'Hex', swap: 'Swap',
    zone: 'Time zone: {z}', bytesTo: '{a} bytes → {b} bytes', loneSur: 'The result has lone surrogates (marked); they can’t be saved as UTF-8', notUtf8Out: '{n} bytes · not valid UTF-8 text, shown as hex', utf8Out: 'UTF-8 text · {n} bytes',
  },
  url: {
    component: 'Component', uri: 'Whole URL', form: 'Form (space as +)', plusSpace: '+ means space',
    ph: 'Type text to encode, or paste %XX text to decode', pct: '“%” must be followed by two hex digits', utf8: 'The decoded bytes are neither UTF-8 nor GB18030',
    gbk: 'These bytes aren’t UTF-8; decoded as GB18030', plusKept: '{n} “+” kept as plus signs; if this is form data, turn on “+ means space”',
  },
  urlp: {
    ph: 'Paste a link, e.g. https://example.com/a?b=1', notUrl: 'Not a link (it needs a scheme such as https://)', assumed: 'No scheme written: read as https://',
    normalized: 'The browser’s normalized form differs from the input', protocol: 'Scheme', username: 'User', password: 'Password', host: 'Host', port: 'Port', defPort: '{p} (default)',
    path: 'Path', pathDec: 'Path (decoded)', query: 'Query string', hash: 'Fragment', origin: 'Origin', params: 'Query parameters · {n}', key: 'Name', value: 'Value', addParam: 'Add parameter', remove: 'Remove',
    rebuilt: 'Edited link', noParams: 'No query parameters',
  },
  jwt: {
    ph: 'Paste a JWT (a Bearer prefix is fine)', header: 'Header', payload: 'Payload', sig: 'Signature', alg: 'Algorithm {a}', expired: 'Expired', notYet: 'Not yet valid', valid: 'Within its validity',
    exp: 'Expires exp', iat: 'Issued iat', nbf: 'Not before nbf', verify: 'Verify signature', keyPh: 'HS*: the secret; RS* / PS* / ES* / EdDSA: the public key (PEM or JWK)', keyNote: 'The key stays in this page’s memory and is never stored',
    ok: '✓ Signature valid', bad: '✗ Signature invalid', unsupported: 'Can’t verify algorithm {a}', nocrypto: 'This page isn’t served over HTTPS, so the browser offers no signature checking', key: 'The key can’t be used (wrong format, or not for this algorithm)', none: 'Algorithm none: unsigned, anyone can forge it',
    e: { parts: 'A JWT has three parts separated by “.”', jwe: 'This is an encrypted JWE (five parts); its content needs the key', b64: 'Part {n} isn’t valid Base64URL', utf8: 'Part {n} isn’t UTF-8 text', json: 'Part {n} isn’t JSON', obj: 'Part {n} should be a JSON object' },
    dup: '{p} has duplicate keys; most programs read only the last',
  },
  uni: {
    ph: 'Type text, or paste forms like \\u4e2d, \\u{1F600}, &#x4e2d;, U+4E2D', all: 'Escape ASCII too', table: 'Characters (first {n})', ch: 'Char', cp: 'Code point',
    roundtrip: 'The text already contains \\u or &# forms; unescaping would treat them as escapes too, so it won’t give the original back', bad: 'Incomplete escape here (\\u takes 4 hex digits, or \\u{…})', n: '{n} unescaped',
  },
  html: { min: 'Only what’s needed', nonascii: 'Non-ASCII too', named: 'Every named one', ph: 'Type text, or paste entities like &lt;, &amp;, &#20013;', legacy: '{n} entities lack the closing “;” (like &amp) and were kept as written; browsers decode them in page text', n: '{n} decoded' },
  hex: {
    toHex: 'Text → Hex', toText: 'Hex → Text', sep: 'Separator', none: 'None', space: 'Space', colon: 'Colon', prefix: 'Prefix', ph: 'Type text or drop a file', hexPh: 'Paste hex, e.g. 48 65 6c 6c 6f, 0x48,0x65, \\x48\\x65',
    char: '“{c}” is not a hex digit', tooBig: 'File is over {n} MB; its hex would be too large, not processed', odd: 'An odd number of hex digits here: the last byte is incomplete',
  },
  base: {
    ph: 'Type an integer: 255, 0xFF, 0b1010, -42; _ or , may group digits', from: 'Input base', auto: 'Auto', other: 'Other', bin: 'Binary', oct: 'Octal', dec: 'Decimal', hex: 'Hexadecimal', baseN: 'Base {n}',
    widths: 'Fixed widths', unsigned: '{n}-bit unsigned', signed: '{n}-bit signed', hexW: '{n}-bit hex', readAs: 'Read as base {n}',
    e: { char: '“{c}” is not a base-{n} digit', frac: 'Integers only, no fractions', empty: 'No digits' },
  },
  gzip: {
    zip: 'Compress', unzip: 'Decompress', ph: 'Type text or drop a file', unPh: 'Paste compressed data as Base64 or hex, or drop a .gz file', fmt: 'Format', detected: 'Detected {f}', ratio: '{a} bytes → {b} bytes ({p}%)',
    fail: 'Can’t decompress as {f}: the data is incomplete or not in this format', notData: 'Unrecognised input: paste Base64 or hex, or drop a file', out64: 'Result (Base64)', dlOnly: 'The result is over {n} MB: not shown, download it', tooBig: 'File is over {n} MB, not processed',
  },
  yaml: { ph: 'Paste YAML…', valid: 'Valid YAML · {n} document(s)', changed: '{n} written differently (same values), e.g. {a} → {b}', verify: 'The formatted result didn’t pass the check ({p}); output stopped so no data changes' },
  xml: {
    ph: 'Paste XML…', verify: 'The formatted result didn’t pass the check; output stopped so no data changes', note: 'Only whitespace between elements changed; elements holding text and xml:space="preserve" content are kept as written',
    e: { unclosed: '<{a}> has no end tag', mismatch: 'This end tag doesn’t match the start tag <{a}>', name: 'A tag name is expected here', attr: 'Malformed attribute: write name="value"', dupAttr: 'Attribute {a} appears twice', amp: '“&” must be written &amp; (or be a complete entity like &lt;)', text: 'No text is allowed outside the root element', multiRoot: 'Only one root element is allowed', noRoot: 'No root element', eof: 'Unexpected end of input', lt: '“<” is not allowed in an attribute value', stray: 'Extra end tag </{a}>' },
  },
  sql: { ph: 'Paste SQL…', dialect: 'Dialect', kw: 'Keywords', keep: 'Keep', lower: 'Lowercase', reindented: 'Multi-line comments were re-indented with the code (their text is unchanged)', verify: 'The formatted result didn’t pass the check (this would change); output stopped so no data changes' },
  schema: {
    schema: 'Schema', data: 'Data', schemaPh: 'Paste a JSON Schema…', dataPh: 'Paste the JSON to validate…', pass: '✓ Valid', fail: '✗ {n} problem(s)', draft: 'Validated as {d}',
    ignored: 'Ignored: {w}', inexact: '{n} number(s) exceed double precision and are compared approximately: {p}', need: 'Fill in both sides to see the result',
    e: { draft4: 'draft-04 and earlier are not supported ({d})', ref: 'References to external schemas aren’t supported: {d}', compile: 'The schema itself is invalid: {d}', dup: '{d} has duplicate keys; which value counts is undefined', notSchema: 'A schema is a JSON object, or true / false' },
  },
  tdiff: { a: 'A · original', b: 'B · changed', ignoreWs: 'Ignore whitespace', ignoreCase: 'Ignore case', onlyDiff: 'Only differences', same: 'The texts are identical', added: '+ {n} lines', removed: '− {n} lines', hidden: '… {n} unchanged lines', ph: 'Paste text…', need: 'Fill in both sides to compare', capped: 'Showing the first {n} of {t} lines' },
  regex: {
    pattern: 'Pattern', patternPh: 'e.g. (\\d{4})-(\\d{2}), or paste /abc/gi', text: 'Test text', textPh: 'Paste text to match…', repl: 'Replace with', replPh: 'Optional, e.g. $2/$1, $<name>',
    flags: { g: 'All matches', i: 'Ignore case', m: 'Multiline (^ $ per line)', s: '. matches newline', u: 'Unicode', y: 'Sticky' },
    matches: '{n} match(es)', none: 'No match', first: 'g is off: only the first match', more: 'Showing the first {n} of {t}', timeout: 'Stopped after 1.5 s (probably catastrophic backtracking)', replaced: 'Replaced',
    group: 'Group', at: 'at {i}', undef: '(did not participate)',
  },
  caseConv: { ph: 'Type identifiers or phrases, one per line: user_id, XMLHttpRequest', names: { camel: 'camelCase', pascal: 'PascalCase', snake: 'snake_case', constant: 'CONSTANT_CASE', kebab: 'kebab-case', dot: 'dot.case', title: 'Title Case', lower: 'lowercase', upper: 'UPPERCASE' } },
  count: { ph: 'Paste text…', graphemes: 'Characters (as shown)', codePoints: 'Unicode code points', utf16: 'UTF-16 length (JS length)', utf8: 'UTF-8 bytes', lines: 'Lines', nonEmptyLines: 'Non-empty lines', words: 'Words (by language)', latinWords: 'English words', cjk: 'CJK characters', spaces: 'Whitespace characters', paragraphs: 'Paragraphs' },
  proc: { ph: 'Paste text, one item per line…', trim: 'Trim each line', dropBlank: 'Remove blank lines', dedupe: 'Remove duplicates', ignoreCase: 'Ignore case', sort: { none: 'No sorting', asc: 'Ascending', desc: 'Descending', natural: 'Natural', length: 'By length' }, reverse: 'Reverse', stats: '{a} lines → {b} lines', dupes: '{n} duplicate lines removed', blank: '{n} blank lines removed' },
  esc: {
    ph: 'Type text, or paste escaped text to unescape', sqlNote: 'Standard SQL: only “\'” is written “\'\'”. MySQL by default also treats “\\” as an escape', shellNote: 'POSIX shell: the whole text in single quotes, a quote written as \'\\\'\'', words: '{n} arguments, one per line',
    e: { bad: 'Escape {l} doesn’t support this', nul: 'A shell argument can’t contain NUL', expand: 'Contains $ or ` expansion; can’t be undone without running a shell', op: 'Contains shell operators (| ; & …): not just an argument', quote: 'Unbalanced quote', utf8: 'The escaped bytes aren’t valid UTF-8' },
  },
  uuid: {
    gen: 'Generate', parse: 'Inspect', version: 'Version', noHyphen: 'No hyphens', parsePh: 'Paste a UUID to see its version and time', notUuid: 'Not a UUID',
    canonical: 'Canonical', ver: 'Version', variant: 'Variant', time: 'Time', clockSeq: 'Clock sequence', node: 'Node (MAC)', nil: 'Nil UUID (all zeros)', max: 'Max UUID (all F)',
    variants: { ncs: 'NCS (reserved)', rfc: 'RFC 9562', microsoft: 'Microsoft (reserved)', future: 'Reserved' },
    kinds: { '1': 'v1 · time + node', '2': 'v2 · DCE security', '3': 'v3 · name (MD5)', '4': 'v4 · random', '5': 'v5 · name (SHA-1)', '6': 'v6 · time (sortable)', '7': 'v7 · Unix time (sortable)', '8': 'v8 · custom' },
    v7note: 'v7 starts with 48 bits of milliseconds and counts up within a millisecond: a batch sorts as strings',
  },
  pwd: { lower: 'Lowercase a-z', upper: 'Uppercase A-Z', digits: 'Digits 0-9', symbols: 'Symbols !@#…', extra: 'Extra characters', noAmbiguous: 'No look-alikes (Il1O0o)', eachClass: 'At least one of each', info: '{n} characters · about {b} bits of entropy each', none: 'Choose at least one kind of character', tooShort: 'Too short to include every kind', notSaved: 'Made with the browser’s secure random numbers; never stored' },
  cron: {
    ph: 'e.g. 30 9 * * 1-5, 0 0/15 * * * ?, @daily', dialect: 'Rules', auto: 'Auto', unix: 'Unix (5 fields)', spring: 'Spring (6, with seconds)', quartz: 'Quartz (6–7, Sunday = 1)', as: 'Read with {d} rules',
    next: 'Next {n} ({z})', none: 'No next run (e.g. February 30 never comes)', reboot: 'Runs at system start, no fixed time',
    skipped: '{n} time(s) don’t exist because of a DST change and won’t run', repeated: 'Times marked * occur twice when clocks go back; listed once here; cron implementations differ',
    unixOr: 'With both day of month and day of week set, either one matching is enough (Unix cron rule)', andRule: 'With both day of month and day of week set, both must match ({d} rule)',
    e: { count: 'Wrong number of fields: these rules need {w}, this has {n}', value: '“{t}” in {i} is out of range or not recognised', range: 'Range “{t}” in {i} starts after it ends', step: 'Step “{t}” in {i} is wrong', special: '“{t}” in {i} isn’t Unix cron syntax (L, W, # are Spring / Quartz only)', question: '“?” only works in the day fields, and not in Unix cron', quartzQ: 'Quartz needs “?” in either day of month or day of week' },
    fields: { sec: 'second', min: 'minute', hour: 'hour', dom: 'day of month', mon: 'month', dow: 'day of week', year: 'year' },
  },
  color: {
    ph: 'e.g. #3d6df2, rgb(61 109 242), hsl(224 87% 59%), oklch(58% 0.19 264), tomato', notColor: 'Not a colour', pick: 'Pick',
    mapped: 'This OKLCH colour is outside what sRGB can show; its chroma was lowered to the nearest displayable colour', rounded: 'HEX and RGB are 8-bit integers, rounded', contrast: 'Contrast', fg: 'Foreground (text)', bg: 'Background',
    ratio: '{r} : 1', aa: 'AA body text (≥ 4.5)', aaLarge: 'AA large text (≥ 3)', aaa: 'AAA body text (≥ 7)', aaaLarge: 'AAA large text (≥ 4.5)', pass: '✓ Pass', fail: '✗ Fail',
    sample: 'Sample text 示例文字 123', alphaNote: 'The foreground is translucent: laid over the background first',
  },
  ts2: { ulid: 'Detected ULID · the first 10 characters are milliseconds', snow: 'Snowflake ID ({k})', twitter: 'X / Twitter', discord: 'Discord', snowNote: 'This number may also be a Snowflake ID:' },
};

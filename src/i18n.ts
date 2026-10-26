// Tool registry, categories and UI strings (zh / en).

export type ToolId = 'ts' | 'qrgen' | 'qrscan' | 'json' | 'toml' | 'diff';
export type CatId = 'time' | 'qr' | 'fmt' | 'diff';
export type Lang = 'zh' | 'en';

export interface Tool {
  id: ToolId;
  cat: CatId;
  icon: string;
  /** [full name, short name, description] */
  zh: [string, string, string];
  en: [string, string, string];
  /** extra search keywords, including pinyin initials */
  kw: string;
}

export const TOOLS: Tool[] = [
  { id: 'ts', cat: 'time', icon: '01', zh: ['时间戳转换', '时间戳', '时间戳 ⇄ 日期，按所选时区'], en: ['Timestamp', 'Timestamp', 'Unix time ⇄ date, in any time zone'], kw: 'timestamp unix epoch sjc shijianchuo 时间 日期 date time 时区 timezone' },
  { id: 'qrgen', cat: 'qr', icon: '▦', zh: ['生成二维码', '生成二维码', '文本 / 链接 → 二维码'], en: ['QR Generator', 'QR Generate', 'Text or link → QR code'], kw: 'qrcode qr ewm erweima 二维码 生成 generate scsc' },
  { id: 'qrscan', cat: 'qr', icon: '⌖', zh: ['识别二维码', '识别二维码', '粘贴或拖入图片，支持一图多码'], en: ['QR Scanner', 'QR Scan', 'Paste or drop an image — finds every code'], kw: 'qr scan decode read 识别 解码 扫码 ewm shibie' },
  { id: 'json', cat: 'fmt', icon: '{}', zh: ['JSON 格式化', 'JSON', '格式化 · 折叠 · 路径'], en: ['JSON Formatter', 'JSON', 'Format · fold · copy path'], kw: 'json format pretty geshihua gsh 格式化 美化 压缩 minify tree' },
  { id: 'toml', cat: 'fmt', icon: '[]', zh: ['TOML 格式化', 'TOML', '格式化 · 折叠 · 转 JSON'], en: ['TOML Formatter', 'TOML', 'Format · fold · to JSON'], kw: 'toml format geshihua gsh 格式化 config' },
  { id: 'diff', cat: 'diff', icon: '≠', zh: ['JSON 对比', 'JSON 对比', '语义对比：忽略 key 顺序与空白'], en: ['JSON Diff', 'JSON Diff', 'Semantic diff — key order & whitespace ignored'], kw: 'diff compare json duibi db 对比 比较 差异' },
];

export const CATS: Record<CatId, Record<Lang, string>> = {
  time: { zh: '时间', en: 'Time' },
  qr: { zh: '二维码', en: 'QR code' },
  fmt: { zh: '格式化', en: 'Format' },
  diff: { zh: '对比', en: 'Compare' },
};
export const CAT_ORDER: CatId[] = ['time', 'qr', 'fmt', 'diff'];

export const TZ_ZH: Record<string, string> = {
  UTC: '协调世界时', 'Asia/Shanghai': '北京 / 上海', 'Asia/Hong_Kong': '香港', 'Asia/Taipei': '台北', 'Asia/Tokyo': '东京',
  'Asia/Seoul': '首尔', 'Asia/Singapore': '新加坡', 'Asia/Kolkata': '印度', 'Asia/Dubai': '迪拜', 'Europe/London': '伦敦',
  'Europe/Paris': '巴黎', 'Europe/Berlin': '柏林', 'Europe/Moscow': '莫斯科', 'America/New_York': '纽约', 'America/Chicago': '芝加哥',
  'America/Denver': '丹佛', 'America/Los_Angeles': '洛杉矶', 'America/Sao_Paulo': '圣保罗', 'Australia/Sydney': '悉尼', 'Pacific/Auckland': '奥克兰',
};
export const COMMON_TZ = ['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles'];

const zh = {
  brand: '工具箱', search: '搜索工具…', searchShort: '搜索', collapse: '收起侧栏', expand: '展开侧栏',
  now: '现在', tzSearch: '搜索城市或时区，如 tokyo / 东京 / +9', tzLocal: '本机', tzRecent: '最近使用', tzCommon: '常用', tzNone: '没有匹配的时区', tzLocalTag: ' · 本机',
  ts2t: '时间戳', t2ts: '时间', auto: '自动', units: { s: '秒', ms: '毫秒', us: '微秒', ns: '纳秒' }, tsPh: '粘贴时间戳，如 1793000000', detected: '识别为{u} · {d} 位 · 点击复制', forced: '按{u}解析 · 点击复制',
  rowISO: 'ISO 8601', rowUTC: 'UTC', rowRel: '相对', copy: '复制', copyText: '复制文本', tsErr: '请输入数字时间戳', tsRange: '超出可表示的时间范围', tsEmpty: '输入时间戳，结果实时显示',
  tmPh: '2026-10-26 14:30 · 明天 9点 · now', parsedAs: '解析为 {v} · 点击复制', tmErr: '无法识别。试试 2026-10-26 14:30、10/26 9:00、明天 9点、14:30 或 now', sec: '秒',
  q: { now: '现在', today: '今天 0 点', tomorrow: '明天 0 点', month: '本月 1 日', m1d: '−1 天', m1h: '−1 时', p1h: '+1 时', p1d: '+1 天' }, wd: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  copied: '已复制', qrContent: '内容', qrPh: '输入文本或链接，二维码实时生成', bytes: '{n} 字节', qrEmpty: '输入内容即时生成', qrTooLong: '内容过长，无法生成', ec: '容错', dlPng: '下载 PNG', copyImg: '复制图片', clear: '清空', sample: '示例', imgCopied: '图片已复制', imgCopyFail: '当前浏览器不支持复制图片', ecT: { L: '约 7%', M: '约 15%', Q: '约 25%', H: '约 30%' },
  dropTitle: '粘贴、拖入或点击选择图片', dropSub: '自动识别图中所有二维码 · 图片仅在本地处理', scanning: '识别中…', found: '识别到 {n} 个二维码', notFound: '未识别到二维码', notFoundSub: '换一张更清晰、二维码更完整的图片试试。', another: '换一张', copyAll: '复制全部', open: '打开', pasted: '粘贴的图片',
  kinds: { url: '链接', wifi: 'Wi-Fi', mail: '邮箱', tel: '电话', text: '文本' },
  input: '输入', indent2: '2 空格', indent4: '4 空格', sortKeys: '按 key 排序', minify: '压缩复制', toToml: '转为 TOML', toJson: '转为 JSON', viewTree: '结构', viewText: '文本', copyResult: '复制结果', expandAll: '全部展开', level: '{n} 层',
  valid: '有效 {L} · {n} 个节点 · 深度 {d}', dupKeysKept: '{n} 个重复键（已原样保留；多数程序只读取最后一个）：{p}', waiting: '在左侧输入或粘贴 {L}', errAt: '第 {l} 行，第 {c} 列', errNoPos: '解析失败', items: '{n} 项', keys: '{n} 个键', copyPath: '复制路径', copyValue: '复制值', truncated: '仅显示前 {n} 行，切换到「文本」查看全部', tomlTop: 'TOML 顶层必须是对象', cvFail: '无法转换：', cv: { null: 'TOML 没有 null（{p}）', nanInf: 'JSON 不支持 {d}（{p}）', badString: '字符串含有 TOML 无法表示的字符（{p}）', intRange: '整数 {d} 超出 TOML 的 64 位整数范围（{p}）', floatRange: '数值 {d} 超出浮点数范围（{p}）', floatPrecision: 'TOML 浮点数为双精度，无法精确表示 {d}（{p}）', dupKey: '存在重复键 {p}，无法确定应使用哪个值', notObject: 'TOML 顶层必须是对象' }, datesToStr: '已转换；{n} 个日期时间已转为字符串（JSON 没有日期类型）', verifyFail: '格式化结果校验未通过（{p}），为避免改动数据，已停止输出', tomlUnsupported: '暂不支持此写法：{m}', tomlMismatch: '解析结果与参考解析器不一致（{p}），为避免改动数据，已停止处理', bomRemoved: '已去除开头的 BOM', dupMark: '重复键', notUtf8: '文件不是有效的 UTF-8 编码，未打开', minCopied: '已复制压缩后的 JSON', fmtPh: '粘贴 {L}…',
  ignoreOrder: '忽略数组顺序', onlyDiff: '仅显示差异', swap: '交换', a: 'A · 原始', b: 'B · 修改后', diffTree: '合并视图', diffList: '差异清单', same: '语义完全一致', sameSub: 'key 顺序、缩进、空白不影响结果', sameButFmt: '值都相同，但有 {n} 处写法不同', fmtOnly: '写法不同', keyFmtOnly: '键的写法不同', added: '新增', removed: '删除', changed: '修改', unchanged: '… {n} 项未变化', diffs: '{n} 处差异', needBoth: '两侧都填入有效的 JSON / TOML 后显示差异', invalid: '无效', empty: '空',
  pal: '搜索工具，或直接粘贴内容…', palNone: '没有匹配的工具', palFoot: '↑↓ 选择 · ↵ 打开 · 也可直接粘贴时间戳 / JSON 自动识别', palDetect: '用「{t}」处理输入的内容',
  routed: '已识别，打开「{t}」', dropHere: '松开即可识别', dropHereSub: '图片 → 识别二维码 · .json / .toml → 格式化', notImage: '请提供图片文件',
  theme: { light: '浅', dark: '深', auto: '自动' }, themeLong: { light: '浅色', dark: '深色', auto: '跟随系统' }, relLocale: 'zh-CN',
};

export type Dict = typeof zh;

const en: Dict = {
  brand: 'Toolbox', search: 'Search tools…', searchShort: 'Search', collapse: 'Collapse sidebar', expand: 'Expand sidebar',
  now: 'Now', tzSearch: 'Search city or zone — tokyo, +9…', tzLocal: 'This device', tzRecent: 'Recent', tzCommon: 'Common', tzNone: 'No matching time zone', tzLocalTag: ' · this device',
  ts2t: 'Timestamp', t2ts: 'Date', auto: 'Auto', units: { s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds' }, tsPh: 'Paste a timestamp, e.g. 1793000000', detected: 'Detected {u} · {d} digits · click to copy', forced: 'Read as {u} · click to copy',
  rowISO: 'ISO 8601', rowUTC: 'UTC', rowRel: 'Relative', copy: 'Copy', copyText: 'Copy text', tsErr: 'Enter a numeric timestamp', tsRange: 'Out of representable range', tsEmpty: 'Type a timestamp — results appear instantly',
  tmPh: '2026-10-26 14:30 · tomorrow 9:00 · now', parsedAs: 'Parsed as {v} · click to copy', tmErr: 'Not recognised. Try 2026-10-26 14:30, 10/26 9:00, tomorrow 9:00, 14:30 or now', sec: 'sec',
  q: { now: 'Now', today: 'Today 00:00', tomorrow: 'Tomorrow 00:00', month: '1st of month', m1d: '−1 d', m1h: '−1 h', p1h: '+1 h', p1d: '+1 d' }, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  copied: 'Copied', qrContent: 'Content', qrPh: 'Type text or a link — the code updates live', bytes: '{n} bytes', qrEmpty: 'Start typing to generate', qrTooLong: 'Too long for a QR code', ec: 'Error correction', dlPng: 'Download PNG', copyImg: 'Copy image', clear: 'Clear', sample: 'Sample', imgCopied: 'Image copied', imgCopyFail: 'This browser can’t copy images', ecT: { L: '~7%', M: '~15%', Q: '~25%', H: '~30%' },
  dropTitle: 'Paste, drop or click to choose an image', dropSub: 'Finds every QR code in the image · processed locally', scanning: 'Scanning…', found: '{n} QR code(s) found', notFound: 'No QR code found', notFoundSub: 'Try a sharper image where the whole code is visible.', another: 'Another image', copyAll: 'Copy all', open: 'Open', pasted: 'Pasted image',
  kinds: { url: 'Link', wifi: 'Wi-Fi', mail: 'Email', tel: 'Phone', text: 'Text' },
  input: 'Input', indent2: '2 spaces', indent4: '4 spaces', sortKeys: 'Sort keys', minify: 'Copy minified', toToml: 'To TOML', toJson: 'To JSON', viewTree: 'Tree', viewText: 'Text', copyResult: 'Copy result', expandAll: 'Expand all', level: 'Level {n}',
  valid: 'Valid {L} · {n} nodes · depth {d}', dupKeysKept: '{n} duplicate key(s), kept as written (most programs read only the last): {p}', waiting: 'Type or paste {L} on the left', errAt: 'Line {l}, column {c}', errNoPos: 'Parse error', items: '{n} items', keys: '{n} keys', copyPath: 'Copy path', copyValue: 'Copy value', truncated: 'Showing first {n} rows — switch to Text for everything', tomlTop: 'TOML needs an object at the top level', cvFail: 'Can’t convert: ', cv: { null: 'TOML has no null ({p})', nanInf: 'JSON has no {d} ({p})', badString: 'String has characters TOML can’t represent ({p})', intRange: 'Integer {d} is outside TOML’s 64-bit range ({p})', floatRange: 'Number {d} is outside the float range ({p})', floatPrecision: 'TOML floats are doubles and can’t hold {d} exactly ({p})', dupKey: 'Duplicate key {p}: which value counts is undefined', notObject: 'TOML needs an object at the top level' }, datesToStr: 'Converted; {n} date-time(s) became strings (JSON has no date type)', verifyFail: 'Output failed verification ({p}); stopped so no data is changed', tomlUnsupported: 'Not supported yet: {m}', tomlMismatch: 'Parsers disagree ({p}); stopped so no data is changed', bomRemoved: 'leading BOM removed', dupMark: 'duplicate key', notUtf8: 'File isn’t valid UTF-8 — not opened', minCopied: 'Minified JSON copied', fmtPh: 'Paste {L}…',
  ignoreOrder: 'Ignore array order', onlyDiff: 'Only differences', swap: 'Swap', a: 'A · original', b: 'B · changed', diffTree: 'Merged', diffList: 'Change list', same: 'Semantically identical', sameSub: 'Key order, indentation and whitespace are ignored', sameButFmt: 'All values equal, but {n} written differently', fmtOnly: 'written differently', keyFmtOnly: 'key written differently', added: 'added', removed: 'removed', changed: 'changed', unchanged: '… {n} unchanged', diffs: '{n} differences', needBoth: 'Enter valid JSON / TOML on both sides to compare', invalid: 'Invalid', empty: 'Empty',
  pal: 'Search tools, or paste content…', palNone: 'No matching tools', palFoot: '↑↓ select · ↵ open · paste a timestamp / JSON to auto-detect', palDetect: 'Open with “{t}”',
  routed: 'Detected — opened “{t}”', dropHere: 'Drop to process', dropHereSub: 'Image → QR scan · .json / .toml → formatter', notImage: 'Please provide an image',
  theme: { light: 'Light', dark: 'Dark', auto: 'Auto' }, themeLong: { light: 'Light', dark: 'Dark', auto: 'System' }, relLocale: 'en',
};

export const DICT: Record<Lang, Dict> = { zh, en };

/** Fill `{name}` placeholders. */
export const f = (s: string, o?: Record<string, string | number>) =>
  String(s).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] != null ? String(o[k]) : m));

export const SAMPLE_JSON = '{"name":"toolbox","version":"1.4.2","private":true,"features":["timestamp","qrcode","format","diff"],"server":{"host":"0.0.0.0","port":8080,"tls":null,"limits":{"rps":1200,"burst":200}},"owners":[{"id":1,"name":"Lin","active":true},{"id":2,"name":"Zhou","active":false}],"updatedAt":1793000000}';
export const SAMPLE_TOML = 'title="toolbox"\nversion  = "1.4.2"\nfeatures=["timestamp","qrcode",  "format"]\n[server]\nhost="0.0.0.0"\nport=8080\n  [server.limits]\n  rps = 1200\n  burst=200\n[[owners]]\nid=1\nname="Lin"\n[[owners]]\nid=2\nname="Zhou"\n';
export const SAMPLE_A = '{"service":"gateway","port":8080,"debug":false,"tags":["api","edge"],"db":{"host":"10.0.0.5","pool":10,"timeout":30},"owners":[{"id":1,"name":"Lin"},{"id":2,"name":"Zhou"}]}';
export const SAMPLE_B = JSON.stringify({ port: 8443, service: 'gateway', db: { timeout: 30, pool: 20, host: '10.0.0.5', ssl: true }, tags: ['edge', 'api'], owners: [{ id: 1, name: 'Lin' }, { id: 2, name: 'Zhou Wei' }] }, null, 2);

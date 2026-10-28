// Tool registry, categories and UI strings (zh / en).
import { enT, zhT } from './i18n-tools';

export type ToolId = 'ts' | 'cron' | 'qrgen' | 'qrscan' | 'json' | 'toml' | 'yaml' | 'xml' | 'sql' | 'schema' | 'diff' | 'tdiff'
  | 'b64' | 'hash' | 'url' | 'uni' | 'html' | 'hex' | 'base' | 'gzip' | 'esc' | 'urlp' | 'jwt' | 'color' | 'regex' | 'case' | 'count' | 'proc' | 'uuid';
export type CatId = 'time' | 'qr' | 'fmt' | 'diff' | 'enc' | 'web' | 'text' | 'gen';
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
  { id: 'cron', cat: 'time', icon: '*/5', zh: ['Cron 表达式', 'Cron', '含义 · 接下来的执行时间'], en: ['Cron', 'Cron', 'Meaning · next run times'], kw: 'cron crontab schedule quartz spring 定时 计划任务 dsrw jhrw' },
  { id: 'qrgen', cat: 'qr', icon: '▦', zh: ['生成二维码', '生成二维码', '文本 / 链接 → 二维码'], en: ['QR Generator', 'QR Generate', 'Text or link → QR code'], kw: 'qrcode qr ewm erweima 二维码 生成 generate scsc' },
  { id: 'qrscan', cat: 'qr', icon: '⌖', zh: ['识别二维码', '识别二维码', '粘贴或拖入图片，支持一图多码'], en: ['QR Scanner', 'QR Scan', 'Paste or drop an image — finds every code'], kw: 'qr scan decode read 识别 解码 扫码 ewm shibie' },
  { id: 'json', cat: 'fmt', icon: '{}', zh: ['JSON 格式化', 'JSON', '格式化 · 折叠 · 路径'], en: ['JSON Formatter', 'JSON', 'Format · fold · copy path'], kw: 'json format pretty geshihua gsh 格式化 美化 压缩 minify tree' },
  { id: 'toml', cat: 'fmt', icon: '[]', zh: ['TOML 格式化', 'TOML', '格式化 · 折叠 · 转 JSON'], en: ['TOML Formatter', 'TOML', 'Format · fold · to JSON'], kw: 'toml format geshihua gsh 格式化 config' },
  { id: 'yaml', cat: 'fmt', icon: 'yml', zh: ['YAML 格式化', 'YAML', '重新缩进 · 值与注释不变'], en: ['YAML Formatter', 'YAML', 'Re-indent · values and comments kept'], kw: 'yaml yml format geshihua gsh 格式化 k8s kubernetes' },
  { id: 'xml', cat: 'fmt', icon: '</>', zh: ['XML 格式化', 'XML', '缩进 · 检查格式错误'], en: ['XML Formatter', 'XML', 'Indent · find errors'], kw: 'xml html svg format geshihua gsh 格式化 pom' },
  { id: 'sql', cat: 'fmt', icon: 'SQL', zh: ['SQL 格式化', 'SQL', '多种方言 · 关键字大小写'], en: ['SQL Formatter', 'SQL', 'Many dialects · keyword case'], kw: 'sql mysql postgres postgresql sqlite oracle format geshihua gsh 格式化 query' },
  { id: 'schema', cat: 'fmt', icon: '✓{}', zh: ['JSON Schema 校验', 'Schema', '按 Schema 检查 JSON'], en: ['JSON Schema', 'Schema', 'Validate JSON against a schema'], kw: 'json schema validate ajv 校验 验证 jiaoyan jy yz' },
  { id: 'diff', cat: 'diff', icon: '≠', zh: ['JSON 对比', 'JSON 对比', '语义对比：忽略 key 顺序与空白'], en: ['JSON Diff', 'JSON Diff', 'Semantic diff — key order & whitespace ignored'], kw: 'diff compare json duibi db 对比 比较 差异' },
  { id: 'tdiff', cat: 'diff', icon: '±', zh: ['文本对比', '文本对比', '逐行对比 · 标出改动的字'], en: ['Text Diff', 'Text Diff', 'Line by line · changed characters marked'], kw: 'text diff compare wenben duibi wbdb 文本 对比 比较 差异' },
  { id: 'b64', cat: 'enc', icon: '64', zh: ['Base64 编解码', 'Base64', '文本 / 文件 ⇄ Base64'], en: ['Base64', 'Base64', 'Text or file ⇄ Base64'], kw: 'base64 b64 encode decode data url 编码 解码 bianma jiema bm jm' },
  { id: 'hash', cat: 'enc', icon: '#', zh: ['哈希', '哈希', 'MD5 · SHA-1 · SHA-256，可核对'], en: ['Hash', 'Hash', 'MD5 · SHA-1 · SHA-256, with a check'], kw: 'hash md5 sha sha1 sha256 checksum digest 哈希 摘要 校验 haxi hx zy jy' },
  { id: 'url', cat: 'enc', icon: '%', zh: ['URL 编解码', 'URL 编解码', '%XX ⇄ 文本'], en: ['URL Encode', 'URL Encode', '%XX ⇄ text'], kw: 'url urlencode urldecode percent encodeuricomponent 编码 解码 bm jm' },
  { id: 'uni', cat: 'enc', icon: '\\u', zh: ['Unicode 转义', 'Unicode', '\\uXXXX ⇄ 文本 · 码点明细'], en: ['Unicode Escape', 'Unicode', '\\uXXXX ⇄ text · code points'], kw: 'unicode escape \\u codepoint utf8 utf16 转义 码点 zy' },
  { id: 'html', cat: 'enc', icon: '&;', zh: ['HTML 实体', 'HTML 实体', '&lt; ⇄ <'], en: ['HTML Entities', 'HTML Entities', '&lt; ⇄ <'], kw: 'html entity entities escape 实体 转义 st' },
  { id: 'hex', cat: 'enc', icon: '0x', zh: ['Hex 编解码', 'Hex', '文本 / 文件 ⇄ 十六进制'], en: ['Hex', 'Hex', 'Text or file ⇄ hex'], kw: 'hex hexadecimal bytes 十六进制 字节 sljz' },
  { id: 'base', cat: 'enc', icon: '0b', zh: ['进制转换', '进制转换', '2 / 8 / 10 / 16 / 任意进制 · 补码'], en: ['Number Base', 'Number Base', 'Binary, octal, hex, any base · two’s complement'], kw: 'base radix binary octal hex decimal 进制 二进制 十六进制 补码 jz jzzh' },
  { id: 'gzip', cat: 'enc', icon: 'gz', zh: ['Gzip 压缩解压', 'Gzip', 'gzip / zlib / deflate'], en: ['Gzip', 'Gzip', 'gzip / zlib / deflate'], kw: 'gzip zlib deflate compress decompress 压缩 解压 ys jy' },
  { id: 'esc', cat: 'enc', icon: '\\"', zh: ['转义 / 还原', '转义', 'JSON · JS · Java · C · SQL · Shell'], en: ['Escape', 'Escape', 'JSON · JS · Java · C · SQL · Shell'], kw: 'escape unescape string json javascript java c sql shell bash 转义 反转义 zy fzy' },
  { id: 'urlp', cat: 'web', icon: '/?', zh: ['URL 解析', 'URL 解析', '拆分链接 · 编辑查询参数'], en: ['URL Parser', 'URL Parser', 'Split a link · edit its query'], kw: 'url parse query params link 链接 解析 参数 jx lj' },
  { id: 'jwt', cat: 'web', icon: 'JWT', zh: ['JWT 解码', 'JWT', '头部 · 载荷 · 过期时间 · 签名校验'], en: ['JWT Decoder', 'JWT', 'Header · payload · expiry · signature'], kw: 'jwt token bearer jws oauth 解码 令牌 jm lp' },
  { id: 'color', cat: 'web', icon: '●', zh: ['颜色转换', '颜色', 'HEX · RGB · HSL · OKLCH · 对比度'], en: ['Color', 'Color', 'HEX · RGB · HSL · OKLCH · contrast'], kw: 'color colour hex rgb hsl oklch contrast wcag 颜色 色值 对比度 ys dbd' },
  { id: 'regex', cat: 'text', icon: '.*', zh: ['正则表达式测试', '正则测试', '匹配 · 分组 · 替换'], en: ['Regex Tester', 'Regex', 'Matches · groups · replace'], kw: 'regex regexp regular expression match replace 正则 匹配 zz zzbds' },
  { id: 'case', cat: 'text', icon: 'Aa', zh: ['命名转换', '命名转换', 'camelCase · snake_case · kebab-case…'], en: ['Case Converter', 'Case', 'camelCase · snake_case · kebab-case…'], kw: 'case camel snake kebab pascal upper lower 命名 大小写 驼峰 下划线 mm dxx tf' },
  { id: 'count', cat: 'text', icon: 'Σ', zh: ['字数统计', '字数统计', '字符 · 字节 · 行 · 词'], en: ['Word Count', 'Word Count', 'Characters · bytes · lines · words'], kw: 'count word character length bytes 字数 统计 字符 长度 zs tj' },
  { id: 'proc', cat: 'text', icon: '≡', zh: ['文本处理', '文本处理', '去重 · 排序 · 去空行 · 反转'], en: ['Line Tools', 'Lines', 'Dedupe · sort · blank lines · reverse'], kw: 'lines dedupe unique sort trim reverse 去重 排序 空行 文本 处理 qc px wbcl' },
  { id: 'uuid', cat: 'gen', icon: 'ID', zh: ['UUID 生成与解析', 'UUID', 'v4 / v7 批量生成 · 看版本和时间'], en: ['UUID', 'UUID', 'v4 / v7 in batches · version and time'], kw: 'uuid guid v4 v7 ulid generate 生成 sc' },
];

export const CATS: Record<CatId, Record<Lang, string>> = {
  time: { zh: '时间', en: 'Time' },
  qr: { zh: '二维码', en: 'QR code' },
  fmt: { zh: '格式化', en: 'Format' },
  diff: { zh: '对比', en: 'Compare' },
  enc: { zh: '编码', en: 'Encoding' },
  web: { zh: 'Web', en: 'Web' },
  text: { zh: '文本', en: 'Text' },
  gen: { zh: '生成', en: 'Generate' },
};
export const CAT_ORDER: CatId[] = ['time', 'qr', 'fmt', 'diff', 'enc', 'web', 'text', 'gen'];

export const TZ_ZH: Record<string, string> = {
  UTC: '协调世界时', 'Asia/Shanghai': '北京 / 上海', 'Asia/Hong_Kong': '香港', 'Asia/Taipei': '台北', 'Asia/Tokyo': '东京',
  'Asia/Seoul': '首尔', 'Asia/Singapore': '新加坡', 'Asia/Kolkata': '印度', 'Asia/Dubai': '迪拜', 'Europe/London': '伦敦',
  'Europe/Paris': '巴黎', 'Europe/Berlin': '柏林', 'Europe/Moscow': '莫斯科', 'America/New_York': '纽约', 'America/Chicago': '芝加哥',
  'America/Denver': '丹佛', 'America/Los_Angeles': '洛杉矶', 'America/Sao_Paulo': '圣保罗', 'Australia/Sydney': '悉尼', 'Pacific/Auckland': '奥克兰',
};
export const COMMON_TZ = ['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles'];

const zh = {
  ...zhT,
  brand: '工具箱', search: '搜索工具…', searchShort: '搜索', collapse: '收起侧栏', expand: '展开侧栏',
  now: '现在', tzSearch: '搜索城市或时区，如 tokyo / 东京 / +9', tzLocal: '本机', tzRecent: '最近使用', tzCommon: '常用', tzNone: '没有匹配的时区', tzLocalTag: ' · 本机',
  ts2t: '时间戳', t2ts: '时间', auto: '自动', units: { s: '秒', ms: '毫秒', us: '微秒', ns: '纳秒' }, tsPh: '粘贴时间戳，如 1793000000', detected: '识别为{u} · {d} 位', forced: '按{u}解析',
  rowISO: 'ISO 8601', rowUTC: 'UTC', rowRel: '相对', copy: '复制', copyText: '复制文本', tsErr: '请输入数字时间戳', tsRange: '超出可表示的时间范围', tsEmpty: '输入时间戳，结果实时显示',
  tmPh: '2026-10-26 14:30 · 明天 9点 · now', parsedAs: '解析为 {v}', dstTwice: '这个时间在夏令时切换时会出现两次：已按第一次（{a}）计算；第二次（{b}）的时间戳是 {s}', dstGap: '这个时间因夏令时切换而不存在，已按 {t} 计算', dstShifted: '目标时间因夏令时切换不存在，已调整为 {t}', foldRow: '展开 / 折叠', closeSel: '取消选择', tmErr: '无法识别。试试 2026-10-26 14:30、10/26 9:00、明天 9点、14:30 或 now', sec: '秒',
  q: { now: '现在', today: '今天 0 点', tomorrow: '明天 0 点', month: '本月 1 日', m1d: '−1 天', m1h: '−1 时', p1h: '+1 时', p1d: '+1 天' }, wd: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  copied: '已复制', qrContent: '内容', qrPh: '输入文本或链接，二维码实时生成', bytes: '{n} 字节', qrEmpty: '输入内容即时生成', qrTooLong: '内容过长，无法生成', undo: '撤销', replacedOld: '原内容已被替换', copyFail: '复制失败，请手动选择并复制', unsupportedFile: '这里不支持这种文件：请拖入图片或文本文件（.json、.toml、.yaml、.xml、.sql、.txt 等）；任意文件可在「Base64」「哈希」「Hex」「Gzip」中处理', onlyFirst: '一次只处理一个文件，已打开「{n}」', imgLoadFail: '无法读取这张图片（浏览器不支持该格式，或文件已损坏）', invisibleChars: '含 {n} 个不可见或方向控制字符（已在结果中标出）', diffTruncated: '仅显示前 {n} 条，共 {t} 条', qrBadText: '文本含孤立代理字符（无法按 UTF-8 编码），未生成', decodedAs: '按 {e} 解码（不是 UTF-8）', decodedByBrowser: '由浏览器解码，编码未知', copyRisky: '已复制；注意：内容含 NUL 或孤立代理字符，系统剪贴板可能改动它们', copiedEscaped: '值含 NUL 或孤立代理字符，剪贴板无法原样保存，已复制其转义写法', notSaved: '内容过大，浏览器无法保存；刷新页面后不会保留', processing: '处理中…', ec: '容错', dlPng: '下载 PNG', copyImg: '复制图片', clear: '清空', sample: '示例', imgCopied: '图片已复制', imgCopying: '正在复制图片…', imgCopyFail: '当前浏览器不支持复制图片', ecT: { L: '约 7%', M: '约 15%', Q: '约 25%', H: '约 30%' },
  dropTitle: '粘贴、拖入或点击选择图片', dropSub: '自动识别图中所有二维码 · 图片仅在本地处理', scanning: '识别中…', found: '识别到 {n} 个二维码', notFound: '未识别到二维码', notFoundSub: '换一张更清晰、二维码更完整的图片试试。', another: '换一张', copyAll: '复制全部', open: '打开', pasted: '粘贴的图片',
  kinds: { url: '链接', wifi: 'Wi-Fi', mail: '邮箱', tel: '电话', text: '文本' },
  input: '输入', indent2: '2 空格', indent4: '4 空格', sortKeys: '按 key 排序', toToml: '转为 TOML', toJson: '转为 JSON', viewTree: '结构', viewText: '文本', copyResult: '复制结果', expandAll: '全部展开', level: '{n} 层',
  valid: '有效 {L} · {n} 个节点 · 深度 {d}', dupKeysKept: '{n} 个重复键（已原样保留；多数程序只读取最后一个）：{p}', waiting: '在左侧输入或粘贴 {L}', errAt: '第 {l} 行，第 {c} 列', errNoPos: '解析失败', items: '{n} 项', keys: '{n} 个键', copyPath: '复制路径', copyValue: '复制值', truncated: '仅显示前 {n} 行，切换到「文本」查看全部', tomlTop: 'TOML 顶层必须是对象', cvFail: '无法转换：', cv: { null: 'TOML 没有 null（{p}）', nanInf: 'JSON 不支持 {d}（{p}）', badString: '字符串含有 TOML 无法表示的字符（{p}）', intRange: '整数 {d} 超出 TOML 的 64 位整数范围（{p}）', floatRange: '数值 {d} 超出浮点数范围（{p}）', floatPrecision: 'TOML 浮点数为双精度，无法精确表示 {d}（{p}）', dupKey: '存在重复键 {p}，无法确定应使用哪个值', notObject: 'TOML 顶层必须是对象' }, datesToStr: '已转换；{n} 个日期时间已转为字符串（JSON 没有日期类型）', verifyFail: '格式化结果校验未通过（{p}），为避免改动数据，已停止输出', tomlUnsupported: '暂不支持此写法：{m}', tomlMismatch: '解析结果与参考解析器不一致（{p}），为避免改动数据，已停止处理', bomRemoved: '已去除开头的 BOM', dupMark: '重复键', notUtf8: '文件不是有效的 UTF-8 编码，未打开', fmtPh: '粘贴 {L}…',
  ignoreOrder: '忽略数组顺序', onlyDiff: '仅显示差异', swap: '交换', a: 'A · 原始', b: 'B · 修改后', diffTree: '合并视图', diffList: '差异清单', same: '语义完全一致', sameSub: 'key 顺序、缩进、空白不影响结果', sameButFmt: '值都相同，但有 {n} 处写法不同', fmtOnly: '写法不同', keyFmtOnly: '键的写法不同', typeChg: '类型：{a} → {b}', sameInstant: '同一时刻，时区偏移不同', vk: { null: 'null', bool: '布尔', str: '字符串', num: '数字', int: '整数', float: '浮点数', odt: '带时区的日期时间', ldt: '本地日期时间', ld: '本地日期', lt: '本地时间', arr: '数组', obj: '对象' }, added: '新增', removed: '删除', changed: '修改', unchanged: '… {n} 项未变化', diffs: '{n} 处差异', needBoth: '两侧都填入有效的 JSON / TOML 后显示差异', invalid: '无效', empty: '空',
  pal: '搜索工具，或直接粘贴内容…', palNone: '没有匹配的工具', palFoot: '↑↓ 选择 · ↵ 打开 · 也可直接粘贴时间戳 / JSON 自动识别', palDetect: '用「{t}」处理输入的内容',
  routed: '已识别，打开「{t}」', dropHere: '松开即可识别', dropHereSub: '图片 → 识别二维码 · .json / .toml / .yaml / .xml / .sql → 格式化 · 其他文本文件按内容识别', dropText: '文本文件 → 填入 A / B（两个文件分别填入）', dropAny: '读取这个文件（任何类型）', dropDiff: '.json / .toml → 填入 A / B（两个文件分别填入）', diffFiles: '已填入 A：{a}；B：{b}', notImage: '请提供图片文件',
  filledSide: '已填入 {s}', clickCopy: '点击复制', qrImgLabel: '二维码（点击复制图片）', pickFile: '选择文件', removeFile: '移除文件', unknownType: '类型未知', fileSize: '{h}（{n} 字节）', eol: '换行', readFail: '无法读取这个文件', result: '结果',
  crPasted: '粘贴的内容用的是 CRLF（Windows）换行，输入框已转为 LF；要按原文计算请选 CRLF，或直接拖入文件', badText: '文本含孤立代理字符（无法按 UTF-8 编码）', utf8Of: '按 UTF-8 编码 · {n} 字节', fileOf: '文件原样 · {n} 字节',
  b64: { enc: '编码', dec: '解码', std: '标准', url: 'URL 安全', pad: '补齐 =', dataUrl: '输出 data URL', dataUrlStd: 'data URL 固定用标准字符集并补齐', encPh: '输入要编码的文本，或拖入任意文件', decPh: '粘贴 Base64 或 data URL', empty: '结果实时显示', encInfo: '{n} 字节 → {c} 个字符', text: '文本', hex: '十六进制', decText: 'UTF-8 文本 · {n} 字节', decBin: '{n} 字节 · 不是有效的 UTF-8 文本，以十六进制显示', dl: '下载', outFirst: '仅显示前 {n} 个字符；复制得到全部', hexFirst: '仅显示前 {n} 字节；下载得到全部', tooBig: '文件超过 {n} MB，Base64 结果过大，未处理', notText: '这个文件的内容不是 Base64，已切换到「编码」，按文件原样编码', e: { char: '「{c}」不是 Base64 字符', mixed: '同时出现了标准（+ /）和 URL 安全（- _）两套字符', pad: '= 只能在末尾，数量要让总长度是 4 的倍数', len: '去掉空白后有 {n} 个字符，除以 4 余 1，不是完整的 Base64' }, n: { dataUrl: '已去掉开头的 data URL 前缀（{m}）', url: '按 URL 安全字符集（- _）解码', noPad: '末尾没有补齐的 =，已按无补齐解码', ws: '已忽略中间的 {n} 个空白或换行', bits: '最后一个字符里有不为 0 的多余位，已丢弃：这段 Base64 不是规范写法，重新编码会得到不同的文本' }, noType: '未注明类型', switched: '已按内容切换到「{m}」' },
  hs: { ph: '输入文本，或拖入任意文件', empty: '输入文本或选择文件后显示', busy: '计算中… {p}%', check: '核对', checkPh: '粘贴要核对的哈希值', checkHint: '十六进制、Base64，或 sha256sum 输出的一行都可以', ok: '✓ 与 {a} 一致', bad: '✗ 与 {a} 不一致', unknown: '无法识别：MD5 / SHA-1 / SHA-256 分别是 32 / 40 / 64 位十六进制', hexLen: '这是 {n} 位十六进制；MD5 / SHA-1 / SHA-256 分别是 32 / 40 / 64 位', viaB64: '按 Base64 比较', toCheck: '已填入「核对」' },
  theme: { light: '浅', dark: '深', auto: '自动' }, themeLong: { light: '浅色', dark: '深色', auto: '跟随系统' }, relLocale: 'zh-CN',
};

export type Dict = typeof zh;

const en: Dict = {
  ...enT,
  brand: 'Toolbox', search: 'Search tools…', searchShort: 'Search', collapse: 'Collapse sidebar', expand: 'Expand sidebar',
  now: 'Now', tzSearch: 'Search city or zone — tokyo, +9…', tzLocal: 'This device', tzRecent: 'Recent', tzCommon: 'Common', tzNone: 'No matching time zone', tzLocalTag: ' · this device',
  ts2t: 'Timestamp', t2ts: 'Date', auto: 'Auto', units: { s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds' }, tsPh: 'Paste a timestamp, e.g. 1793000000', detected: 'Detected {u} · {d} digits', forced: 'Read as {u}',
  rowISO: 'ISO 8601', rowUTC: 'UTC', rowRel: 'Relative', copy: 'Copy', copyText: 'Copy text', tsErr: 'Enter a numeric timestamp', tsRange: 'Out of representable range', tsEmpty: 'Type a timestamp — results appear instantly',
  tmPh: '2026-10-26 14:30 · tomorrow 9:00 · now', parsedAs: 'Parsed as {v}', dstTwice: 'This time occurs twice (DST change): using the first ({a}); the second ({b}) is {s}', dstGap: 'This time doesn’t exist (DST change); using {t}', dstShifted: 'That time doesn’t exist (DST change); adjusted to {t}', foldRow: 'Expand / collapse', closeSel: 'Clear selection', tmErr: 'Not recognised. Try 2026-10-26 14:30, 10/26 9:00, tomorrow 9:00, 14:30 or now', sec: 'sec',
  q: { now: 'Now', today: 'Today 00:00', tomorrow: 'Tomorrow 00:00', month: '1st of month', m1d: '−1 d', m1h: '−1 h', p1h: '+1 h', p1d: '+1 d' }, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  copied: 'Copied', qrContent: 'Content', qrPh: 'Type text or a link — the code updates live', bytes: '{n} bytes', qrEmpty: 'Start typing to generate', qrTooLong: 'Too long for a QR code', undo: 'Undo', replacedOld: 'previous content replaced', copyFail: 'Copy failed — please select and copy manually', unsupportedFile: 'Unsupported here: drop an image or a text file (.json, .toml, .yaml, .xml, .sql, .txt …); any file works in Base64, Hash, Hex or Gzip', onlyFirst: 'One file at a time — opened “{n}”', imgLoadFail: 'Can’t read this image (format not supported by the browser, or the file is damaged)', invisibleChars: '{n} invisible or direction-control character(s) (marked in the result)', diffTruncated: 'Showing the first {n} of {t}', qrBadText: 'Text has lone surrogates (no UTF-8 encoding); not generated', decodedAs: 'decoded as {e} (not UTF-8)', decodedByBrowser: 'decoded by the browser, encoding unknown', copyRisky: 'Copied; note: contains NUL or lone surrogates, which the system clipboard may alter', copiedEscaped: 'Value has NUL or lone surrogates the clipboard can’t keep; copied its escaped form', notSaved: 'Too large for browser storage; it won’t survive a reload', processing: 'Processing…', ec: 'Error correction', dlPng: 'Download PNG', copyImg: 'Copy image', clear: 'Clear', sample: 'Sample', imgCopied: 'Image copied', imgCopying: 'Copying image…', imgCopyFail: 'This browser can’t copy images', ecT: { L: '~7%', M: '~15%', Q: '~25%', H: '~30%' },
  dropTitle: 'Paste, drop or click to choose an image', dropSub: 'Finds every QR code in the image · processed locally', scanning: 'Scanning…', found: '{n} QR code(s) found', notFound: 'No QR code found', notFoundSub: 'Try a sharper image where the whole code is visible.', another: 'Another image', copyAll: 'Copy all', open: 'Open', pasted: 'Pasted image',
  kinds: { url: 'Link', wifi: 'Wi-Fi', mail: 'Email', tel: 'Phone', text: 'Text' },
  input: 'Input', indent2: '2 spaces', indent4: '4 spaces', sortKeys: 'Sort keys', toToml: 'To TOML', toJson: 'To JSON', viewTree: 'Tree', viewText: 'Text', copyResult: 'Copy result', expandAll: 'Expand all', level: 'Level {n}',
  valid: 'Valid {L} · {n} nodes · depth {d}', dupKeysKept: '{n} duplicate key(s), kept as written (most programs read only the last): {p}', waiting: 'Type or paste {L} on the left', errAt: 'Line {l}, column {c}', errNoPos: 'Parse error', items: '{n} items', keys: '{n} keys', copyPath: 'Copy path', copyValue: 'Copy value', truncated: 'Showing first {n} rows — switch to Text for everything', tomlTop: 'TOML needs an object at the top level', cvFail: 'Can’t convert: ', cv: { null: 'TOML has no null ({p})', nanInf: 'JSON has no {d} ({p})', badString: 'String has characters TOML can’t represent ({p})', intRange: 'Integer {d} is outside TOML’s 64-bit range ({p})', floatRange: 'Number {d} is outside the float range ({p})', floatPrecision: 'TOML floats are doubles and can’t hold {d} exactly ({p})', dupKey: 'Duplicate key {p}: which value counts is undefined', notObject: 'TOML needs an object at the top level' }, datesToStr: 'Converted; {n} date-time(s) became strings (JSON has no date type)', verifyFail: 'Output failed verification ({p}); stopped so no data is changed', tomlUnsupported: 'Not supported yet: {m}', tomlMismatch: 'Parsers disagree ({p}); stopped so no data is changed', bomRemoved: 'leading BOM removed', dupMark: 'duplicate key', notUtf8: 'File isn’t valid UTF-8 — not opened', fmtPh: 'Paste {L}…',
  ignoreOrder: 'Ignore array order', onlyDiff: 'Only differences', swap: 'Swap', a: 'A · original', b: 'B · changed', diffTree: 'Merged', diffList: 'Change list', same: 'Semantically identical', sameSub: 'Key order, indentation and whitespace are ignored', sameButFmt: 'All values equal, but {n} written differently', fmtOnly: 'written differently', keyFmtOnly: 'key written differently', typeChg: 'type: {a} → {b}', sameInstant: 'same instant, different UTC offset', vk: { null: 'null', bool: 'boolean', str: 'string', num: 'number', int: 'integer', float: 'float', odt: 'offset date-time', ldt: 'local date-time', ld: 'local date', lt: 'local time', arr: 'array', obj: 'object' }, added: 'added', removed: 'removed', changed: 'changed', unchanged: '… {n} unchanged', diffs: '{n} differences', needBoth: 'Enter valid JSON / TOML on both sides to compare', invalid: 'Invalid', empty: 'Empty',
  pal: 'Search tools, or paste content…', palNone: 'No matching tools', palFoot: '↑↓ select · ↵ open · paste a timestamp / JSON to auto-detect', palDetect: 'Open with “{t}”',
  routed: 'Detected — opened “{t}”', dropHere: 'Drop to process', dropHereSub: 'Image → QR scan · .json / .toml / .yaml / .xml / .sql → formatter · other text files by content', dropText: 'Text files → fill A / B (two files fill both)', dropAny: 'Reads this file (any type)', dropDiff: '.json / .toml → fills A / B (two files fill both)', diffFiles: 'Filled in A: {a}; B: {b}', notImage: 'Please provide an image',
  filledSide: 'Filled in {s}', clickCopy: 'Click to copy', qrImgLabel: 'QR code (click to copy the image)', pickFile: 'Choose file', removeFile: 'Remove file', unknownType: 'unknown type', fileSize: '{h} ({n} bytes)', eol: 'Line breaks', readFail: 'Can’t read this file', result: 'Result',
  crPasted: 'The pasted text used CRLF (Windows) line breaks; the input box turned them into LF. Choose CRLF to use the original, or drop the file itself', badText: 'Text has lone surrogates (no UTF-8 encoding)', utf8Of: 'UTF-8 · {n} bytes', fileOf: 'file as is · {n} bytes',
  b64: { enc: 'Encode', dec: 'Decode', std: 'Standard', url: 'URL-safe', pad: 'Pad =', dataUrl: 'Output data URL', dataUrlStd: 'data URLs always use the standard alphabet with padding', encPh: 'Type text to encode, or drop any file', decPh: 'Paste Base64 or a data URL', empty: 'The result appears as you type', encInfo: '{n} bytes → {c} characters', text: 'Text', hex: 'Hex', decText: 'UTF-8 text · {n} bytes', decBin: '{n} bytes · not valid UTF-8 text, shown as hex', dl: 'Download', outFirst: 'Showing the first {n} characters; Copy gets all of it', hexFirst: 'Showing the first {n} bytes; Download gets all of it', tooBig: 'File is over {n} MB; its Base64 would be too large, not processed', notText: 'This file’s content isn’t Base64; switched to Encode, encoding the file as is', e: { char: '“{c}” is not a Base64 character', mixed: 'Mixes the standard (+ /) and URL-safe (- _) alphabets', pad: '= may only come at the end, making the length a multiple of 4', len: '{n} characters without whitespace leaves 1 over a multiple of 4: not complete Base64' }, n: { dataUrl: 'Removed the data URL prefix ({m})', url: 'Decoded with the URL-safe alphabet (- _)', noPad: 'No = padding at the end; decoded as unpadded', ws: 'Ignored {n} space(s) or line break(s) in the middle', bits: 'The last character has non-zero bits beyond the data, dropped: this Base64 isn’t canonical, re-encoding gives different text' }, noType: 'no type given', switched: 'Switched to {m} for this content' },
  hs: { ph: 'Type text, or drop any file', empty: 'Shown once there is text or a file', busy: 'Hashing… {p}%', check: 'Check', checkPh: 'Paste a hash to check', checkHint: 'hex, Base64, or a line of sha256sum output', ok: '✓ Matches {a}', bad: '✗ Does not match {a}', unknown: 'Not recognised: MD5 / SHA-1 / SHA-256 are 32 / 40 / 64 hex digits', hexLen: 'That is {n} hex digits; MD5 / SHA-1 / SHA-256 are 32 / 40 / 64', viaB64: 'compared as Base64', toCheck: 'Put into Check' },
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

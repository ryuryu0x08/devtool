// SQL formatting with sql-formatter, checked token by token: strings, quoted names, numbers,
// comments and operators must come out exactly as written; only keywords may change case (when
// asked); whitespace may change except where it would split an operator.
import { format, type SqlLanguage } from 'sql-formatter';

export type KwCase = 'preserve' | 'upper' | 'lower';
export const DIALECTS: SqlLanguage[] = ['sql', 'mysql', 'mariadb', 'postgresql', 'sqlite', 'transactsql', 'plsql', 'bigquery', 'snowflake', 'redshift', 'spark', 'hive', 'trino', 'duckdb', 'clickhouse', 'db2', 'db2i', 'n1ql', 'singlestoredb', 'tidb'];

export class SqlError extends Error {
  constructor(message: string, readonly line: number | null, readonly column: number | null) { super(message); }
}
export class SqlVerifyError extends Error {
  constructor(readonly pos: number) { super('verify at ' + pos); }
}

// Words sql-formatter may re-case; anything else (table and column names) must stay as written.
const KEYWORDS = new Set(`ADD ALL ALTER AND ANY AS ASC BETWEEN BY CASE CAST CHECK COLUMN CONSTRAINT CREATE CROSS CURRENT_DATE
CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DELETE DESC DISTINCT DROP ELSE END ESCAPE EXCEPT EXISTS FALSE FETCH FIRST FOR
FOREIGN FROM FULL GROUP HAVING IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY LEFT LIKE ILIKE LIMIT NATURAL NOT NULL OFFSET
ON OR ORDER OUTER OVER PARTITION PRIMARY REFERENCES RETURNING RIGHT ROW ROWS SELECT SET TABLE THEN TOP TRUE TRUNCATE UNION
UNIQUE UPDATE USING VALUES VIEW WHEN WHERE WINDOW WITH RECURSIVE LATERAL APPLY MERGE MATCHED REPLACE IGNORE DUPLICATE
CONFLICT DO NOTHING NULLS LAST ONLY NEXT PERCENT TIES QUALIFY PIVOT UNPIVOT SHOW USE BEGIN COMMIT ROLLBACK TRANSACTION
GRANT REVOKE TO PROCEDURE FUNCTION RETURNS RETURN DECLARE TRIGGER EACH BEFORE AFTER INSTEAD OF EXECUTE EXEC CALL LOOP WHILE
ELSIF ELSEIF ROLLUP CUBE GROUPING SETS FILTER WITHIN RANGE UNBOUNDED PRECEDING FOLLOWING CURRENT INTERVAL COLLATE
ASOF SEMI ANTI STRAIGHT_JOIN LOCK SHARE NOWAIT SKIP LOCKED AUTO_INCREMENT ENGINE CHARSET TEMPORARY TEMP UNLOGGED
CASCADE RESTRICT RENAME MODIFY CHANGE COMMENT EXPLAIN ANALYZE VACUUM PRAGMA ATTACH DETACH OUTPUT GO`.split(/\s+/));

interface Tok { k: 'w' | 's' | 'n' | 'c' | 'o'; t: string; pos: number }

function lex(s: string, hashComments: boolean, backslash: boolean): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const push = (k: Tok['k'], j: number) => { out.push({ k, t: s.slice(i, j), pos: i }); i = j; };
  const quoted = (q: string, close = q) => {
    // PostgreSQL E'…' strings take backslash escapes even where plain strings don't.
    const prev = out[out.length - 1];
    const bsHere = backslash || (q === "'" && !!prev && prev.k === 'w' && /^[eE]$/.test(prev.t) && prev.pos + 1 === i);
    let j = i + 1;
    for (; j < s.length; j++) {
      if (bsHere && q === "'" && s[j] === '\\') { j++; continue; }
      if (s[j] === close) { if (s[j + 1] === close && close === q) { j++; continue; } return j + 1; }
    }
    return s.length;
  };
  while (i < s.length) {
    const c = s[i], rest = s.slice(i);
    let m: RegExpExecArray | null;
    if (/\s/.test(c)) { i++; continue; }
    if (rest.startsWith('--') || (hashComments && c === '#')) { const j = s.indexOf('\n', i); push('c', j < 0 ? s.length : j); continue; }
    if (rest.startsWith('/*')) { const j = s.indexOf('*/', i + 2); push('c', j < 0 ? s.length : j + 2); continue; }
    if (c === "'") { push('s', quoted("'")); continue; }
    if (c === '"') { push('s', quoted('"')); continue; }
    if (c === '`') { push('s', quoted('`')); continue; }
    if (c === '[' && /^\[[^\]\s]*\]/.test(rest) && out.length && out[out.length - 1].k !== 'n') { push('s', quoted('[', ']')); continue; }
    if ((m = /^\$([A-Za-z_]\w*)?\$/.exec(rest))) { const end = s.indexOf(m[0], i + m[0].length); push('s', end < 0 ? s.length : end + m[0].length); continue; }
    if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) { push('n', i + m[0].length); continue; }
    if ((m = /^[A-Za-z_\u0080-￿][\w$\u0080-￿]*/.exec(rest))) { push('w', i + m[0].length); continue; }
    if ((m = /^[<>=!~^&|%*+\-/:@#?]+/.exec(rest))) {
      // As PostgreSQL reads them: an operator does not end in + or - (so "=-1" is "=" "-1").
      let op = m[0];
      while (op.length > 1 && /[+-]$/.test(op) && !/[~!@#%^&|`?]/.test(op)) op = op.slice(0, -1);
      // A comment start inside an operator run ends it.
      const cm = op.search(/--|\/\*/);
      if (cm > 0) op = op.slice(0, cm);
      push('o', i + op.length);
      continue;
    }
    push('o', i + 1);
  }
  return out;
}

const indentless = (c: string) => c.split('\n').map((l) => l.trim()).join('\n');

export interface SqlOut { text: string; commentsReindented: boolean }

export function formatSql(src: string, language: SqlLanguage, keywordCase: KwCase, indent: 2 | 4): SqlOut {
  let text: string;
  try {
    text = format(src, { language, keywordCase, tabWidth: indent, linesBetweenQueries: 1 });
  } catch (e) {
    const msg = String((e as Error).message || e);
    const m = /line (\d+) column (\d+)/i.exec(msg);
    throw new SqlError(msg.split('\n')[0], m ? +m[1] : null, m ? +m[2] : null);
  }
  const hash = /mysql|mariadb|tidb|singlestoredb|hive|spark|bigquery/.test(language);
  const bs = /mysql|mariadb|tidb|singlestoredb|hive|spark|bigquery|clickhouse/.test(language);
  const a = lex(src, hash, bs), b = lex(text, hash, bs);
  let reindented = false;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (!x || !y || x.k !== y.k) throw new SqlVerifyError(x ? x.pos : src.length);
    if (x.t === y.t) continue;
    if (x.k === 'w' && x.t.toUpperCase() === y.t.toUpperCase() && keywordCase !== 'preserve' && KEYWORDS.has(x.t.toUpperCase())) continue;
    if (x.k === 'c' && x.t.startsWith('/*') && indentless(x.t) === indentless(y.t)) { reindented = true; continue; }
    throw new SqlVerifyError(x.pos);
  }
  return { text: text.endsWith('\n') ? text : text + '\n', commentsReindented: reindented };
}

export const looksSql = (s: string) =>
  /^\s*(select|insert\s+into|update|delete\s+from|create\s+(table|view|index|unique|or)|alter\s+table|drop\s+(table|view|index)|with\s+\w+\s+as\s*\(|merge\s+into|truncate\s+table)\b/i.test(s) &&
  /\b(from|into|set|table|view|index|values|as|where)\b/i.test(s);

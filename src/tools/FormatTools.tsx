// YAML, XML and SQL formatting (each checked so no data changes), and JSON Schema validation.
import { useMemo, type ReactNode } from 'react';
import type { SqlLanguage } from 'sql-formatter';
import { f } from '../i18n';
import { Pair } from '../components/Split';
import { useApp, type State } from '../store';
import { Seg } from '../components/Seg';
import { useSettled } from '../components/useSettled';
import { Empty, ErrLine, Grid, OutCard, TextIn, TextOut, Toolbar, errStatus, useOpt } from '../components/Panes';
import { errInfo, type ErrInfo } from '../lib/data';
import { YamlError, YamlVerifyError, formatYaml } from '../lib/yamlfmt';
import { XmlError, XmlVerifyError, formatXml } from '../lib/xml';
import { DIALECTS, SqlError, SqlVerifyError, formatSql, type KwCase } from '../lib/sqlfmt';
import { SchemaError, validateJson, type SchemaResult } from '../lib/schema';
import { parseJsonAst } from '../lib/json';

interface FmtOut { text?: string; status?: string; notes?: string[]; err?: { msg: string; info: ErrInfo | null } }

/** One input, one formatted result. */
function FmtPage(p: { inKey: keyof State; placeholder: string; options: ReactNode; run: (t: string) => FmtOut }) {
  const { S, set, T, replace } = useApp();
  const value = S[p.inKey] as string;
  const [text, pending] = useSettled(value);
  const r = useMemo(() => (text.trim() ? p.run(text) : null), [text, p.run]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tool-stack">
      <Toolbar>{p.options}</Toolbar>
      <Pair>
        <TextIn title={T.input} value={value} placeholder={p.placeholder} size={value ? f(T.ui.lines, { n: value.split('\n').length }) : ''}
          onChange={(v) => set({ [p.inKey]: v })} onClear={() => replace({ [p.inKey]: '' })} minH={320} />
        <OutCard status={pending ? T.processing : !r ? T.result : r.err ? errStatus(T, r.err.info) : r.status ?? T.ui.ok} bad={!!r?.err} notes={r?.notes}>
          {!r || pending ? <Empty /> : r.err ? <ErrLine msg={r.err.msg} info={r.err.info} /> : <TextOut text={r.text ?? ''} />}
        </OutCard>
      </Pair>
    </div>
  );
}

function IndentSeg({ id, tab }: { id: string; tab?: boolean }) {
  const { T } = useApp();
  const [v, setV] = useOpt<string>(id + '.indent', '2', tab ? ['2', '4', 'tab'] : ['2', '4']);
  return <Seg value={v} onChange={setV} opts={[{ value: '2', label: f(T.ui.spaces, { n: 2 }) }, { value: '4', label: f(T.ui.spaces, { n: 4 }) }, ...(tab ? [{ value: 'tab', label: T.ui.tab }] : [])]} />;
}

export function YamlFmt() {
  const { T } = useApp();
  const [indent] = useOpt<string>('yaml.indent', '2', ['2', '4']);
  const run = useMemo(() => (t: string): FmtOut => {
    try {
      const r = formatYaml(t, indent === '4' ? 4 : 2);
      const notes = [...(r.changed.length ? [f(T.yaml.changed, { n: r.changed.length, a: r.changed[0].from, b: r.changed[0].to })] : []), ...r.warnings];
      return { text: r.text, status: f(T.yaml.valid, { n: r.docs }), notes };
    } catch (e) {
      if (e instanceof YamlVerifyError) return { err: { msg: f(T.yaml.verify, { p: e.what }), info: null } };
      if (e instanceof YamlError) return { err: { msg: e.message, info: errInfo(e, t) } };
      throw e;
    }
  }, [indent, T]);
  return <FmtPage inKey="yamlIn" placeholder={T.yaml.ph} run={run} options={<IndentSeg id="yaml" />} />;
}

export function XmlFmt() {
  const { T } = useApp();
  const [indent] = useOpt<string>('xml.indent', '2', ['2', '4', 'tab']);
  const run = useMemo(() => (t: string): FmtOut => {
    try {
      const text = formatXml(t, indent === 'tab' ? '\t' : ' '.repeat(Number(indent)));
      return { text, notes: [T.xml.note, ...(t.charCodeAt(0) === 0xfeff ? [T.bomRemoved] : [])] };
    } catch (e) {
      if (e instanceof XmlVerifyError) return { err: { msg: T.xml.verify, info: null } };
      if (e instanceof XmlError) return { err: { msg: f(T.xml.e[e.code], { a: e.arg }), info: errInfo(e, t) } };
      throw e;
    }
  }, [indent, T]);
  return <FmtPage inKey="xmlIn" placeholder={T.xml.ph} run={run} options={<IndentSeg id="xml" tab />} />;
}

const DIALECT_NAME: Partial<Record<SqlLanguage, string>> = {
  sql: 'Standard SQL', mysql: 'MySQL', mariadb: 'MariaDB', postgresql: 'PostgreSQL', sqlite: 'SQLite', transactsql: 'SQL Server', plsql: 'Oracle PL/SQL',
  bigquery: 'BigQuery', snowflake: 'Snowflake', redshift: 'Redshift', spark: 'Spark', hive: 'Hive', trino: 'Trino', duckdb: 'DuckDB', clickhouse: 'ClickHouse',
  db2: 'Db2', db2i: 'Db2 for i', n1ql: 'N1QL', singlestoredb: 'SingleStore', tidb: 'TiDB',
};

export function SqlFmt() {
  const { T } = useApp();
  const [dialect, setDialect] = useOpt<SqlLanguage>('sql.dialect', 'sql', DIALECTS);
  const [kw, setKw] = useOpt<KwCase>('sql.kw', 'upper', ['preserve', 'upper', 'lower']);
  const [indent] = useOpt<string>('sql.indent', '2', ['2', '4']);
  const run = useMemo(() => (t: string): FmtOut => {
    try {
      const r = formatSql(t, dialect, kw, indent === '4' ? 4 : 2);
      return { text: r.text, notes: r.commentsReindented ? [T.sql.reindented] : [] };
    } catch (e) {
      if (e instanceof SqlVerifyError) return { err: { msg: T.sql.verify, info: errInfo(e, t) } };
      if (e instanceof SqlError) return { err: { msg: e.message, info: e.line ? errInfo({ line: e.line, column: e.column }, t) : null } };
      throw e;
    }
  }, [dialect, kw, indent, T]);
  return (
    <FmtPage inKey="sqlIn" placeholder={T.sql.ph} run={run} options={<>
      <label className="num-in"><span>{T.sql.dialect}</span>
        <select className="field" value={dialect} onChange={(e) => setDialect(e.target.value as SqlLanguage)} aria-label={T.sql.dialect} style={{ height: 32, fontSize: 13, padding: '0 8px', fontWeight: 400, width: 'auto' }}>
          {DIALECTS.map((d) => <option key={d} value={d}>{DIALECT_NAME[d] ?? d}</option>)}
        </select>
      </label>
      <Seg value={kw} onChange={setKw} opts={[{ value: 'upper', label: T.ui.upper }, { value: 'lower', label: T.sql.lower }, { value: 'preserve', label: T.sql.keep }]} />
      <IndentSeg id="sql" />
    </>} />
  );
}

/** Syntax error of one side, so the message says which box it is in. */
function jsonErr(text: string): ErrInfo | null {
  try { parseJsonAst(text); return null; } catch (e) { return errInfo(e, text); }
}

export function Schema() {
  const { S, set, T, replace, lang } = useApp();
  const [schemaText, p1] = useSettled(S.schemaIn);
  const [dataText, p2] = useSettled(S.schemaData);
  type R = { k: 'syntax'; side: string; info: ErrInfo } | { k: 'msg'; msg: string } | { k: 'res'; res: SchemaResult } | null;
  const r = useMemo((): R => {
    if (!schemaText.trim() || !dataText.trim()) return null;
    const se = jsonErr(schemaText);
    if (se) return { k: 'syntax', side: T.schema.schema, info: se };
    const de = jsonErr(dataText);
    if (de) return { k: 'syntax', side: T.schema.data, info: de };
    try { return { k: 'res', res: validateJson(schemaText, dataText, lang) }; } catch (e) {
      if (!(e instanceof SchemaError)) throw e;
      const d = e.detail.replace(/^schema:/, T.schema.schema + ' ').replace(/^data:/, T.schema.data + ' ');
      return { k: 'msg', msg: f(T.schema.e[e.code], { d }) };
    }
  }, [schemaText, dataText, lang, T]);
  const res = r?.k === 'res' ? r.res : null;
  const notes = res ? [
    f(T.schema.draft, { d: 'draft ' + res.draft }),
    ...(res.ignored.length ? [f(T.schema.ignored, { w: res.ignored.join('；') })] : []),
    ...(res.inexact.length ? [f(T.schema.inexact, { n: res.inexact.length, p: res.inexact.slice(0, 3).join(', ') })] : []),
  ] : [];
  return (
    <div className="tool-stack">
      <Grid>
        <TextIn title={T.schema.schema} value={S.schemaIn} placeholder={T.schema.schemaPh} minH={260} onChange={(v) => set({ schemaIn: v })} onClear={() => replace({ schemaIn: '' })} />
        <TextIn title={T.schema.data} value={S.schemaData} placeholder={T.schema.dataPh} minH={260} focus={false} onChange={(v) => set({ schemaData: v })} onClear={() => replace({ schemaData: '' })} />
      </Grid>
      <OutCard className="schema-out" status={p1 || p2 ? T.processing : !r ? T.schema.need : res ? (res.valid ? T.schema.pass : f(T.schema.fail, { n: res.issues.length })) : r.k === 'syntax' ? r.side + ' · ' + errStatus(T, r.info) : T.invalid}
        bad={!!r && (!res || !res.valid)} notes={notes}>
        {!r ? <Empty>{T.schema.need}</Empty>
          : r.k === 'syntax' ? <ErrLine msg={r.info.msg} info={r.info} />
            : r.k === 'msg' ? <ErrLine msg={r.msg} />
              : res && !res.valid ? (
                <table className="tbl schema-issues">
                  <tbody>{res.issues.map((i, k) => (
                    <tr key={k}><td className="mono" style={{ whiteSpace: 'nowrap' }}>{i.path}</td><td>{i.message}</td><td className="mono" style={{ color: 'var(--faint)' }}>{i.schemaPath}</td></tr>
                  ))}</tbody>
                </table>
              ) : null}
      </OutCard>
    </div>
  );
}

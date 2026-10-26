/** Invisible / direction-control characters other than ordinary whitespace. */
const INV = /((?![ \t\n\r])[\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Cc}])/u;
const INV_ALL = /(?![ \t\n\r])[\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Cc}]/gu;

export const countInvisible = (s: string) => (s.match(INV_ALL) || []).length;

/**
 * Text with invisible characters made visible: each keeps the real character (copying stays
 * exact) and gets a U+XXXX label drawn by CSS, isolated so bidi controls can't reorder the text.
 */
export function Vis({ text }: { text: string }) {
  if (!INV.test(text)) return <>{text}</>;
  return (
    <>
      {text.split(INV).map((part, i) =>
        i % 2 ? <span key={i} className="inv" data-cp={'U+' + part.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>{part}</span> : part,
      )}
    </>
  );
}

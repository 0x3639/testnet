export function Tooltip({ text }: { text: string }) {
  return (
    <button type="button" className="tip" data-tip={text} aria-label={text} onClick={(event) => event.preventDefault()}>
      ?
    </button>
  );
}

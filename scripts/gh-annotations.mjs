// node:test reporter for GitHub Actions: each failing test becomes an annotation, so failures
// can be read on the run page (and through the public API) without the full log.
export default async function* annotations(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const error = event.data.details?.error;
    const text = String(error?.cause?.stack || error?.cause || error?.message || error || 'failed');
    const encoded = `${event.data.name}: ${text}`
      .slice(0, 1500)
      .replace(/%/g, '%25')
      .replace(/\r?\n/g, '%0A');
    yield `::error title=Unit test failed::${encoded}\n`;
  }
}

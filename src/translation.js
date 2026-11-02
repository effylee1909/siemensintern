// Browser Translator API only: no HTTP translation endpoint or API credentials.
const unsupported = '此瀏覽器不支援本機翻譯。請使用支援 Translator API 的新版桌面 Edge 或 Chrome；原有內容未變更。';
export async function discussionHash(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text || ''));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function translationBadge(entry) {
  if (!entry?.descriptionEn?.trim()) return { text: '', stale: false };
  const meta = entry.discussionTranslation;
  if (!meta) return { text: '英文可直接修改', stale: false };
  const [source, target] = await Promise.all([discussionHash(entry.description), discussionHash(entry.descriptionEn)]);
  if (source !== meta.sourceHash) return { text: '中文已更新，英文待同步', stale: true };
  if (target !== meta.targetHash || meta.mode === 'manual') return { text: '英文已手動修改', stale: false };
  return { text: '已翻譯・可直接修改', stale: false };
}
export async function createLocalTranslator({ signal, onProgress = () => {} } = {}) {
  const api = globalThis.Translator;
  if (!globalThis.isSecureContext || typeof api?.availability !== 'function' || typeof api?.create !== 'function') throw Error(unsupported);
  let pair;
  for (const sourceLanguage of ['zh-Hant', 'zh']) {
    signal?.throwIfAborted();
    const options = { sourceLanguage, targetLanguage: 'en' };
    try {
      const availability = await api.availability(options);
      if (['available','downloadable','downloading'].includes(availability)) { pair = options; break; }
    } catch (e) { if (signal?.aborted) throw e; }
  }
  if (!pair) throw Error('此裝置目前無法提供中文轉英文本機模型。原有內容未變更，沒有改用外部服務。');
  onProgress('準備本機翻譯模型；首次使用可能需要下載語言模型。');
  signal?.throwIfAborted();
  let translator;
  try { translator = await api.create({ ...pair, signal, monitor(monitor) {
    monitor.addEventListener('downloadprogress', event => {
      const ratio = Number.isFinite(event.total) && event.total > 0 ? event.loaded / event.total : (event.loaded <= 1 ? event.loaded : NaN);
      const progress = Number.isFinite(ratio) ? ` ${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` : '';
      onProgress(`下載本機語言模型${progress}；會議文字不會送到外部翻譯服務。`);
    });
  }}); } catch (e) {
    if (signal?.aborted || e.name === 'AbortError') throw e;
    throw Error('本機語言模型建立失敗。請確認 Edge／Chrome 已更新、允許下載語言模型，再重試；原有內容未更動。');
  }
  return translator;
}
// Keep numeric dates, quantities, letter references and technical identifiers literal.
export function protectDiscussion(text) {
  let stem = 'ZXQKEEP', collision = 0;
  while (text.includes(stem)) stem = `ZXQKEEP${++collision}X`;
  const tokens = [];
  const masked = text.replace(/[A-Za-z][A-Za-z0-9/-]*字第[0-9０-９]+號|字第[0-9０-９]+號|\b[A-Z]{2,}[A-Z0-9]*(?:[._/-][A-Z0-9]+)+\b|\b[A-Z]{2,}(?:[&/][A-Z]{2,})*\b|\d{3,4}[年/.-]\d{1,2}[月/.-]\d{1,2}日?|[+-]?\d+(?:[.,]\d+)*(?:[%％])?/g, value => {
    const placeholder = `${stem}${String(tokens.length).padStart(5, '0')}QXZ`;
    tokens.push({ placeholder, value }); return placeholder;
  });
  return { masked, restore(output) {
    for (const {placeholder, value} of tokens) {
      const match = new RegExp(placeholder, 'gi');
      if ((output.match(match) || []).length !== 1) throw Error('翻譯模型未完整保留日期、數字或設備代碼，本段未套用。');
      output = output.replace(match, () => value);
    }
    if (output.includes(stem)) throw Error('翻譯結果包含未還原的代碼，本段未套用。');
    return output;
  }};
}
function chunks(text) {
  const result = [];
  while (text.length > 1800) {
    let end = 1800;
    const boundary = Math.max(text.lastIndexOf('。', end), text.lastIndexOf('；', end), text.lastIndexOf(' ', end));
    if (boundary > 900) end = boundary + 1;
    // Never cut a protected placeholder or a Unicode surrogate pair.
    for (const token of text.matchAll(/ZXQKEEP(?:\d+X)?\d+QXZ/g)) {
      if (token.index >= end) break;
      if (token.index + token[0].length > end) { end = token.index; break; }
    }
    if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    result.push(text.slice(0, end)); text = text.slice(end);
  }
  if (text) result.push(text);
  return result;
}
export async function translateDiscussion(translator, source, signal) {
  const protectedText = protectDiscussion(source), parts = protectedText.masked.split(/(\r?\n+)/), output = [];
  for (const part of parts) {
    signal?.throwIfAborted();
    if (!part.trim() || /^\r?\n/.test(part)) { output.push(part); continue; }
    const prefix = part.match(/^(?:\s*[•●·*-]\s*|\s*\d+[.)、]\s*)/)?.[0] || '';
    const pieces = [];
    for (const piece of chunks(part.slice(prefix.length))) {
      signal?.throwIfAborted();
      const translated = await translator.translate(piece, { signal });
      if (typeof translated !== 'string' || !translated.trim()) throw Error('翻譯模型未傳回內容，本段未套用。');
      if (translated.length > 1000000) throw Error('翻譯內容超過欄位容量，本段未套用。');
      pieces.push(translated.trim());
    }
    output.push(prefix + pieces.join(' '));
  }
  const translated = protectedText.restore(output.join(''));
  if (!translated.trim()) throw Error('翻譯結果空白，本段未套用。');
  if (translated.length > 1000000) throw Error('翻譯內容超過欄位容量，本段未套用。');
  return translated;
}
export function translationTargets(meeting, issueId) {
  return meeting.entries.filter(e => (!issueId || e.issueId === issueId) && /\p{Script=Han}/u.test(e.description || '') && (issueId || !e.descriptionEn?.trim()))
    .map(e => ({ issueId: e.issueId, source: e.description, target: e.descriptionEn || '' }));
}
export function mayApplyTranslation(state, originalState, meetingId, snapshot) {
  if (state !== originalState) return null;
  const entry = state.meetings.find(m => m.id === meetingId)?.entries.find(e => e.issueId === snapshot.issueId);
  return entry && entry.description === snapshot.source && (entry.descriptionEn || '') === snapshot.target ? entry : null;
}

// Bulk import: pure parsing/planning functions plus the preview dialog.
const normalize = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
const headerKey = value => normalize(value).replace(/[_\s-]+/g, ' ');
const ALIASES = {
  korean: ['korean', 'tiếng hàn', 'từ tiếng hàn', 'từ vựng', '한국어'],
  meaning: ['meaning', 'vietnamese', 'vietnamese meaning', 'nghĩa', 'nghĩa tiếng việt'],
  image: ['image', 'image file', 'filename', 'ảnh', 'tên ảnh'],
  tags: ['tags', 'tag', 'chủ đề'],
  example: ['example', 'example sentence', 'ví dụ'],
  pronunciation: ['pronunciation', 'phiên âm'],
  pos: ['pos', 'part of speech', 'từ loại'],
  notes: ['notes', 'note', 'ghi chú'],
  acceptedKorean: ['acceptedKorean', 'accepted korean', 'đáp án tiếng hàn'],
  acceptedMeaning: ['acceptedMeaning', 'accepted meaning', 'đáp án tiếng việt']
};
const HEADER_MAP = new Map(Object.entries(ALIASES).flatMap(([field, names]) => names.map(name => [headerKey(name), field])));

function detectDelimiter(text) {
  const counts = new Map([['\t', 0], [',', 0], [';', 0]]);
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i+1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (ch === '\n' || ch === '\r') break;
      if (counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
    }
  }
  return [...counts].sort((a,b) => b[1] - a[1])[0][0];
}

export function parseTable(input, separator = 'auto') {
  const text = String(input).replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('Hãy chọn CSV hoặc dán bảng từ Excel.');
  if (text.length > 5 * 1024 * 1024) throw new Error('Bảng quá lớn. Hãy chia file dưới 5 MB.');
  const delimiter = separator === 'auto' ? detectDelimiter(text) : separator;
  const grid = [];
  let row = [], field = '', quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ''; closed = false; };
  const pushRow = () => { pushField(); grid.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += ch;
    } else if (ch === delimiter) pushField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i+1] === '\n') i++;
      pushRow();
    } else if (ch === '"') {
      if (field.length || closed) throw new Error('Dấu ngoặc kép CSV không hợp lệ. Hãy xuất lại CSV UTF-8.');
      quoted = true;
    } else if (closed) {
      if (!/\s/.test(ch)) throw new Error('Có ký tự thừa sau ô CSV có ngoặc kép.');
    } else field += ch;
  }
  if (quoted) throw new Error('CSV thiếu dấu ngoặc kép đóng.');
  pushRow();
  const nonempty = grid.map((cells, i) => ({cells, line: i+1})).filter(({cells}) => cells.some(c => c.trim()));
  if (!nonempty.length) throw new Error('Bảng không có dữ liệu.');
  const first = nonempty[0].cells.map(c => HEADER_MAP.get(headerKey(c)));
  const hasHeader = first.includes('korean') && first.includes('meaning');
  if (!hasHeader && (first.includes('korean') || first.includes('meaning'))) throw new Error('Dòng tiêu đề cần cả korean và meaning.');
  const fields = hasHeader ? first : ['korean', 'meaning', 'image', 'tags', 'example', 'pronunciation', 'pos', 'notes'];
  const known = fields.filter(Boolean);
  if (new Set(known).size !== known.length) throw new Error('Bảng có cột tiêu đề bị trùng.');
  const records = (hasHeader ? nonempty.slice(1) : nonempty).map(({cells, line}) => {
    const record = {line, selected: true, manualImage: null, error: ''};
    if (hasHeader && cells.length > fields.length) record.error = 'Thừa cột; kiểm tra dấu phân cách.';
    if (!hasHeader && cells.length > fields.length) record.error = 'Không có tiêu đề: tối đa 8 cột.';
    fields.forEach((key, i) => { if (key) record[key] = (cells[i] || '').trim(); });
    if (!record.korean || !record.meaning) record.error = 'Thiếu tiếng Hàn hoặc nghĩa.';
    if (record.error) record.selected = false;
    return record;
  });
  if (!records.length) throw new Error('Bảng chỉ có tiêu đề, chưa có từ.');
  if (records.length > 1000) throw new Error('Mỗi lần tối đa 1.000 dòng. Hãy chia bảng thành nhiều phần.');
  return {records, hasHeader, delimiter, ignoredHeaders: hasHeader ? nonempty[0].cells.filter((_, i) => !fields[i]) : []};
}

const basename = name => normalize(name).split(/[\\/]/).pop();
const stem = name => basename(name).replace(/\.[^.]+$/, '');
export function matchImage(record, files) {
  if (record.manualImage) return {file: record.manualImage, warning: ''};
  const target = record.image ? basename(record.image) : normalize(record.korean);
  let matches = files.filter(f => basename(f.name) === target);
  if (!matches.length && (!record.image || !/\.[^.]+$/.test(target))) matches = files.filter(f => stem(f.name) === target);
  if (matches.length > 1) return {file: null, warning: 'Có nhiều ảnh cùng tên; chọn ảnh riêng.'};
  if (!matches.length) return {file: null, warning: record.image ? `Chưa tìm thấy ảnh: ${record.image}` : 'Chưa có ảnh — có thể bổ sung sau.'};
  return {file: matches[0], warning: ''};
}

export function planImport(records, existing, policy = 'skip') {
  const byKorean = new Map();
  for (const word of existing) {
    const key = normalize(word.korean);
    if (!byKorean.has(key)) byKorean.set(key, []);
    byKorean.get(key).push(word);
  }
  const seen = new Set();
  return records.map(record => {
    const entry = {record, action: 'skip', reason: '', existing: null};
    if (record.error) return {...entry, action: 'error', reason: record.error};
    if (!record.selected) return {...entry, reason: 'Không chọn.'};
    const key = normalize(record.korean);
    if (seen.has(key)) return {...entry, reason: 'Trùng trong bảng; chỉ nhập dòng được chọn đầu tiên.'};
    seen.add(key);
    const matches = byKorean.get(key) || [];
    if (matches.length > 1) return {...entry, action: 'error', reason: 'Kho có nhiều từ giống nhau; cần xử lý trong kho trước.'};
    if (matches.length === 1) return policy === 'update'
      ? {...entry, action: 'update', existing: matches[0], reason: 'Cập nhật nội dung, giữ lịch ôn.'}
      : {...entry, reason: 'Đã có trong kho — bỏ qua.'};
    return {...entry, action: 'add', reason: 'Thêm từ mới.'};
  });
}

export function buildWord(entry, image, id, now = Date.now()) {
  const r = entry.record;
  const word = entry.existing ? {...entry.existing} : {
    id, createdAt: now, status: 'new', reviewLogs: [], tags: [], image: '',
    pos: '', pronunciation: '', example: '', notes: ''
  };
  word.korean = r.korean;
  word.meaning = r.meaning;
  word.updatedAt = now;
  // Empty optional cells preserve the existing content.
  for (const key of ['pos', 'pronunciation', 'example', 'notes']) if (r[key]) word[key] = r[key];
  if (r.tags) word.tags = [...new Set(r.tags.split(/[,;|]/).map(x => x.trim()).filter(Boolean))];
  for (const key of ['acceptedKorean', 'acceptedMeaning']) if (r[key]) word[key] = [...new Set(r[key].split(/[|\n]/).map(x => x.trim()).filter(Boolean))];
  if (image) word.image = image;
  return word;
}

export function initBulkImport({getWords, saveWords, compressImage, refresh, uid, canOpen}) {
  const $ = id => document.getElementById(id);
  let records = [], files = [], existing = [], busy = false, previewURLs = [];
  let tableInfo = '';
  const clearURLs = () => { previewURLs.forEach(URL.revokeObjectURL); previewURLs = []; };
  const setBusy = state => {
    busy = state;
    $('bulkControls').disabled = state;
    $('bulkCloseBtn').disabled = state;
    $('bulkSaveBtn').disabled = state;
    $('bulkPreview').querySelectorAll('input,button').forEach(el => el.disabled = state);
  };
  const message = text => { $('bulkMessage').textContent = text; };
  function render() {
    clearURLs();
    const entries = planImport(records, existing, $('bulkDuplicatePolicy').value);
    const counts = {add: 0, update: 0, skip: 0, error: 0};
    const body = $('bulkPreviewBody'); body.replaceChildren();
    for (const entry of entries) {
      counts[entry.action]++;
      const r = entry.record;
      const tr = document.createElement('tr');
      const pick = document.createElement('td');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = r.selected; checkbox.disabled = !!r.error;
      checkbox.setAttribute('aria-label', `Chọn dòng ${r.line}`);
      checkbox.addEventListener('change', () => {r.selected = checkbox.checked; render();}); pick.append(checkbox); tr.append(pick);
      for (const text of [r.line, r.korean || '—', r.meaning || '—']) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
      const imageCell = document.createElement('td'); imageCell.className = 'bulk-image-cell';
      const match = matchImage(r, files);
      if (match.file) {
        const img = document.createElement('img'); const url = URL.createObjectURL(match.file); previewURLs.push(url); img.src = url; img.alt = 'Ảnh xem trước';
        imageCell.append(img);
      }
      const caption = document.createElement('small'); caption.textContent = match.file ? match.file.name : match.warning; imageCell.append(caption);
      const label = document.createElement('label'); label.className = 'ghost-btn compact file-label'; label.append('Chọn ảnh');
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
      input.addEventListener('change', () => { if (input.files[0]) assignImage(r, input.files[0]); }); label.append(input); imageCell.append(label);
      imageCell.addEventListener('dragover', e => {e.preventDefault();});
      imageCell.addEventListener('drop', e => { e.preventDefault(); if (!busy && e.dataTransfer.files[0]) assignImage(r, e.dataTransfer.files[0]); });
      tr.append(imageCell);
      const status = document.createElement('td'); status.textContent = entry.reason; status.className = `bulk-status-${entry.action}`; tr.append(status);
      body.append(tr);
    }
    $('bulkSummary').textContent = `${counts.add} thêm mới · ${counts.update} cập nhật · ${counts.skip} bỏ qua · ${counts.error} lỗi. ${tableInfo}`;
    $('bulkSaveBtn').textContent = `Nhập ${counts.add + counts.update} từ đã chọn`;
    $('bulkSaveBtn').disabled = busy || counts.add + counts.update === 0;
    $('bulkPreview').classList.toggle('hidden', !records.length);
    $('bulkImageCount').textContent = `${files.length} ảnh đã chọn. Có thể kéo ảnh vào từng dòng.`;
  }
  function assignImage(record, file) {
    if (busy) return;
    if (!file.type.startsWith('image/')) return message('Hãy chọn file ảnh.');
    if (file.size > 20 * 1024 * 1024) return message('Ảnh quá lớn: tối đa 20 MB mỗi ảnh.');
    record.manualImage = file; message(''); render();
  }
  async function analyze() {
    if (busy) return;
    setBusy(true);
    try {
      const parsed = parseTable($('bulkText').value, $('bulkSeparator').value);
      existing = await getWords(); records = parsed.records;
      tableInfo = parsed.hasHeader ? 'Đã nhận diện tiêu đề.' : 'Không có tiêu đề: Hàn, nghĩa, ảnh, tags, ví dụ, phiên âm, từ loại, ghi chú.';
      if (parsed.ignoredHeaders.length) tableInfo += ` Bỏ qua cột: ${parsed.ignoredHeaders.join(', ')}.`;
      message('');
    } catch (err) { records = []; message(err.message); }
    finally { setBusy(false); render(); }
  }
  $('bulkOpenBtn').addEventListener('click', async () => {
    if (!canOpen()) return;
    $('bulkDialog').showModal();
    setBusy(true);
    try { existing = await getWords(); }
    catch { message('Không đọc được kho từ. Hãy đóng và thử lại.'); }
    finally { setBusy(false); render(); }
  });
  $('bulkCloseBtn').addEventListener('click', () => { if (!busy) $('bulkDialog').close(); });
  $('bulkDialog').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('bulkDialog').addEventListener('close', clearURLs);
  $('bulkAnalyzeBtn').addEventListener('click', analyze);
  $('bulkText').addEventListener('input', () => { records = []; tableInfo = ''; message('Bảng đã đổi. Nhấn Xem trước để kiểm tra lại.'); render(); });
  $('bulkSeparator').addEventListener('change', () => { records = []; render(); message('Nhấn Xem trước để đọc lại bảng.'); });
  $('bulkDuplicatePolicy').addEventListener('change', render);
  $('bulkCsvFile').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file || busy) return;
    setBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('CSV tối đa 5 MB.');
      $('bulkText').value = await file.text();
    } catch(err) { message(err.message); setBusy(false); e.target.value = ''; return; }
    setBusy(false); e.target.value = ''; await analyze();
  });
  $('bulkImages').addEventListener('change', e => {
    for (const file of e.target.files) {
      if (file.type.startsWith('image/') && !files.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) files.push(file);
    }
    e.target.value = ''; render();
  });
  $('bulkClearImages').addEventListener('click', () => { files = []; records.forEach(r => r.manualImage = null); render(); });
  $('bulkSaveBtn').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    let committed = false;
    try {
      const current = await getWords();
      const entries = planImport(records, current, $('bulkDuplicatePolicy').value).filter(e => ['add','update'].includes(e.action));
      if (!entries.length) {existing = current; message('Không còn dòng nào để nhập.'); return;}
      const words = [], cache = new Map();
      for (const [i, entry] of entries.entries()) {
        message(`Đang chuẩn bị ${i+1}/${entries.length} từ…`);
        const match = matchImage(entry.record, files);
        let image = '';
        if (match.file) {
          if (match.file.size > 20 * 1024 * 1024) throw new Error(`Ảnh ${match.file.name} vượt 20 MB.`);
          if (!cache.has(match.file)) {
            try { cache.set(match.file, await compressImage(match.file)); }
            catch { throw new Error(`Không đọc được ảnh ${match.file.name}; hãy chọn ảnh khác hoặc xóa ảnh đã chọn.`); }
          }
          image = cache.get(match.file);
        }
        words.push(buildWord(entry, image, uid()));
      }
      await saveWords(words); committed = true;
      const added = entries.filter(e => e.action === 'add').length;
      records = []; files = []; $('bulkText').value = ''; tableInfo = '';
      message(`Đã thêm ${added} từ và cập nhật ${words.length-added} từ. Lịch ôn của từ cũ được giữ nguyên.`);
      await refresh(); existing = await getWords();
    } catch(err) {
      message(committed ? 'Dữ liệu đã lưu nhưng chưa làm mới được màn hình. Hãy đóng và tải lại app.' : `Chưa nhập dữ liệu. ${err.message}`);
    } finally { setBusy(false); render(); }
  });
}

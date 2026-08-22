const DB_NAME = "KoreanVisualVocabularyDB";
const STORE = "words";
const DB_VERSION = 1;

let db;
let allWords = [];
let currentImage = "";
let currentReview = [];
let reviewIndex = 0;
let reviewMode = "imageToKorean";
let currentViewMode = localStorage.getItem("vocabViewMode") || "gallery";
let deferredInstallPrompt = null;

const $ = (id) => document.getElementById(id);

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const store = d.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("korean", "korean", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeMode = "readonly") {
  return db.transaction(STORE, storeMode).objectStore(STORE);
}

function getAllWords() {
  return new Promise((resolve, reject) => {
    const req = tx().getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function putWord(word) {
  return new Promise((resolve, reject) => {
    const req = tx("readwrite").put(word);
    req.onsuccess = () => resolve(word);
    req.onerror = () => reject(req.error);
  });
}

function deleteWord(id) {
  return new Promise((resolve, reject) => {
    const req = tx("readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalize(s = "") {
  return s.toString().trim().toLocaleLowerCase("vi");
}

function tagsFromInput(value) {
  return [...new Set(value.split(",").map(x => x.trim()).filter(Boolean))];
}

function formatStatus(s) {
  return ({new:"New", learning:"Learning", learned:"Learned"})[s] || "New";
}

function escapeHTML(s = "") {
  return s.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function compressImage(file, maxSide = 1500, quality = 0.84) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("Not an image"));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(1, maxSide / Math.max(width, height));
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function defaultSRS(word = {}) {
  const now = Date.now();
  const raw = word.srs || {};
  return {
    dueAt: Number.isFinite(raw.dueAt) ? raw.dueAt : now,
    intervalDays: Number.isFinite(raw.intervalDays) ? raw.intervalDays : 0,
    ease: Number.isFinite(raw.ease) ? raw.ease : 2.5,
    repetitions: Number.isFinite(raw.repetitions) ? raw.repetitions : 0,
    lapses: Number.isFinite(raw.lapses) ? raw.lapses : 0,
    lastReviewedAt: Number.isFinite(raw.lastReviewedAt) ? raw.lastReviewedAt : null
  };
}

function isDue(word, now = Date.now()) {
  return defaultSRS(word).dueAt <= now;
}

function intervalForRating(word, rating) {
  const s = defaultSRS(word);
  const reps = s.repetitions;
  const current = Math.max(0, s.intervalDays);
  const ease = Math.max(1.3, s.ease);

  if (rating === "again") return 10 / (60 * 24); // 10 minutes
  if (rating === "hard") {
    if (reps === 0 || current < 1) return 1;
    return Math.max(1, current * 1.2);
  }
  if (rating === "good") {
    if (reps === 0) return 1;
    if (reps === 1) return 3;
    return Math.max(1, current * ease);
  }
  if (rating === "easy") {
    if (reps === 0) return 4;
    if (reps === 1) return 7;
    return Math.max(2, current * ease * 1.3);
  }
  return 1;
}

function formatInterval(days) {
  const minutes = Math.round(days * 24 * 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  if (days < 30) return `${Math.max(1, Math.round(days))}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(days >= 730 ? 1 : 2)}y`;
}

function previewIntervals(word) {
  $("againInterval").textContent = formatInterval(intervalForRating(word, "again"));
  $("hardInterval").textContent = formatInterval(intervalForRating(word, "hard"));
  $("goodInterval").textContent = formatInterval(intervalForRating(word, "good"));
  $("easyInterval").textContent = formatInterval(intervalForRating(word, "easy"));
}

async function applySRSRating(word, rating) {
  const now = Date.now();
  const s = defaultSRS(word);
  const nextDays = intervalForRating(word, rating);

  if (rating === "again") {
    s.repetitions = 0;
    s.lapses += 1;
    s.ease = Math.max(1.3, s.ease - 0.20);
  } else if (rating === "hard") {
    s.repetitions += 1;
    s.ease = Math.max(1.3, s.ease - 0.15);
  } else if (rating === "good") {
    s.repetitions += 1;
  } else if (rating === "easy") {
    s.repetitions += 1;
    s.ease = Math.min(3.2, s.ease + 0.15);
  }

  s.intervalDays = nextDays;
  s.lastReviewedAt = now;
  s.dueAt = now + nextDays * DAY;
  word.srs = s;

  if (rating === "again" || rating === "hard") {
    word.status = "learning";
  } else {
    word.status = nextDays >= 21 ? "learned" : "learning";
  }

  word.updatedAt = now;
  await putWord(word);
}

function nextDueText(words) {
  if (!words.length) return "";
  const next = Math.min(...words.map(w => defaultSRS(w).dueAt));
  const delta = next - Date.now();
  if (delta <= 0) return "Due now";
  const minutes = Math.ceil(delta / MINUTE);
  if (minutes < 60) return `Next in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `Next in ${hours}h`;
  const days = Math.ceil(hours / 24);
  return `Next in ${days}d`;
}

async function refresh() {
  allWords = (await getAllWords()).sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  rebuildTagOptions();
  renderWords();
}

function rebuildTagOptions() {
  const tags = [...new Set(allWords.flatMap(w => w.tags || []))].sort((a,b) => a.localeCompare(b));
  for (const select of [$("tagFilter"), $("reviewTag")]) {
    const existing = select.value;
    select.innerHTML = `<option value="">All tags</option>` + tags.map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join("");
    if (tags.includes(existing)) select.value = existing;
  }
}

function filteredWords() {
  const q = normalize($("searchInput").value);
  const status = $("statusFilter").value;
  const tag = $("tagFilter").value;
  return allWords.filter(w => {
    const hay = normalize([w.korean, w.meaning, ...(w.tags || []), w.pos, w.example, w.notes].filter(Boolean).join(" "));
    return (!q || hay.includes(q)) && (!status || w.status === status) && (!tag || (w.tags || []).includes(tag));
  });
}

function renderWords() {
  const words = filteredWords();
  const grid = $("wordGrid");
  grid.innerHTML = "";
  grid.classList.toggle("list-view", currentViewMode === "list");

  $("emptyState").classList.toggle("hidden", allWords.length !== 0);
  grid.classList.toggle("hidden", allWords.length === 0);

  const counts = {
    new: allWords.filter(w => w.status === "new").length,
    learning: allWords.filter(w => w.status === "learning").length,
    learned: allWords.filter(w => w.status === "learned").length
  };
  const dueCount = allWords.filter(w => isDue(w)).length;
  $("statsText").textContent = `${words.length} shown · ${allWords.length} total · ${dueCount} due · ${counts.learning} learning · ${counts.learned} learned`;
  const quickDue = $("quickDueBtn");
  if (dueCount > 0) {
    quickDue.textContent = `Review ${dueCount} due ${dueCount === 1 ? "word" : "words"} →`;
    quickDue.classList.remove("hidden");
  } else {
    quickDue.textContent = nextDueText(allWords);
    quickDue.classList.toggle("hidden", !allWords.length);
  }

  for (const word of words) {
    const node = $("cardTemplate").content.firstElementChild.cloneNode(true);
    const img = node.querySelector(".card-image");
    const ph = node.querySelector(".card-image-placeholder");
    if (word.image) {
      img.src = word.image; img.alt = `${word.korean} — ${word.meaning}`;
      ph.classList.add("hidden");
    } else {
      img.classList.add("hidden");
    }
    node.querySelector(".status-badge").textContent = formatStatus(word.status);
    node.querySelector(".korean-word").textContent = word.korean;
    node.querySelector(".meaning").textContent = word.meaning;
    node.querySelector(".tag-row").innerHTML = (word.tags || []).slice(0,4).map(t => `<span class="tag">${escapeHTML(t)}</span>`).join("");
    node.addEventListener("click", () => openWordDialog(word));
    grid.appendChild(node);
  }
}

function setViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem("vocabViewMode", mode);
  $("galleryBtn").classList.toggle("active", mode === "gallery");
  $("listBtn").classList.toggle("active", mode === "list");
  renderWords();
}

function clearWordForm() {
  $("wordForm").reset();
  $("wordId").value = "";
  currentImage = "";
  $("deleteWordBtn").classList.add("hidden");
  $("dialogTitle").textContent = "Add word";
  updateImagePreview();
}

function openWordDialog(word = null) {
  clearWordForm();
  if (word) {
    $("dialogTitle").textContent = "Edit word";
    $("wordId").value = word.id;
    $("koreanInput").value = word.korean || "";
    $("meaningInput").value = word.meaning || "";
    $("tagsInput").value = (word.tags || []).join(", ");
    $("statusInput").value = word.status || "new";
    $("posInput").value = word.pos || "";
    $("pronunciationInput").value = word.pronunciation || "";
    $("exampleInput").value = word.example || "";
    $("notesInput").value = word.notes || "";
    currentImage = word.image || "";
    $("deleteWordBtn").classList.remove("hidden");
    updateImagePreview();
  }
  $("wordDialog").showModal();
  setTimeout(() => $("koreanInput").focus(), 50);
}

function updateImagePreview() {
  const preview = $("imagePreview");
  preview.innerHTML = currentImage
    ? `<img src="${currentImage}" alt="Vocabulary preview">`
    : `<span>Paste, drop or upload an image</span>`;
}

async function handleImageFile(file) {
  try {
    currentImage = await compressImage(file);
    updateImagePreview();
  } catch (e) {
    alert("Không đọc được ảnh này.");
  }
}

function switchView(view) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(view === "library" ? "libraryView" : "reviewView").classList.add("active");
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startReview(forceDue = false) {
  reviewMode = $("reviewMode").value;
  const source = forceDue ? "due" : $("reviewSource").value;
  const status = $("reviewStatus").value;
  const tag = $("reviewTag").value;

  let pool = allWords.filter(w =>
    (!status || w.status === status) &&
    (!tag || (w.tags || []).includes(tag))
  );

  if (source === "due") {
    pool = pool.filter(w => isDue(w));
  }

  if (reviewMode === "imageToKorean") {
    pool = pool.filter(w => !!w.image);
  }

  if (!pool.length) {
    const basePool = allWords.filter(w =>
      (!status || w.status === status) &&
      (!tag || (w.tags || []).includes(tag))
    );
    const message = source === "due"
      ? (basePool.length ? `Không có từ nào đến hạn lúc này. ${nextDueText(basePool)}.` : "Không có từ phù hợp với bộ lọc.")
      : (reviewMode === "imageToKorean" ? "Không có từ phù hợp có hình ảnh. Hãy thêm ảnh hoặc đổi bộ lọc." : "Không có từ phù hợp với bộ lọc.");
    alert(message);
    return;
  }

  currentReview = shuffle(pool);
  const count = $("reviewCount").value;
  if (count !== "all") currentReview = currentReview.slice(0, Number(count));
  reviewIndex = 0;

  $("reviewSetup").classList.add("hidden");
  $("reviewSession").classList.remove("hidden");
  renderReviewCard();
}

function renderReviewCard() {
  if (reviewIndex >= currentReview.length) {
    $("reviewCard").innerHTML = `
      <div style="padding:56px 10px">
        <div class="eyebrow">DONE</div>
        <h2>Review complete</h2>
        <p class="muted">${currentReview.length} words reviewed.</p>
        <button class="primary-btn" id="reviewAgainBtn">Back to review</button>
      </div>`;
    $("reviewProgress").textContent = `${currentReview.length} / ${currentReview.length}`;
    $("progressBar").style.width = "100%";
    document.getElementById("reviewAgainBtn").addEventListener("click", () => {
      exitReview();
      location.reload();
    });
    return;
  }

  const w = currentReview[reviewIndex];
  $("reviewProgress").textContent = `${reviewIndex + 1} / ${currentReview.length}`;
  $("progressBar").style.width = `${(reviewIndex / currentReview.length) * 100}%`;

  const imgWrap = $("reviewImageWrap");
  const img = $("reviewImage");
  const imgPh = $("reviewImagePlaceholder");
  const form = $("answerForm");
  const reveal = $("revealArea");
  const srsActions = $("srsActions");
  const input = $("answerInput");

  reveal.classList.add("hidden");
  srsActions.classList.add("hidden");
  input.value = "";

  if (w.image) {
    img.src = w.image; img.alt = `${w.korean} — ${w.meaning}`;
    img.classList.remove("hidden"); imgPh.classList.add("hidden");
  } else {
    img.classList.add("hidden"); imgPh.classList.remove("hidden");
  }

  if (reviewMode === "imageToKorean") {
    imgWrap.classList.remove("hidden");
    $("reviewPrompt").textContent = "What is this in Korean?";
    $("reviewSubPrompt").textContent = w.meaning;
    form.classList.remove("hidden");
    input.placeholder = "한국어로 입력하세요…";
    setTimeout(() => input.focus(), 60);
  } else if (reviewMode === "koreanToMeaning") {
    imgWrap.classList.add("hidden");
    $("reviewPrompt").textContent = w.korean;
    $("reviewSubPrompt").textContent = "What does it mean?";
    form.classList.remove("hidden");
    input.placeholder = "Nhập nghĩa tiếng Việt…";
    setTimeout(() => input.focus(), 60);
  } else {
    imgWrap.classList.toggle("hidden", !w.image);
    $("reviewPrompt").textContent = w.korean;
    $("reviewSubPrompt").textContent = "Recall the meaning, then reveal.";
    form.classList.add("hidden");
    reveal.classList.remove("hidden");
    reveal.innerHTML = `<button id="revealBrowseBtn" class="ghost-btn">Reveal answer</button>`;
    document.getElementById("revealBrowseBtn").addEventListener("click", () => {
      reveal.innerHTML = answerHTML(w);
      previewIntervals(w);
      srsActions.classList.remove("hidden");
    });
  }
}

function answerHTML(w, feedback = "") {
  const details = [
    w.pronunciation ? `<div><strong>Pronunciation:</strong> ${escapeHTML(w.pronunciation)}</div>` : "",
    w.pos ? `<div><strong>Part of speech:</strong> ${escapeHTML(w.pos)}</div>` : "",
    w.example ? `<div style="margin-top:10px"><strong>Example:</strong><br>${escapeHTML(w.example)}</div>` : "",
    w.notes ? `<div style="margin-top:10px"><strong>Notes:</strong><br>${escapeHTML(w.notes)}</div>` : ""
  ].join("");
  return `${feedback}<div class="big">${escapeHTML(w.korean)}</div><div>${escapeHTML(w.meaning)}</div>${details}`;
}


function exitReview() {
  $("reviewSession").classList.add("hidden");
  $("reviewSetup").classList.remove("hidden");
  refresh();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("vocabTheme", theme);
  $("themeBtn").textContent = theme === "dark" ? "☀" : "☾";
}

async function exportData() {
  const words = await getAllWords();
  const payload = {
    app: "Korean Visual Vocabulary",
    version: 1,
    exportedAt: new Date().toISOString(),
    words
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `korean-vocabulary-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function importData(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { return alert("File JSON không hợp lệ."); }
  const words = Array.isArray(data) ? data : data.words;
  if (!Array.isArray(words)) return alert("Không tìm thấy danh sách từ trong file.");
  if (!confirm(`Import ${words.length} từ? Các từ có cùng ID sẽ được cập nhật.`)) return;

  for (const raw of words) {
    if (!raw.korean || !raw.meaning) continue;
    await putWord({
      id: raw.id || uid(),
      korean: String(raw.korean),
      meaning: String(raw.meaning),
      image: raw.image || "",
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      status: ["new","learning","learned"].includes(raw.status) ? raw.status : "new",
      pos: raw.pos || "",
      pronunciation: raw.pronunciation || "",
      example: raw.example || "",
      notes: raw.notes || "",
      srs: defaultSRS(raw),
      createdAt: raw.createdAt || Date.now(),
      updatedAt: Date.now()
    });
  }
  await refresh();
  alert("Import xong.");
}


function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function setPWANotice(text) {
  const el = $("pwaNotice");
  if (!el) return;
  if (!text) {
    el.classList.add("hidden");
    el.textContent = "";
  } else {
    el.textContent = text;
    el.classList.remove("hidden");
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  const btn = $("installBtn");
  if (btn && !isStandalone()) btn.classList.remove("hidden");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  const btn = $("installBtn");
  if (btn) btn.classList.add("hidden");
  setPWANotice("App đã được cài trên thiết bị này.");
});

document.addEventListener("DOMContentLoaded", async () => {
  db = await openDB();
  applyTheme(localStorage.getItem("vocabTheme") || "light");
  setViewMode(currentViewMode);
  await refresh();

  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));
  $("openAddBtn").addEventListener("click", () => openWordDialog());

  $("installBtn").addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      setPWANotice("Trình duyệt chưa cung cấp nút cài app. Hãy thử Chrome/Edge và mở trang bằng HTTPS trên GitHub Pages.");
      return;
    }
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch {}
    deferredInstallPrompt = null;
    $("installBtn").classList.add("hidden");
  });

  if (isStandalone()) {
    $("installBtn").classList.add("hidden");
    setPWANotice("");
  }
  $("emptyAddBtn").addEventListener("click", () => openWordDialog());
  $("closeDialogBtn").addEventListener("click", () => $("wordDialog").close());
  $("cancelBtn").addEventListener("click", () => $("wordDialog").close());
  $("searchInput").addEventListener("input", renderWords);
  $("statusFilter").addEventListener("change", renderWords);
  $("tagFilter").addEventListener("change", renderWords);
  $("clearFiltersBtn").addEventListener("click", () => {
    $("searchInput").value = ""; $("statusFilter").value = ""; $("tagFilter").value = ""; renderWords();
  });
  $("galleryBtn").addEventListener("click", () => setViewMode("gallery"));
  $("listBtn").addEventListener("click", () => setViewMode("list"));

  $("imageFile").addEventListener("change", e => e.target.files[0] && handleImageFile(e.target.files[0]));
  $("removeImageBtn").addEventListener("click", () => { currentImage = ""; updateImagePreview(); });

  $("imagePreview").addEventListener("dragover", e => { e.preventDefault(); });
  $("imagePreview").addEventListener("drop", e => {
    e.preventDefault();
    const file = [...e.dataTransfer.files].find(f => f.type.startsWith("image/"));
    if (file) handleImageFile(file);
  });

  document.addEventListener("paste", e => {
    if (!$("wordDialog").open) return;
    const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      handleImageFile(item.getAsFile());
    }
  });

  $("wordForm").addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("wordId").value || uid();
    const existing = allWords.find(w => w.id === id);
    const now = Date.now();
    const word = {
      id,
      korean: $("koreanInput").value.trim(),
      meaning: $("meaningInput").value.trim(),
      image: currentImage,
      tags: tagsFromInput($("tagsInput").value),
      status: $("statusInput").value,
      pos: $("posInput").value.trim(),
      pronunciation: $("pronunciationInput").value.trim(),
      example: $("exampleInput").value.trim(),
      notes: $("notesInput").value.trim(),
      srs: existing?.srs || defaultSRS(),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (!word.korean || !word.meaning) return;
    await putWord(word);
    $("wordDialog").close();
    await refresh();
  });

  $("deleteWordBtn").addEventListener("click", async () => {
    const id = $("wordId").value;
    if (!id || !confirm("Xóa từ này khỏi kho?")) return;
    await deleteWord(id);
    $("wordDialog").close();
    await refresh();
  });

  $("startReviewBtn").addEventListener("click", () => startReview(false));
  $("quickDueBtn").addEventListener("click", () => {
    switchView("review");
    $("reviewSource").value = "due";
    startReview(true);
  });
  $("exitReviewBtn").addEventListener("click", exitReview);

  $("answerForm").addEventListener("submit", e => {
    e.preventDefault();
    const w = currentReview[reviewIndex];
    const userAnswer = normalize($("answerInput").value);
    const expected = reviewMode === "imageToKorean" ? normalize(w.korean) : normalize(w.meaning);
    const correct = userAnswer === expected;
    const feedback = `<div style="font-weight:800;margin-bottom:9px">${correct ? "✓ Correct" : "Not quite"}</div>`;
    $("revealArea").innerHTML = answerHTML(w, feedback);
    $("revealArea").classList.remove("hidden");
    previewIntervals(w);
    $("srsActions").classList.remove("hidden");
  });

  document.querySelectorAll(".srs-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const w = currentReview[reviewIndex];
      await applySRSRating(w, btn.dataset.rating);
      reviewIndex++;
      renderReviewCard();
    });
  });

  $("themeBtn").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  $("exportBtn").addEventListener("click", exportData);
  $("importFile").addEventListener("change", e => e.target.files[0] && importData(e.target.files[0]));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      reg.update().catch(() => {});
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  });
}

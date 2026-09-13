import { initBulkImport } from "./bulk-import.js";
import {
  createEmptyCard,
  fsrs,
  Rating,
  State
} from "https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.1/+esm";

const DB_NAME = "KoreanVisualVocabularyDB";
const STORE = "words";
const DB_VERSION = 1;

const DEFAULT_SETTINGS = {
  desiredRetention: 0.90,
  newPerDay: 20,
  maxReviewsPerDay: 200
};

let db;
let allWords = [];
let currentImage = "";
let currentReview = [];
let reviewIndex = 0;
let reviewMode = "imageToKorean";
let reviewSource = "daily";
let currentViewMode = localStorage.getItem("vocabViewMode") || "gallery";
let deferredInstallPrompt = null;
let scheduler = null;
let ratingBusy = false;
let undoState = null;
let sessionActive = false;
let sessionTag = "";
let waitTimer = null;

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
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(word);
    transaction.oncomplete = () => resolve(word);
    transaction.onabort = () => reject(transaction.error || new Error("Lưu thất bại"));
    transaction.onerror = () => {};
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
  return s.toString().normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
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
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- FSRS ---------------- */

function getSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem("fsrsSettings") || "{}");
    return {
      desiredRetention: clamp(Number(raw.desiredRetention) || DEFAULT_SETTINGS.desiredRetention, 0.80, 0.97),
      newPerDay: clampInt(raw.newPerDay, 0, 200, DEFAULT_SETTINGS.newPerDay),
      maxReviewsPerDay: clampInt(raw.maxReviewsPerDay, 1, 2000, DEFAULT_SETTINGS.maxReviewsPerDay)
    };
  } catch {
    return {...DEFAULT_SETTINGS};
  }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function clampInt(n, lo, hi, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function saveSettingsFromUI() {
  const settings = {
    desiredRetention: clamp(Number($("retentionInput").value) || 0.90, 0.80, 0.97),
    newPerDay: clampInt($("newPerDayInput").value, 0, 200, 20),
    maxReviewsPerDay: clampInt($("maxReviewsInput").value, 1, 2000, 200)
  };
  localStorage.setItem("fsrsSettings", JSON.stringify(settings));
  configureScheduler();
  renderWords();
  renderDailySummary();
}

function configureScheduler() {
  const settings = getSettings();
  scheduler = fsrs({
    request_retention: settings.desiredRetention,
    maximum_interval: 36500,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: ["1m", "10m"],
    relearning_steps: ["10m"]
  });
}

function serializeCard(card) {
  return {
    ...card,
    due: card.due instanceof Date ? card.due.getTime() : Number(card.due),
    last_review: card.last_review instanceof Date ? card.last_review.getTime() : (card.last_review ?? null)
  };
}

function reviveCard(raw, fallbackDate = Date.now()) {
  if (!raw || typeof raw !== "object") {
    return createEmptyCard(new Date(fallbackDate));
  }
  return {
    due: new Date(Number(raw.due)),
    stability: Number(raw.stability) || 0,
    difficulty: Number(raw.difficulty) || 0,
    elapsed_days: Number(raw.elapsed_days) || 0,
    scheduled_days: Number(raw.scheduled_days) || 0,
    reps: Number(raw.reps) || 0,
    lapses: Number(raw.lapses) || 0,
    learning_steps: Number(raw.learning_steps) || 0,
    state: Number.isFinite(Number(raw.state)) ? Number(raw.state) : State.New,
    last_review: raw.last_review == null ? undefined : new Date(Number(raw.last_review))
  };
}

function getFsrsCard(word) {
  return reviveCard(word.fsrsCard, word.createdAt || Date.now());
}

function serializeLog(log) {
  return {
    ...log,
    due: log.due instanceof Date ? log.due.getTime() : Number(log.due),
    review: log.review instanceof Date ? log.review.getTime() : Number(log.review)
  };
}

function deriveStatus(card) {
  if (card.state === State.New) return "new";
  if (card.state === State.Learning || card.state === State.Relearning) return "learning";
  if (card.state === State.Review && card.scheduled_days >= 21) return "learned";
  return "learning";
}

function stateLabel(card) {
  if (card.state === State.New) return "New";
  if (card.state === State.Learning) return "Learning";
  if (card.state === State.Relearning) return "Relearning";
  return "Review";
}

function isCardDue(card, now = Date.now()) {
  return card.state !== State.New && card.due.getTime() <= now;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function logsToday() {
  const start = startOfToday();
  return allWords.flatMap(w => (w.reviewLogs || []).map(log => ({word: w, log})))
    .filter(x => Number(x.log.review) >= start);
}

function dailyUsage() {
  const logs = logsToday();
  const newIntroduced = new Set(logs.filter(x => Number(x.log.state) === State.New).map(x => x.word.id)).size;
  const reviewsDone = logs.filter(x => Number(x.log.state) === State.Review).length;
  const learningDone = logs.filter(x => [State.Learning, State.Relearning].includes(Number(x.log.state))).length;
  return {newIntroduced, reviewsDone, learningDone};
}

function wordMatchesTag(word, tag) {
  return !tag || (word.tags || []).includes(tag);
}

function dailyQueueInfo(tag = "", includeNew = true) {
  const now = Date.now();
  const settings = getSettings();
  const usage = dailyUsage();
  const filtered = allWords.filter(w => wordMatchesTag(w, tag));

  const learningDue = [];
  const reviewDue = [];
  const newWords = [];

  for (const word of filtered) {
    const card = getFsrsCard(word);
    if (card.state === State.New) {
      newWords.push(word);
    } else if (card.due.getTime() <= now) {
      if (card.state === State.Learning || card.state === State.Relearning) learningDue.push(word);
      else reviewDue.push(word);
    }
  }

  learningDue.sort((a,b) => getFsrsCard(a).due - getFsrsCard(b).due);
  reviewDue.sort((a,b) => getFsrsCard(a).due - getFsrsCard(b).due);
  newWords.sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0));

  const reviewRemaining = Math.max(0, settings.maxReviewsPerDay - usage.reviewsDone);
  const newRemaining = Math.max(0, settings.newPerDay - usage.newIntroduced);

  const gatheredReviews = reviewDue.slice(0, reviewRemaining);
  const gatheredNew = includeNew ? newWords.slice(0, newRemaining) : [];

  const queue = [...learningDue, ...gatheredReviews, ...gatheredNew];

  return {
    queue,
    learningDue: learningDue.length,
    reviewDue: reviewDue.length,
    newAvailable: newWords.length,
    newRemaining,
    reviewRemaining,
    hiddenReviewBacklog: Math.max(0, reviewDue.length - gatheredReviews.length),
    usage
  };
}

function nextScheduledText(tag = "") {
  const future = allWords
    .filter(w => wordMatchesTag(w, tag))
    .map(w => getFsrsCard(w))
    .filter(c => c.state !== State.New && c.due.getTime() > Date.now())
    .sort((a,b) => a.due - b.due);

  if (!future.length) return "";
  const ms = future[0].due.getTime() - Date.now();
  return `Next due ${formatDuration(ms)}`;
}

function formatDuration(ms) {
  ms = Math.max(0, ms);
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(days >= 730 ? 1 : 2)}y`;
}

function previewIntervals(word) {
  const card = getFsrsCard(word);
  const now = new Date();
  const preview = scheduler.repeat(card, now);

  const options = [
    ["againInterval", Rating.Again],
    ["hardInterval", Rating.Hard],
    ["goodInterval", Rating.Good],
    ["easyInterval", Rating.Easy]
  ];

  for (const [id, rating] of options) {
    const due = preview[rating].card.due;
    $(id).textContent = formatDuration(due.getTime() - now.getTime());
  }
}

async function applyFsrsRating(word, ratingName) {
  const ratingMap = {
    again: Rating.Again,
    hard: Rating.Hard,
    good: Rating.Good,
    easy: Rating.Easy
  };
  const rating = ratingMap[ratingName];
  if (!rating) return;

  const card = getFsrsCard(word);
  const now = new Date();
  const result = scheduler.next(card, now, rating);

  word = structuredClone(word);
  word.fsrsCard = serializeCard(result.card);
  word.reviewLogs = [...(word.reviewLogs || []), serializeLog(result.log)];
  word.status = deriveStatus(result.card);
  word.updatedAt = Date.now();

  // Keep legacy V1.2 data untouched for backup compatibility, but it is no longer used.
  await putWord(word);

  const idx = allWords.findIndex(w => w.id === word.id);
  if (idx >= 0) allWords[idx] = word;
}

/* ---------------- Library ---------------- */

async function refresh() {
  allWords = (await getAllWords()).sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const w of allWords) {
    w.status = deriveStatus(getFsrsCard(w));
  }
  renderBackupNotice();
  rebuildTagOptions();
  renderWords();
  renderDailySummary();
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
    new: allWords.filter(w => deriveStatus(getFsrsCard(w)) === "new").length,
    learning: allWords.filter(w => deriveStatus(getFsrsCard(w)) === "learning").length,
    learned: allWords.filter(w => deriveStatus(getFsrsCard(w)) === "learned").length
  };
  const info = dailyQueueInfo("", true);
  const reviewDue = info.learningDue + info.reviewDue;

  $("statsText").textContent =
    `${words.length} shown · ${allWords.length} total · ${reviewDue} due · ${counts.new} new · ${counts.learned} mature`;

  const quickDue = $("quickDueBtn");
  if (info.queue.length > 0) {
    quickDue.textContent = `Study today · ${info.queue.length} cards →`;
    quickDue.classList.remove("hidden");
  } else if (allWords.length) {
    quickDue.textContent = nextScheduledText("") || "Nothing due";
    quickDue.classList.remove("hidden");
  } else {
    quickDue.classList.add("hidden");
  }

  for (const word of words) {
    const node = $("cardTemplate").content.firstElementChild.cloneNode(true);
    const img = node.querySelector(".card-image");
    const ph = node.querySelector(".card-image-placeholder");
    if (word.image) {
      img.src = word.image;
      img.alt = `${word.korean} — ${word.meaning}`;
      ph.classList.add("hidden");
    } else {
      img.classList.add("hidden");
    }
    node.querySelector(".status-badge").textContent = formatStatus(deriveStatus(getFsrsCard(word)));
    node.querySelector(".korean-word").textContent = word.korean;
    node.querySelector(".meaning").textContent = word.meaning;
    node.querySelector(".tag-row").innerHTML = (word.tags || []).slice(0,4).map(t => `<span class="tag">${escapeHTML(t)}</span>`).join("");
    node.addEventListener("click", () => openWordDialog(word));
    grid.appendChild(node);
  }
}

function renderDailySummary() {
  const el = $("dailySummary");
  if (!el) return;
  const tag = $("reviewTag")?.value || "";
  const info = dailyQueueInfo(tag, true);
  const settings = getSettings();

  el.innerHTML = `
    <div><strong>${info.learningDue + info.reviewDue}</strong> <span>due reviews</span></div>
    <div><strong>${Math.min(info.newAvailable, info.newRemaining)}</strong> <span>new available today</span></div>
    <div><strong>${info.usage.newIntroduced}/${settings.newPerDay}</strong> <span>new used</span></div>
    <div><strong>${info.usage.reviewsDone}/${settings.maxReviewsPerDay}</strong> <span>lượt ôn Review</span></div>
    <div><strong>${info.usage.learningDone}</strong> <span>lượt học / học lại · không giới hạn</span></div>
  `;
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
  $("acceptedKoreanInput").value = "";
  $("acceptedMeaningInput").value = "";
  currentImage = "";
  $("statusInput").value = "new";
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
    $("acceptedKoreanInput").value = (word.acceptedKorean || []).join("\n");
    $("acceptedMeaningInput").value = (word.acceptedMeaning || []).join("\n");
    $("tagsInput").value = (word.tags || []).join(", ");
    $("statusInput").value = deriveStatus(getFsrsCard(word));
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
  } catch {
    alert("Không đọc được ảnh này.");
  }
}

function switchView(view) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(view === "library" ? "libraryView" : "reviewView").classList.add("active");
  if (view === "review") renderDailySummary();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------- Review ---------------- */

function updateReviewSourceUI() {
  const practice = $("reviewSource").value === "practice";
  $("reviewCount").disabled = !practice;
  $("reviewStatus").disabled = !practice;
  $("practiceCountLabel").style.opacity = practice ? "1" : ".5";
  $("practiceStatusLabel").style.opacity = practice ? "1" : ".5";
}

function buildReviewQueue(source) {
  const tag = $("reviewTag").value;

  if (source === "daily") {
    return dailyQueueInfo(tag, true).queue;
  }

  if (source === "dueOnly") {
    return dailyQueueInfo(tag, false).queue;
  }

  const status = $("reviewStatus").value;
  let pool = allWords.filter(w =>
    (!status || deriveStatus(getFsrsCard(w)) === status) &&
    wordMatchesTag(w, tag)
  );

  pool = shuffle(pool);
  const count = $("reviewCount").value;
  if (count !== "all") pool = pool.slice(0, Number(count));
  return pool;
}

function startReview(forceDaily = false) {
  reviewMode = $("reviewMode").value;
  reviewSource = forceDaily ? "daily" : $("reviewSource").value;

  currentReview = buildReviewQueue(reviewSource);
  sessionTag = $("reviewTag").value;

  if (!currentReview.length) {
    const tag = $("reviewTag").value;
    if (reviewSource === "practice") {
      alert("Không có từ phù hợp với bộ lọc.");
    } else {
      alert(nextScheduledText(tag) || "Không có card nào cần ôn lúc này.");
    }
    return;
  }

  reviewIndex = 0;
  undoState = null;
  $("undoReviewBtn").disabled = true;
  sessionActive = true;
  $("reviewSetup").classList.add("hidden");
  $("reviewSession").classList.remove("hidden");
  renderReviewCard();
}

function effectiveModeForWord(word) {
  if (reviewMode === "imageToKorean" && !word.image) return "koreanToMeaning";
  return reviewMode;
}

function renderReviewCard() {
  clearTimeout(waitTimer);
  if (!sessionActive) return;
  if (reviewSource !== "practice") {
    const next = dailyQueueInfo(sessionTag, reviewSource === "daily").queue[0];
    currentReview = next ? [next] : [];
    reviewIndex = 0;
  }
  const finished = reviewIndex >= currentReview.length;
  $("reviewCard").classList.toggle("hidden", finished);
  $("sessionMessage").classList.toggle("hidden", !finished);
  if (finished) {
    const pending = reviewSource === "practice" ? [] : allWords
      .filter(w => wordMatchesTag(w, sessionTag))
      .map(getFsrsCard)
      .filter(c => [State.Learning, State.Relearning].includes(c.state) && c.due.getTime() > Date.now())
      .sort((a,b) => a.due - b.due);
    $("sessionMessageTitle").textContent = pending.length ? "Chờ lượt học lại" : "Đã hoàn thành lượt ôn";
    $("sessionMessageText").textContent = pending.length
      ? `Thẻ tiếp theo sau ${formatDuration(pending[0].due - Date.now())}. Bạn có thể chờ hoặc thoát; lịch đã được lưu.`
      : "Bạn có thể quay lại phần thiết lập để bắt đầu lượt khác.";
    $("reviewProgress").textContent = pending.length ? "Đang chờ" : "Hoàn thành";
    $("progressBar").style.width = "100%";
    if (reviewSource !== "practice") waitTimer = setTimeout(renderReviewCard, 1000);
    return;
  }

  const w = currentReview[reviewIndex];
  const card = getFsrsCard(w);
  const mode = effectiveModeForWord(w);

  $("reviewProgress").textContent = reviewSource === "practice" ? `${reviewIndex + 1} / ${currentReview.length}` : `${dailyQueueInfo(sessionTag, reviewSource === "daily").queue.length} thẻ sẵn sàng`;
  $("progressBar").style.width = `${(reviewIndex / currentReview.length) * 100}%`;

  const imgWrap = $("reviewImageWrap");
  const img = $("reviewImage");
  const imgPh = $("reviewImagePlaceholder");
  const form = $("answerForm");
  const reveal = $("revealArea");
  const srsActions = $("srsActions");
  const practiceNext = $("practiceNextBtn");
  const input = $("answerInput");

  reveal.classList.add("hidden");
  srsActions.classList.add("hidden");
  practiceNext.classList.add("hidden");
  input.value = "";

  if (w.image) {
    img.src = w.image;
    img.alt = "Ảnh gợi ý từ vựng";
    img.classList.remove("hidden");
    imgPh.classList.add("hidden");
  } else {
    img.classList.add("hidden");
    imgPh.classList.remove("hidden");
  }

  if (mode === "imageToKorean") {
    imgWrap.classList.remove("hidden");
    $("reviewPrompt").innerHTML = `<span class="review-state-pill">${escapeHTML(stateLabel(card))}</span><br>What is this in Korean?`;
    $("reviewSubPrompt").textContent = "";
    form.classList.remove("hidden");
    input.placeholder = "한국어로 입력하세요…";
    setTimeout(() => input.focus(), 60);
  } else if (mode === "koreanToMeaning") {
    imgWrap.classList.add("hidden");
    $("reviewPrompt").innerHTML = `<span class="review-state-pill">${escapeHTML(stateLabel(card))}</span><br>${escapeHTML(w.korean)}`;
    $("reviewSubPrompt").textContent = "What does it mean?";
    form.classList.remove("hidden");
    input.placeholder = "Nhập nghĩa tiếng Việt…";
    setTimeout(() => input.focus(), 60);
  } else {
    imgWrap.classList.toggle("hidden", !w.image);
    $("reviewPrompt").innerHTML = `<span class="review-state-pill">${escapeHTML(stateLabel(card))}</span><br>${escapeHTML(w.korean)}`;
    $("reviewSubPrompt").textContent = "Recall the meaning, then reveal.";
    form.classList.add("hidden");
    reveal.classList.remove("hidden");
    reveal.innerHTML = `<button id="revealBrowseBtn" class="ghost-btn">Reveal answer</button>`;
    document.getElementById("revealBrowseBtn").addEventListener("click", () => revealAnswer(w));
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

function revealAnswer(word, feedback = "") {
  $("revealArea").innerHTML = answerHTML(word, feedback);
  $("revealArea").classList.remove("hidden");

  if (reviewSource === "practice") {
    $("practiceNextBtn").classList.remove("hidden");
  } else {
    previewIntervals(word);
    $("srsActions").classList.remove("hidden");
  }
}

function exitReview() {
  if (ratingBusy) return;
  sessionActive = false;
  clearTimeout(waitTimer);
  $("reviewSession").classList.add("hidden");
  $("reviewSetup").classList.remove("hidden");
  refresh();
}

/* ---------------- Theme / Backup / PWA ---------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("vocabTheme", theme);
  $("themeBtn").textContent = theme === "dark" ? "☀" : "☾";
}

async function exportData() {
  const words = await getAllWords();
  const payload = {
    app: "Korean Visual Vocabulary",
    version: 4,
    scheduler: "FSRS-6 / ts-fsrs 5.4.1",
    fsrsSettings: getSettings(),
    exportedAt: new Date().toISOString(),
    words
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `korean-vocabulary-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  localStorage.setItem("vocabLastBackup", String(Date.now()));
  renderBackupNotice();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function importData(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { return alert("File JSON không hợp lệ."); }
  let words;
  try { words = validateBackup(data); }
  catch (err) { return alert(err.message); }
  if (!confirm(`Nhập ${words.length} từ? Từ cùng ID sẽ được cập nhật. Nên xuất bản sao lưu trước khi tiếp tục.`)) return;
  const prepared = words.map(raw => ({
    ...raw, id: raw.id || uid(), tags: raw.tags || [], image: raw.image || "",
    status: raw.fsrsCard ? deriveStatus(reviveCard(raw.fsrsCard)) : "new",
    reviewLogs: raw.reviewLogs || [], createdAt: raw.createdAt || Date.now(), updatedAt: Date.now()
  }));
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      for (const word of prepared) transaction.objectStore(STORE).put(word);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error("Nhập thất bại"));
      transaction.onerror = () => {};
    });
  } catch { return alert("Không nhập được dữ liệu. Dữ liệu cũ được giữ nguyên."); }
  if (data.fsrsSettings) {
    localStorage.setItem("fsrsSettings", JSON.stringify(data.fsrsSettings));
    configureScheduler();
  }

  const settings = getSettings();
  $("retentionInput").value = settings.desiredRetention.toFixed(2);
  $("newPerDayInput").value = settings.newPerDay;
  $("maxReviewsInput").value = settings.maxReviewsPerDay;

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
  $("installBtn")?.classList.add("hidden");
  setPWANotice("App đã được cài trên thiết bị này.");
});

/* ---------------- Init ---------------- */

document.addEventListener("DOMContentLoaded", async () => {
  configureScheduler();
  db = await openDB();
  initBulkImport({
    getWords: getAllWords,
    saveWords: words => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      for (const word of words) transaction.objectStore(STORE).put(word);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error("Không lưu được dữ liệu; hãy kiểm tra dung lượng trình duyệt."));
      transaction.onerror = () => {};
    }),
    compressImage, refresh, uid,
    canOpen: () => {
      if (sessionActive) { alert("Hãy thoát buổi ôn trước khi nhập hàng loạt."); return false; }
      return true;
    }
  });

  const settings = getSettings();
  $("retentionInput").value = settings.desiredRetention.toFixed(2);
  $("newPerDayInput").value = settings.newPerDay;
  $("maxReviewsInput").value = settings.maxReviewsPerDay;

  applyTheme(localStorage.getItem("vocabTheme") || "light");
  setViewMode(currentViewMode);
  await refresh();
  updateReviewSourceUI();

  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));

  $("openAddBtn").addEventListener("click", () => openWordDialog());
  $("emptyAddBtn").addEventListener("click", () => openWordDialog());
  $("closeDialogBtn").addEventListener("click", () => $("wordDialog").close());
  $("cancelBtn").addEventListener("click", () => $("wordDialog").close());

  $("searchInput").addEventListener("input", renderWords);
  $("statusFilter").addEventListener("change", renderWords);
  $("tagFilter").addEventListener("change", renderWords);
  $("clearFiltersBtn").addEventListener("click", () => {
    $("searchInput").value = "";
    $("statusFilter").value = "";
    $("tagFilter").value = "";
    renderWords();
  });

  $("galleryBtn").addEventListener("click", () => setViewMode("gallery"));
  $("listBtn").addEventListener("click", () => setViewMode("list"));

  $("imageFile").addEventListener("change", e => e.target.files[0] && handleImageFile(e.target.files[0]));
  $("removeImageBtn").addEventListener("click", () => {
    currentImage = "";
    updateImagePreview();
  });
  $("imagePreview").addEventListener("dragover", e => e.preventDefault());
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
      acceptedKorean: answerLines($("acceptedKoreanInput").value),
      acceptedMeaning: answerLines($("acceptedMeaningInput").value),
      image: currentImage,
      tags: tagsFromInput($("tagsInput").value),
      status: existing ? deriveStatus(getFsrsCard(existing)) : "new",
      pos: $("posInput").value.trim(),
      pronunciation: $("pronunciationInput").value.trim(),
      example: $("exampleInput").value.trim(),
      notes: $("notesInput").value.trim(),
      fsrsCard: existing?.fsrsCard,
      reviewLogs: existing?.reviewLogs || [],
      srs: existing?.srs,
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

  $("reviewSource").addEventListener("change", () => {
    updateReviewSourceUI();
    renderDailySummary();
  });
  $("reviewTag").addEventListener("change", renderDailySummary);

  for (const input of [$("retentionInput"), $("newPerDayInput"), $("maxReviewsInput")]) {
    input.addEventListener("change", saveSettingsFromUI);
  }

  $("startReviewBtn").addEventListener("click", () => startReview(false));
  $("quickDueBtn").addEventListener("click", () => {
    switchView("review");
    $("reviewSource").value = "daily";
    updateReviewSourceUI();
    startReview(true);
  });
  $("exitReviewBtn").addEventListener("click", exitReview);

  $("answerForm").addEventListener("submit", e => {
    e.preventDefault();
    if (ratingBusy || !sessionActive || !currentReview[reviewIndex]) return;
    const w = currentReview[reviewIndex];
    const mode = effectiveModeForWord(w);
    const userAnswer = normalize($("answerInput").value);
    const expected = mode === "imageToKorean" ? normalize(w.korean) : normalize(w.meaning);
    const aliases = mode === "imageToKorean" ? w.acceptedKorean : w.acceptedMeaning;
    const correct = [expected, ...(aliases || []).map(normalize)].includes(userAnswer);
    const feedback = `<div style="font-weight:800;margin-bottom:9px">${correct ? "✓ Correct" : "Chưa khớp đáp án đã lưu — hãy đối chiếu và tự đánh giá"}</div>`;
    revealAnswer(w, feedback);
  });

  document.querySelectorAll(".srs-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (ratingBusy || !sessionActive) return;
      const w = currentReview[reviewIndex];
      if (!w) return;
      setRatingBusy(true);
      const previous = structuredClone(w);
      try {
        await applyFsrsRating(w, btn.dataset.rating);
        undoState = previous;
        $("undoReviewBtn").disabled = false;
        renderReviewCard();
      } catch { alert("Chưa lưu được lượt ôn. Hãy thử lại."); }
      finally { setRatingBusy(false); }

    });
  });

  $("practiceNextBtn").addEventListener("click", () => {
    reviewIndex++;
    renderReviewCard();
  });

  $("themeBtn").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  $("sessionBackBtn").addEventListener("click", exitReview);
  $("undoReviewBtn").addEventListener("click", undoReview);
  $("closeZoomBtn").addEventListener("click", () => $("imageZoomDialog").close());
  $("zoomImageBtn").addEventListener("click", () => zoomImage($("reviewImage").src));
  $("zoomPreviewBtn").addEventListener("click", () => zoomImage(currentImage));
  $("exportBtn").addEventListener("click", exportData);
  $("importFile").addEventListener("change", e => e.target.files[0] && importData(e.target.files[0]));

  $("installBtn").addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      setPWANotice("Trình duyệt chưa cung cấp nút cài app. Hãy dùng Chrome/Edge và mở GitHub Pages qua HTTPS.");
      return;
    }
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch {}
    deferredInstallPrompt = null;
    $("installBtn").classList.add("hidden");
  });

  if (isStandalone()) {
    $("installBtn").classList.add("hidden");
    setPWANotice("");
  }
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

function answerLines(value) { return [...new Set(value.split(/\n/).map(x => x.trim()).filter(Boolean))]; }
function setRatingBusy(value) {
  ratingBusy = value;
  document.querySelectorAll(".srs-btn").forEach(b => b.disabled = value);
  $("exitReviewBtn").disabled = value;
  $("undoReviewBtn").disabled = value || !undoState;
}
async function undoReview() {
  if (ratingBusy || !undoState) return;
  setRatingBusy(true);
  try {
    await putWord(undoState);
    allWords[allWords.findIndex(w => w.id === undoState.id)] = undoState;
    undoState = null;
    renderReviewCard();
  } catch { alert("Chưa hoàn tác được. Hãy thử lại."); }
  finally { setRatingBusy(false); }
}
function zoomImage(src) {
  if (!src) return;
  $("zoomedImage").src = src;
  $("imageZoomDialog").showModal();
}
function renderBackupNotice() {
  const time = Number(localStorage.getItem("vocabLastBackup"));
  $("backupNotice").textContent = time
    ? `Lần xuất sao lưu gần nhất: ${new Date(time).toLocaleString("vi-VN")}. Hãy giữ file JSON đã tải xuống.`
    : "Chưa ghi nhận bản sao lưu trên trình duyệt này. Nhấn Export để lưu từ vựng, ảnh và lịch ôn.";
  $("backupNotice").classList.toggle("backup-reminder", !time || Date.now() - time > 7 * 86400000);
}
function validateBackup(data) {
  const fail = (text) => { throw new Error(`File sao lưu không hợp lệ: ${text}. Chưa thay đổi dữ liệu.`); };
  if (!data || typeof data !== "object") fail("cần đối tượng hoặc danh sách từ");
  const words = Array.isArray(data) ? data : data.words;
  if (!Array.isArray(words)) fail("thiếu danh sách words");
  const ids = new Set();
  const finite = n => typeof n === "number" && Number.isFinite(n);
  const date = n => finite(n) && n >= 0 && n <= 8640000000000000;
  words.forEach((w, i) => {
    const name = `từ số ${i+1}`;
    if (!w || typeof w !== "object" || Array.isArray(w)) fail(name);
    for (const key of ["korean", "meaning"]) if (typeof w[key] !== "string" || !w[key].trim()) fail(`${name}: ${key}`);
    if (w.id !== undefined) {
      if (typeof w.id !== "string" || !w.id || ids.has(w.id)) fail(`${name}: ID trùng hoặc sai`);
      ids.add(w.id);
    }
    for (const key of ["pos", "pronunciation", "example", "notes"]) if (w[key] != null && typeof w[key] !== "string") fail(`${name}: ${key}`);
    for (const key of ["tags", "acceptedKorean", "acceptedMeaning"]) if (w[key] != null && (!Array.isArray(w[key]) || !w[key].every(x => typeof x === "string"))) fail(`${name}: ${key}`);
    if (w.image && (typeof w.image !== "string" || !/^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(w.image))) fail(`${name}: ảnh phải là dữ liệu JPEG/PNG/WebP/GIF`);
    for (const key of ["createdAt", "updatedAt"]) if (w[key] != null && !date(w[key])) fail(`${name}: ${key}`);
    if (w.fsrsCard != null) {
      const c = w.fsrsCard;
      if (typeof c !== "object" || !date(c.due) || ![0,1,2,3].includes(c.state)) fail(`${name}: trạng thái FSRS`);
      for (const key of ["stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses"]) if (!finite(c[key]) || c[key] < 0) fail(`${name}: FSRS ${key}`);
      if (c.last_review != null && !date(c.last_review)) fail(`${name}: ngày ôn`);
      if (c.learning_steps != null && (!Number.isInteger(c.learning_steps) || c.learning_steps < 0)) fail(`${name}: bước học`);
    }
    if (w.reviewLogs != null && (!Array.isArray(w.reviewLogs) || !w.reviewLogs.every(l => l && date(l.review) && date(l.due) && [0,1,2,3].includes(l.state) && [1,2,3,4].includes(l.rating)))) fail(`${name}: lịch sử ôn`);
  });
  if (data.fsrsSettings != null) {
    const a = data.fsrsSettings;
    if (!a || typeof a !== "object" || !finite(a.desiredRetention) || a.desiredRetention < .80 || a.desiredRetention > .97 || !Number.isInteger(a.newPerDay) || a.newPerDay < 0 || a.newPerDay > 200 || !Number.isInteger(a.maxReviewsPerDay) || a.maxReviewsPerDay < 1 || a.maxReviewsPerDay > 2000) fail("cài đặt FSRS");
  }
  return words;
}

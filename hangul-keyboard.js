const INITIALS = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const VOWELS = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const FINALS = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

const INITIAL_INDEX = new Map(INITIALS.map((value, index) => [value, index]));
const VOWEL_INDEX = new Map(VOWELS.map((value, index) => [value, index]));
const FINAL_INDEX = new Map(FINALS.map((value, index) => [value, index]));
const COMPOUND_VOWELS = new Map([
  ["ㅗㅏ", "ㅘ"], ["ㅗㅐ", "ㅙ"], ["ㅗㅣ", "ㅚ"],
  ["ㅜㅓ", "ㅝ"], ["ㅜㅔ", "ㅞ"], ["ㅜㅣ", "ㅟ"], ["ㅡㅣ", "ㅢ"]
]);
const COMPOUND_FINALS = new Map([
  ["ㄱㅅ", "ㄳ"], ["ㄴㅈ", "ㄵ"], ["ㄴㅎ", "ㄶ"],
  ["ㄹㄱ", "ㄺ"], ["ㄹㅁ", "ㄻ"], ["ㄹㅂ", "ㄼ"],
  ["ㄹㅅ", "ㄽ"], ["ㄹㅌ", "ㄾ"], ["ㄹㅍ", "ㄿ"],
  ["ㄹㅎ", "ㅀ"], ["ㅂㅅ", "ㅄ"]
]);
const SPLIT_FINALS = new Map([...COMPOUND_FINALS].map(([pair, combined]) => [combined, [...pair]]));

function syllable({ initial, vowel, final = "" }) {
  if (!initial || !vowel) return initial || vowel || "";
  const l = INITIAL_INDEX.get(initial);
  const v = VOWEL_INDEX.get(vowel);
  const t = FINAL_INDEX.get(final);
  if (l == null || v == null || t == null) return `${initial}${vowel}${final}`;
  return String.fromCharCode(0xac00 + ((l * 21) + v) * 28 + t);
}

export function composeJamoSequence(keys) {
  const committed = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    committed.push(syllable(current));
    current = null;
  };

  for (const key of keys) {
    const isVowel = VOWEL_INDEX.has(key);
    const isInitial = INITIAL_INDEX.has(key);
    if (!isVowel && !isInitial) {
      flush();
      committed.push(key);
      continue;
    }

    if (isInitial) {
      if (!current || !current.initial || !current.vowel) {
        if (current) flush();
        current = { initial: key, vowel: "", final: "" };
      } else if (!current.final && FINAL_INDEX.has(key)) {
        current.final = key;
      } else if (current.final) {
        const compound = COMPOUND_FINALS.get(current.final + key);
        if (compound) current.final = compound;
        else {
          flush();
          current = { initial: key, vowel: "", final: "" };
        }
      } else {
        flush();
        current = { initial: key, vowel: "", final: "" };
      }
      continue;
    }

    if (!current) {
      current = { initial: "", vowel: key, final: "" };
    } else if (!current.initial) {
      const compound = COMPOUND_VOWELS.get(current.vowel + key);
      if (compound) current.vowel = compound;
      else {
        flush();
        current = { initial: "", vowel: key, final: "" };
      }
    } else if (!current.vowel) {
      current.vowel = key;
    } else if (!current.final) {
      const compound = COMPOUND_VOWELS.get(current.vowel + key);
      if (compound) current.vowel = compound;
      else {
        flush();
        current = { initial: "", vowel: key, final: "" };
      }
    } else {
      const movingFinal = current.final;
      const split = SPLIT_FINALS.get(movingFinal);
      if (split) {
        current.final = split[0];
        flush();
        current = { initial: split[1], vowel: key, final: "" };
      } else {
        current.final = "";
        flush();
        current = { initial: movingFinal, vowel: key, final: "" };
      }
    }
  }

  flush();
  return committed.join("");
}

function replaceRange(input, start, oldLength, replacement) {
  const before = input.value.slice(0, start);
  const after = input.value.slice(start + oldLength);
  input.value = before + replacement + after;
  const caret = start + replacement.length;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function initHangulKeyboard({ root, input, form }) {
  let active = false;
  let start = 0;
  let keys = [];
  let output = "";
  let shifted = false;
  let available = false;
  let collapsed = localStorage.getItem("hangulKeyboardCollapsed") === "1";
  const body = root.querySelector("[data-keyboard-body]");
  const collapseButton = root.querySelector("[data-action=collapse]");
  const shiftButton = root.querySelector("[data-action=shift]");
  const letterButtons = [...root.querySelectorAll("[data-key]")];

  function resetComposition() {
    active = false;
    keys = [];
    output = "";
  }

  function renderShift() {
    shiftButton.classList.toggle("active", shifted);
    shiftButton.setAttribute("aria-pressed", String(shifted));
    for (const button of letterButtons) {
      button.textContent = shifted && button.dataset.shift ? button.dataset.shift : button.dataset.key;
    }
  }

  function renderCollapsed() {
    body.classList.toggle("hidden", collapsed);
    collapseButton.textContent = collapsed ? "Mở bàn phím" : "Thu gọn";
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
  }

  function beginIfNeeded() {
    if (active && input.selectionStart === start + output.length && input.selectionEnd === input.selectionStart) return;
    resetComposition();
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    if (selectionEnd > selectionStart) replaceRange(input, selectionStart, selectionEnd - selectionStart, "");
    start = selectionStart;
    active = true;
  }

  function pressJamo(jamo) {
    beginIfNeeded();
    keys.push(jamo);
    const next = composeJamoSequence(keys);
    replaceRange(input, start, output.length, next);
    output = next;
    input.focus({ preventScroll: true });
  }

  function backspace() {
    if (active && keys.length) {
      keys.pop();
      const next = composeJamoSequence(keys);
      replaceRange(input, start, output.length, next);
      output = next;
      if (!keys.length) resetComposition();
      return;
    }
    const from = input.selectionStart ?? input.value.length;
    const to = input.selectionEnd ?? from;
    if (to > from) replaceRange(input, from, to - from, "");
    else if (from > 0) {
      const previous = Array.from(input.value.slice(0, from)).pop() || "";
      replaceRange(input, from - previous.length, previous.length, "");
    }
  }

  function insertLiteral(text) {
    resetComposition();
    const from = input.selectionStart ?? input.value.length;
    const to = input.selectionEnd ?? from;
    replaceRange(input, from, to - from, text);
    input.focus({ preventScroll: true });
  }

  root.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse") event.preventDefault();
  });
  root.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    const action = button.dataset.action;
    if (button.dataset.key) {
      const jamo = shifted && button.dataset.shift ? button.dataset.shift : button.dataset.key;
      pressJamo(jamo);
      if (shifted) {
        shifted = false;
        renderShift();
      }
    } else if (action === "shift") {
      shifted = !shifted;
      renderShift();
    } else if (action === "backspace") backspace();
    else if (action === "space") insertLiteral(" ");
    else if (action === "clear") {
      resetComposition();
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus({ preventScroll: true });
    } else if (action === "enter") {
      resetComposition();
      form.requestSubmit();
    } else if (action === "collapse") {
      collapsed = !collapsed;
      localStorage.setItem("hangulKeyboardCollapsed", collapsed ? "1" : "0");
      renderCollapsed();
      if (!collapsed) input.focus({ preventScroll: true });
    }
  });

  for (const eventName of ["keydown", "click", "select", "compositionstart"]) input.addEventListener(eventName, resetComposition);
  renderShift();
  renderCollapsed();

  return {
    reset: resetComposition,
    setAvailable(value) {
      available = Boolean(value);
      root.classList.toggle("hidden", !available);
      if (available) renderCollapsed();
    },
    hideAfterAnswer() {
      resetComposition();
      if (available) root.classList.add("answered");
    },
    prepareForQuestion() {
      root.classList.remove("answered");
    }
  };
}

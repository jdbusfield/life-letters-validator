// ============================================
// Life Letters — Customer Form Frontend
// ============================================

let LETTER_HINTS = {};
let DEFAULT_CARDS = {};
let WORD_SUGGESTIONS = {};
let R_WARNING_LETTERS = [];
let DEFAULT_IMAGES = {};

const state = {};
let debounceTimers = {};
let orderNumber = "";
let dataLoaded = false;
let defaultAllAppliedTo = new Set();

// ---- Init ----

document.addEventListener("DOMContentLoaded", async () => {
  // Parse order number from URL (kept for /?order= deep links from purchase emails)
  const params = new URLSearchParams(window.location.search);
  orderNumber = params.get("order") || "";

  // Load letter data from server
  await loadLetterData();

  // Build UI
  buildHelperSheet();
  buildGrid();

  // Restore any saved progress from a previous visit (this device).
  restoreProgress();

  // Event listeners
  document.getElementById("validateAllBtn").addEventListener("click", validateAll);
  document.getElementById("submitBtn").addEventListener("click", submitOrder);
  document.getElementById("defaultAllCheckbox").addEventListener("change", handleDefaultAllToggle);
  document.getElementById("saveBtn").addEventListener("click", handleManualSave);
  document.getElementById("previewBtn").addEventListener("click", openPreview);
  document.getElementById("previewClose").addEventListener("click", closePreview);
  document.getElementById("previewKeepEditing").addEventListener("click", closePreview);
  document.getElementById("previewSubmit").addEventListener("click", () => {
    closePreview();
    submitOrder();
  });
  document.getElementById("previewOverlay").addEventListener("click", (e) => {
    if (e.target.id === "previewOverlay") closePreview();
  });
  document.getElementById("restoreStartOver").addEventListener("click", startOver);

  // Order fields + case preference: keep submit gating and autosave in sync.
  document.getElementById("customerName").addEventListener("input", onFieldChange);
  document.getElementById("customerEmail").addEventListener("input", onFieldChange);
  document.querySelectorAll('input[name="casePreference"]').forEach((el) =>
    el.addEventListener("change", scheduleSave)
  );

  updateSubmitButton();

  // Helper sheet toggle
  document.getElementById("helperToggle").addEventListener("click", () => {
    const content = document.getElementById("helperContent");
    const arrow = document.getElementById("toggleArrow");
    content.classList.toggle("open");
    arrow.classList.toggle("open");
  });
});

function onFieldChange() {
  updateSubmitButton();
  scheduleSave();
}

async function loadLetterData() {
  try {
    const res = await fetch("/api/letter-data");
    if (!res.ok) throw new Error("Failed to load letter data");
    const data = await res.json();
    LETTER_HINTS = data.letterHints;
    DEFAULT_CARDS = data.defaultCards;
    WORD_SUGGESTIONS = data.wordSuggestions;
    R_WARNING_LETTERS = data.rWarningLetters;
    DEFAULT_IMAGES = data.defaultImages || {};
    dataLoaded = true;
  } catch (err) {
    console.error("Failed to load letter data:", err);
    // Fallback hints if server fails
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    letters.forEach((l) => {
      LETTER_HINTS[l] = `/${l.toLowerCase()}/`;
      DEFAULT_CARDS[l] = l.toLowerCase();
      WORD_SUGGESTIONS[l] = [];
    });
  }
}

// ---- Brainstorming Helper Sheet ----

function buildHelperSheet() {
  const grid = document.getElementById("helperGrid");
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  letters.forEach((letter) => {
    const suggestions = WORD_SUGGESTIONS[letter] || [];
    const row = document.createElement("div");
    row.className = "helper-row";
    row.innerHTML = `
      <span class="helper-letter">${letter}</span>
      <span class="helper-words">${suggestions.join(", ")}</span>
    `;
    grid.appendChild(row);
  });
}

// ---- Default preview (image if available, else lettered placeholder) ----

function defaultPlaceholderSvg(letter, defaultWord) {
  return `
    <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
      <rect width="60" height="60" rx="8" fill="#f5e6b8"/>
      <text x="30" y="28" text-anchor="middle" font-family="Comic Neue, cursive" font-size="18" font-weight="700" fill="#3d3224">${letter}</text>
      <text x="30" y="48" text-anchor="middle" font-family="Comic Neue, cursive" font-size="11" fill="#7a6e5e">${defaultWord}</text>
    </svg>`;
}

function defaultPreviewMarkup(letter, defaultWord) {
  const imgUrl = DEFAULT_IMAGES[letter];
  const svg = defaultPlaceholderSvg(letter, defaultWord);
  if (imgUrl) {
    // Show the real default image; if it fails to load, reveal the SVG fallback.
    return `
      <img class="default-preview-photo" src="${imgUrl}" alt="Default for ${letter}: ${defaultWord}"
        onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
      <span class="default-preview-fallback" style="display:none;">${svg}</span>`;
  }
  return svg;
}

// ---- Letter Grid ----

function buildGrid() {
  const grid = document.getElementById("lettersGrid");
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  letters.forEach((letter) => {
    state[letter] = {
      word: "",
      status: "empty",
      feedback: "",
      photo: null,
      photoUrl: null,
      storagePath: null,
      isDefault: false,
    };

    const suggestions = (WORD_SUGGESTIONS[letter] || []).slice(0, 6);
    const hasRWarning = R_WARNING_LETTERS.includes(letter);
    const defaultWord = DEFAULT_CARDS[letter] || "";

    const card = document.createElement("div");
    card.className = "letter-card";
    card.id = `card-${letter}`;
    card.innerHTML = `
      <div class="letter-badge">${letter}</div>
      <div class="letter-body">
        <div class="letter-hint">${LETTER_HINTS[letter] || ""}</div>
        <input
          type="text"
          class="letter-input"
          id="input-${letter}"
          placeholder="Enter a word for ${letter}..."
          data-letter="${letter}"
          autocomplete="off"
        >
        <div class="letter-feedback" id="feedback-${letter}"></div>
        ${
          suggestions.length > 0
            ? `<div class="suggestion-chips" id="suggestions-${letter}">
                ${suggestions.map((w) => `<button class="suggestion-chip" data-letter="${letter}" data-word="${w}">${w}</button>`).join("")}
              </div>`
            : ""
        }
        ${
          hasRWarning
            ? `<div class="r-warning">&#9888; Avoid words with an R right after the initial letter</div>`
            : ""
        }
      </div>
      <div class="letter-actions">
        <div class="letter-photo" id="photo-area-${letter}" data-letter="${letter}">
          <input type="file" class="photo-file-input" id="file-${letter}" data-letter="${letter}" accept="image/*">
          <div class="photo-dropzone" id="dropzone-${letter}" data-letter="${letter}">
            <div class="photo-placeholder" id="placeholder-${letter}">
              <span class="photo-icon">&#128247;</span>
              <span class="photo-label">Add photo</span>
            </div>
            <div class="photo-preview-wrap" id="preview-wrap-${letter}" style="display:none;">
              <img class="photo-preview" id="preview-${letter}" alt="Photo for ${letter}">
              <button class="photo-remove" id="remove-${letter}" data-letter="${letter}" title="Remove photo">&times;</button>
            </div>
          </div>
          <div class="photo-status" id="photo-status-${letter}"></div>
        </div>
        <button class="default-btn" id="default-btn-${letter}" data-letter="${letter}" title="Use default: ${defaultWord}">
          <div class="default-preview-img">
            ${defaultPreviewMarkup(letter, defaultWord)}
          </div>
          <span class="default-btn-label">Use Default</span>
        </button>
      </div>
    `;
    grid.appendChild(card);
  });

  // Event listeners
  grid.addEventListener("input", handleInput);
  grid.addEventListener("focusout", handleBlur);
  grid.addEventListener("click", handleGridClick);
  grid.addEventListener("change", handleFileSelect);

  // Drag and drop + remove buttons
  letters.forEach((letter) => {
    const dropzone = document.getElementById(`dropzone-${letter}`);
    dropzone.addEventListener("dragover", handleDragOver);
    dropzone.addEventListener("dragleave", handleDragLeave);
    dropzone.addEventListener("drop", handleDrop);

    document.getElementById(`remove-${letter}`).addEventListener("click", (e) => {
      e.stopPropagation();
      removePhoto(letter);
    });
  });
}

// ---- Grid Click Handler (suggestions, defaults, photo) ----

function handleGridClick(e) {
  // Suggestion chip click
  const chip = e.target.closest(".suggestion-chip");
  if (chip) {
    const letter = chip.dataset.letter;
    const word = chip.dataset.word;
    document.getElementById(`input-${letter}`).value = word;
    state[letter].word = word;
    state[letter].isDefault = false;
    updateCardDefault(letter, false);
    validateSingle(letter, word);
    return;
  }

  // Default button click
  const defaultBtn = e.target.closest(".default-btn");
  if (defaultBtn) {
    const letter = defaultBtn.dataset.letter;
    toggleDefault(letter);
    return;
  }

  // Photo dropzone click
  const dropzone = e.target.closest(".photo-dropzone");
  if (dropzone && !e.target.closest(".photo-remove")) {
    const letter = dropzone.dataset.letter;
    if (!state[letter].isDefault) {
      document.getElementById(`file-${letter}`).click();
    }
    return;
  }
}

// ---- Default Toggle ----

function toggleDefault(letter) {
  const isDefault = !state[letter].isDefault;
  state[letter].isDefault = isDefault;

  if (isDefault) {
    const defaultWord = DEFAULT_CARDS[letter] || letter.toLowerCase();
    state[letter].word = defaultWord;
    document.getElementById(`input-${letter}`).value = defaultWord;
    document.getElementById(`input-${letter}`).disabled = true;
    updateCard(letter, "valid", `&#9989; Using default: ${defaultWord}`);
    state[letter].status = "valid";
    state[letter].feedback = `Using default: ${defaultWord}`;
    // Remove any custom photo
    removePhoto(letter);
  } else {
    state[letter].word = "";
    document.getElementById(`input-${letter}`).value = "";
    document.getElementById(`input-${letter}`).disabled = false;
    updateCard(letter, "empty", "");
    state[letter].status = "empty";
    state[letter].feedback = "";
  }

  updateCardDefault(letter, isDefault);
  updateSubmitButton();
}

function handleDefaultAllToggle(e) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  if (e.target.checked) {
    defaultAllAppliedTo = new Set();
    for (const l of letters) {
      const s = state[l];
      const hasValidCustom = !s.isDefault && s.word && s.status === "valid";
      if (!s.isDefault && !hasValidCustom) {
        toggleDefault(l);
        defaultAllAppliedTo.add(l);
      }
    }
  } else {
    for (const l of defaultAllAppliedTo) {
      if (state[l].isDefault) toggleDefault(l);
    }
    defaultAllAppliedTo.clear();
  }
}

function updateCardDefault(letter, isDefault) {
  const card = document.getElementById(`card-${letter}`);
  const defaultBtn = document.getElementById(`default-btn-${letter}`);
  const photoArea = document.getElementById(`photo-area-${letter}`);

  if (isDefault) {
    card.classList.add("is-default");
    defaultBtn.classList.add("active");
    defaultBtn.querySelector(".default-btn-label").textContent = "Cancel Default";
    photoArea.style.opacity = "0.4";
    photoArea.style.pointerEvents = "none";
  } else {
    card.classList.remove("is-default");
    defaultBtn.classList.remove("active");
    defaultBtn.querySelector(".default-btn-label").textContent = "Use Default";
    photoArea.style.opacity = "1";
    photoArea.style.pointerEvents = "auto";
  }
}

// ---- Text Input Handlers ----

function handleInput(e) {
  if (!e.target.classList.contains("letter-input")) return;
  const letter = e.target.dataset.letter;
  const word = e.target.value.trim();
  state[letter].word = word;
  state[letter].isDefault = false;
  updateCardDefault(letter, false);

  if (debounceTimers[letter]) clearTimeout(debounceTimers[letter]);

  if (!word) {
    state[letter].status = "empty";
    state[letter].feedback = "";
    updateCard(letter, "empty", "");
    updateSubmitButton();
    scheduleSave();
    return;
  }

  // Word changed but not yet checked — mark pending so it can't slip through
  // submission on a stale "valid" status from a previous word.
  state[letter].status = "pending";
  updateCard(letter, "empty", "");
  updateSubmitButton();
  scheduleSave();

  debounceTimers[letter] = setTimeout(() => {
    validateSingle(letter, word);
  }, 800);
}

function handleBlur(e) {
  if (!e.target.classList.contains("letter-input")) return;
  const letter = e.target.dataset.letter;
  const word = e.target.value.trim();

  if (debounceTimers[letter]) clearTimeout(debounceTimers[letter]);

  if (word && state[letter].status !== "valid") {
    validateSingle(letter, word);
  }
}

// ---- Photo Handlers ----

function handleFileSelect(e) {
  if (!e.target.classList.contains("photo-file-input")) return;
  const letter = e.target.dataset.letter;
  const file = e.target.files[0];
  if (file) processPhoto(letter, file);
}

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add("drag-over");
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove("drag-over");
  const letter = e.currentTarget.dataset.letter;
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    processPhoto(letter, file);
  }
}

function processPhoto(letter, file) {
  if (file.size > 10 * 1024 * 1024) {
    setPhotoStatus(letter, "error", "File too large (max 10 MB)");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => showPhotoPreview(letter, e.target.result);
  reader.readAsDataURL(file);
  uploadPhoto(letter, file);
}

function showPhotoPreview(letter, dataUrl) {
  document.getElementById(`placeholder-${letter}`).style.display = "none";
  const previewWrap = document.getElementById(`preview-wrap-${letter}`);
  document.getElementById(`preview-${letter}`).src = dataUrl;
  previewWrap.style.display = "flex";
}

function removePhoto(letter) {
  document.getElementById(`placeholder-${letter}`).style.display = "flex";
  document.getElementById(`preview-wrap-${letter}`).style.display = "none";
  document.getElementById(`file-${letter}`).value = "";
  state[letter].photo = null;
  state[letter].photoUrl = null;
  state[letter].storagePath = null;
  setPhotoStatus(letter, "", "");
  updateSubmitButton();
}

async function uploadPhoto(letter, file) {
  setPhotoStatus(letter, "uploading", "Uploading...");

  const formData = new FormData();
  formData.append("photo", file);

  try {
    const res = await fetch(`/api/upload/${letter}?order=${encodeURIComponent(orderNumber || "unassigned")}`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Upload failed");
    }

    const result = await res.json();
    state[letter].photo = true;
    state[letter].photoUrl = result.url;
    state[letter].storagePath = result.storagePath;

    const sizeMB = (result.size / (1024 * 1024)).toFixed(1);
    setPhotoStatus(letter, "success", `Uploaded (${sizeMB} MB)`);
  } catch (err) {
    console.error("Upload error:", err);
    setPhotoStatus(letter, "error", err.message || "Upload failed");
  }

  updateSubmitButton();
}

function setPhotoStatus(letter, type, message) {
  const el = document.getElementById(`photo-status-${letter}`);
  el.className = `photo-status ${type}`;
  el.textContent = message;
}

// ---- Validation ----

// Latest validation request id per letter. Clicking a suggestion chip right
// after typing fires two checks (blur + chip); only the newest one may update
// the card, so a slow or failed older request can't overwrite the result.
const validationSeq = {};

async function validateSingle(letter, word) {
  if (!word) return;

  const seq = (validationSeq[letter] || 0) + 1;
  validationSeq[letter] = seq;
  const isStale = () => validationSeq[letter] !== seq;

  updateCard(letter, "validating", '<span class="spinner"></span> Checking...');

  try {
    let res = await postValidate(letter, word);
    // One retry on a server error (e.g. a transient AI API failure).
    if (!res.ok && res.status >= 500 && !isStale()) {
      res = await postValidate(letter, word);
    }
    if (isStale()) return;

    if (!res.ok) throw new Error(`Validation failed (${res.status})`);

    const result = await res.json();
    if (isStale()) return;

    if (result.valid) {
      const msg = `${result.emoji || "\u2705"} ${result.message}`;
      updateCard(letter, "valid", msg);
      state[letter].status = "valid";
      state[letter].feedback = result.message;
    } else {
      let msg = `${result.emoji || "\u274C"} ${result.message}`;
      if (result.suggestion) {
        msg += ` Try: ${result.suggestion}`;
      }
      updateCard(letter, "invalid", msg);
      state[letter].status = "invalid";
      state[letter].feedback = result.message;
    }
  } catch (err) {
    if (isStale()) return;
    console.error("Validation error:", err);
    updateCard(letter, "invalid", "\u26A0\uFE0F Could not validate. Please try again.");
    state[letter].status = "error";
  }

  updateSubmitButton();
}

function postValidate(letter, word) {
  return fetch("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ letter, word }),
  });
}

function updateCard(letter, status, feedbackHtml) {
  const card = document.getElementById(`card-${letter}`);
  const feedback = document.getElementById(`feedback-${letter}`);

  card.classList.remove("valid", "invalid", "validating");

  if (status === "valid") {
    card.classList.add("valid");
    feedback.className = "letter-feedback success";
  } else if (status === "invalid" || status === "error") {
    card.classList.add("invalid");
    feedback.className = "letter-feedback error";
  } else if (status === "validating") {
    card.classList.add("validating");
    feedback.className = "letter-feedback loading";
  } else {
    feedback.className = "letter-feedback";
  }

  feedback.innerHTML = feedbackHtml;
}

// ---- Validate All ----

async function validateAll() {
  const btn = document.getElementById("validateAllBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Validating...';

  const entries = [];
  for (const letter of Object.keys(state)) {
    if (state[letter].isDefault) continue; // skip defaults
    const word = state[letter].word || document.getElementById(`input-${letter}`).value.trim();
    state[letter].word = word;
    if (word) {
      entries.push({ letter, word });
      updateCard(letter, "validating", '<span class="spinner"></span> Checking...');
    }
  }

  if (entries.length === 0) {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">\u26A1</span> Validate All Words';
    return;
  }

  try {
    const res = await fetch("/api/validate-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });

    if (!res.ok) throw new Error("Batch validation failed");

    const { results } = await res.json();

    for (const { letter } of entries) {
      const result = results[letter];
      if (!result) {
        updateCard(letter, "invalid", "\u26A0\uFE0F No result returned. Try validating individually.");
        state[letter].status = "error";
        continue;
      }

      if (result.valid) {
        updateCard(letter, "valid", `${result.emoji || "\u2705"} ${result.message}`);
        state[letter].status = "valid";
        state[letter].feedback = result.message;
      } else {
        let msg = `${result.emoji || "\u274C"} ${result.message}`;
        if (result.suggestion) msg += ` Try: ${result.suggestion}`;
        updateCard(letter, "invalid", msg);
        state[letter].status = "invalid";
        state[letter].feedback = result.message;
      }
    }
  } catch (err) {
    console.error("Batch validation error:", err);
    for (const { letter } of entries) {
      if (state[letter].status === "validating" || !state[letter].status) {
        updateCard(letter, "invalid", "\u26A0\uFE0F Validation failed. Try again.");
        state[letter].status = "error";
      }
    }
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">\u26A1</span> Validate All Words';
  updateSubmitButton();
}

// ---- Submit ----

function getCompletionStatus() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const empty = [];
  const invalid = [];
  const validating = [];
  const pending = [];

  for (const l of letters) {
    const s = state[l];
    if (!s) continue;
    if (s.isDefault) continue;
    if (!s.word) {
      empty.push(l);
    } else if (s.status === "invalid" || s.status === "error") {
      invalid.push(l);
    } else if (s.status === "validating") {
      validating.push(l);
    } else if (s.status !== "valid") {
      pending.push(l);
    }
  }

  const name = document.getElementById("customerName").value.trim();
  const email = document.getElementById("customerEmail").value.trim();

  return { empty, invalid, validating, pending, name, email };
}

function abbreviate(list, max = 8) {
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} +${list.length - max} more`;
}

function updateSubmitButton() {
  const { empty, invalid, validating, pending, name, email } =
    getCompletionStatus();

  // Submission is blocked while any letter still has an unresolved error, is
  // mid-check, or has no word/default — and until name + email are filled in.
  // Pending (typed-but-unverified) words are allowed through the button; they
  // get auto-validated on submit, so an error there still stops the order.
  const blocked =
    invalid.length > 0 ||
    validating.length > 0 ||
    empty.length > 0 ||
    !name ||
    !email;

  document.getElementById("submitBtn").disabled = blocked;

  const hint = document.getElementById("submitHint");
  if (!hint) return;

  if (invalid.length > 0) {
    hint.className = "submit-hint error";
    hint.textContent = `⚠️ Fix ${invalid.length} letter${invalid.length > 1 ? "s" : ""} with an error before submitting: ${abbreviate(invalid)}`;
  } else if (validating.length > 0) {
    hint.className = "submit-hint loading";
    hint.textContent = `Checking ${abbreviate(validating)}…`;
  } else if (empty.length > 0) {
    hint.className = "submit-hint";
    hint.textContent = `${empty.length} letter${empty.length > 1 ? "s" : ""} still need a word or "Use Default": ${abbreviate(empty)}`;
  } else if (!name || !email) {
    hint.className = "submit-hint";
    hint.textContent = "Add your name and email above to submit.";
  } else if (pending.length > 0) {
    hint.className = "submit-hint";
    hint.textContent = `Ready — we'll double-check ${pending.length} unverified word${pending.length > 1 ? "s" : ""} when you submit.`;
  } else {
    hint.className = "submit-hint ok";
    hint.textContent = "All set! ✅";
  }

  // Persist progress on every meaningful state change.
  scheduleSave();
}

async function submitOrder() {
  const customerName = document.getElementById("customerName").value.trim();
  const customerEmail = document.getElementById("customerEmail").value.trim();
  const letterStyle =
    document.querySelector('input[name="casePreference"]:checked')?.value || "mix";

  // Validation
  if (!customerEmail) {
    alert("Please enter your email address.");
    document.getElementById("customerEmail").focus();
    return;
  }
  if (!customerName) {
    alert("Please enter your name.");
    document.getElementById("customerName").focus();
    return;
  }

  // Safety net: validate any words that were typed but never checked, so an
  // unverified-but-wrong word can't slip through. Errors here block the order.
  const ok = await validatePendingBeforeSubmit();
  if (!ok) return;

  // Check all letters are accounted for (either custom word or default)
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const incompleteLetters = letters.filter((l) => {
    const s = state[l];
    return !s.isDefault && (!s.word || s.status === "invalid" || s.status === "error");
  });

  if (incompleteLetters.length > 0) {
    const emptyLetters = letters.filter((l) => !state[l].isDefault && !state[l].word);
    const invalidLetters = letters.filter(
      (l) => !state[l].isDefault && state[l].word && (state[l].status === "invalid" || state[l].status === "error")
    );

    let msg = "Please complete all letters before submitting:\n";
    if (emptyLetters.length > 0) {
      msg += `\nMissing words: ${emptyLetters.join(", ")}`;
    }
    if (invalidLetters.length > 0) {
      msg += `\nInvalid words: ${invalidLetters.join(", ")}`;
    }
    msg += "\n\nTip: Click 'Use Default' for any letters you don't have a custom word for.";
    alert(msg);
    return;
  }

  // Build entries
  const entries = letters.map((letter) => ({
    letter,
    word: state[letter].word || DEFAULT_CARDS[letter],
    isDefault: state[letter].isDefault,
    photoUrl: state[letter].photoUrl || null,
    photoStoragePath: state[letter].storagePath || null,
    validationStatus: state[letter].isDefault
      ? "skipped"
      : state[letter].status === "valid"
        ? "valid"
        : "pending",
  }));

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Submitting...';

  try {
    const res = await fetch("/api/submit-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderNumber,
        customerEmail,
        customerName,
        letterStyle,
        entries,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Submission failed");
    }

    await res.json();

    // Order is in — clear the locally saved draft.
    clearProgress();

    // Show confirmation
    document.getElementById("confirmationSection").style.display = "block";

    // Hide the form sections
    document.querySelector(".order-card").style.display = "none";
    document.querySelector(".case-card").style.display = "none";
    document.querySelector(".letters-section").style.display = "none";
    document.querySelector(".actions").style.display = "none";
    document.querySelector(".helper-card").style.display = "none";

    // Scroll to confirmation
    document.getElementById("confirmationSection").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error("Submit error:", err);
    alert(`Submission failed: ${err.message}\n\nPlease try again.`);
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="btn-icon">&#128230;</span> Submit Order';
  }
}

// ---- Validate pending words right before submit ----

async function validatePendingBeforeSubmit() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const pending = letters.filter((l) => {
    const s = state[l];
    return !s.isDefault && s.word && s.status !== "valid";
  });

  if (pending.length === 0) return true;

  const submitBtn = document.getElementById("submitBtn");
  const original = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Checking words...';

  const entries = pending.map((letter) => {
    updateCard(letter, "validating", '<span class="spinner"></span> Checking...');
    state[letter].status = "validating";
    return { letter, word: state[letter].word };
  });

  try {
    const res = await fetch("/api/validate-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) throw new Error("Validation failed");
    const { results } = await res.json();

    for (const { letter } of entries) {
      const result = results[letter];
      if (!result) {
        updateCard(letter, "invalid", "⚠️ Could not check this word. Please review it.");
        state[letter].status = "error";
        continue;
      }
      if (result.valid) {
        updateCard(letter, "valid", `${result.emoji || "✅"} ${result.message}`);
        state[letter].status = "valid";
        state[letter].feedback = result.message;
      } else {
        let msg = `${result.emoji || "❌"} ${result.message}`;
        if (result.suggestion) msg += ` Try: ${result.suggestion}`;
        updateCard(letter, "invalid", msg);
        state[letter].status = "invalid";
        state[letter].feedback = result.message;
      }
    }
  } catch (err) {
    console.error("Pre-submit validation error:", err);
    // Don't hard-block on a network hiccup — mark unchecked words so the
    // completeness check below can decide, and let the user retry.
    for (const { letter } of entries) {
      if (state[letter].status === "validating") state[letter].status = "error";
    }
  }

  submitBtn.innerHTML = original;
  updateSubmitButton();

  const stillBad = pending.filter(
    (l) => state[l].status === "invalid" || state[l].status === "error"
  );
  if (stillBad.length > 0) {
    const firstCard = document.getElementById(`card-${stillBad[0]}`);
    if (firstCard) firstCard.scrollIntoView({ behavior: "smooth", block: "center" });
    alert(
      `Some words need attention before we can submit:\n\n${stillBad.join(", ")}\n\nPlease fix them (or click "Use Default") and try again.`
    );
    return false;
  }
  return true;
}

// ============================================
// Save & resume (localStorage, per device)
// ============================================

const STORAGE_KEY = "lifeLetters:progress:v1";
let saveTimer = null;
let restoring = false;

function scheduleSave() {
  if (restoring || !dataLoaded) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProgress, 500);
}

function saveProgress() {
  try {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const data = {
      savedAt: new Date().toISOString(),
      orderNumber,
      customerName: document.getElementById("customerName").value,
      customerEmail: document.getElementById("customerEmail").value,
      letterStyle:
        document.querySelector('input[name="casePreference"]:checked')?.value || "mix",
      letters: {},
    };
    let hasContent = false;
    for (const l of letters) {
      const s = state[l];
      if (!s) continue;
      if (s.word || s.isDefault || s.photoUrl) hasContent = true;
      data.letters[l] = {
        word: s.word || "",
        status: s.status,
        isDefault: !!s.isDefault,
        photoUrl: s.photoUrl || null,
        storagePath: s.storagePath || null,
        feedback: s.feedback || "",
      };
    }
    if (!hasContent && !data.customerName && !data.customerEmail) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("Could not save progress:", err);
  }
}

function clearProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function restoreProgress() {
  let data;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (!data || !data.letters) return;

  restoring = true;

  if (data.customerName) document.getElementById("customerName").value = data.customerName;
  if (data.customerEmail) document.getElementById("customerEmail").value = data.customerEmail;
  if (data.letterStyle) {
    const radio = document.querySelector(`input[name="casePreference"][value="${data.letterStyle}"]`);
    if (radio) radio.checked = true;
  }
  if (data.orderNumber) orderNumber = data.orderNumber;

  for (const [letter, saved] of Object.entries(data.letters)) {
    if (!state[letter]) continue;
    if (saved.isDefault) {
      // Re-apply the default exactly as the user left it.
      toggleDefault(letter);
      continue;
    }
    if (!saved.word && !saved.photoUrl) continue;

    state[letter].word = saved.word || "";
    state[letter].status = saved.status || (saved.word ? "pending" : "empty");
    state[letter].feedback = saved.feedback || "";
    const input = document.getElementById(`input-${letter}`);
    if (input) input.value = saved.word || "";

    // Re-render the saved validation result on the card.
    if (state[letter].status === "valid") {
      updateCard(letter, "valid", `✅ ${saved.feedback || "Looks good"}`);
    } else if (state[letter].status === "invalid" || state[letter].status === "error") {
      updateCard(letter, "invalid", `❌ ${saved.feedback || "Please review this word"}`);
    } else {
      updateCard(letter, "empty", "");
    }

    // Restore the uploaded photo preview (the file lives in storage already).
    if (saved.photoUrl) {
      state[letter].photo = true;
      state[letter].photoUrl = saved.photoUrl;
      state[letter].storagePath = saved.storagePath || null;
      showPhotoPreview(letter, saved.photoUrl);
      setPhotoStatus(letter, "success", "Saved photo");
    }
  }

  restoring = false;

  // Show the resume banner.
  const banner = document.getElementById("restoreBanner");
  const text = document.getElementById("restoreText");
  if (banner && text) {
    let when = "";
    if (data.savedAt) {
      try {
        when = ` from ${new Date(data.savedAt).toLocaleString()}`;
      } catch {
        /* ignore */
      }
    }
    text.textContent = `Welcome back! We restored your saved progress${when}.`;
    banner.style.display = "flex";
  }

  updateSubmitButton();
}

function startOver() {
  if (!confirm("Start over and clear your saved progress on this device? This can't be undone.")) {
    return;
  }
  clearProgress();
  window.location.reload();
}

function handleManualSave() {
  saveProgress();
  showToast("Progress saved on this device — come back anytime to finish.");
}

// ============================================
// Preview modal
// ============================================

function letterDisplayHtml(letter) {
  const style =
    document.querySelector('input[name="casePreference"]:checked')?.value || "mix";
  const upper = letter.toUpperCase();
  const lower = letter.toLowerCase();
  if (style === "lower") return `<span class="pv-letter">${lower}</span>`;
  if (style === "upper") return `<span class="pv-letter">${upper}</span>`;
  return `<span class="pv-letter">${upper}<span class="pv-letter-lower">${lower}</span></span>`;
}

function previewImageHtml(letter) {
  const s = state[letter];
  let url = null;
  if (!s.isDefault) {
    // Prefer the uploaded URL; otherwise reuse the in-form preview thumbnail
    // (a data URL) so the preview works even before the upload finishes.
    if (s.photoUrl) {
      url = s.photoUrl;
    } else {
      const wrap = document.getElementById(`preview-wrap-${letter}`);
      const img = document.getElementById(`preview-${letter}`);
      if (wrap && wrap.style.display !== "none" && img && img.src) url = img.src;
    }
  } else if (DEFAULT_IMAGES[letter]) {
    url = DEFAULT_IMAGES[letter];
  }

  if (url) {
    return `<div class="pv-photo"><img src="${url}" alt="Photo for ${letter}"></div>`;
  }
  const label = s.isDefault ? "Default photo" : "No photo yet";
  return `<div class="pv-photo pv-photo-empty">${label}</div>`;
}

function openPreview() {
  const grid = document.getElementById("previewGrid");
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  grid.innerHTML = letters
    .map((letter) => {
      const s = state[letter];
      const word = s.isDefault ? DEFAULT_CARDS[letter] || "" : s.word || "";
      const badge = s.isDefault
        ? '<span class="pv-tag default">Default</span>'
        : s.status === "valid"
          ? '<span class="pv-tag ok">✓</span>'
          : s.status === "invalid" || s.status === "error"
            ? '<span class="pv-tag bad">!</span>'
            : word
              ? '<span class="pv-tag pending">?</span>'
              : '<span class="pv-tag empty">—</span>';
      return `
        <div class="pv-card">
          <div class="pv-card-top">${letterDisplayHtml(letter)}${badge}</div>
          ${previewImageHtml(letter)}
          <div class="pv-word">${word || "<em>empty</em>"}</div>
        </div>`;
    })
    .join("");

  document.getElementById("previewOverlay").style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closePreview() {
  document.getElementById("previewOverlay").style.display = "none";
  document.body.style.overflow = "";
}

// ============================================
// Toast
// ============================================

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = "block";
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.style.display = "none";
    }, 300);
  }, 3200);
}

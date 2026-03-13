// ============================================
// Life Letters — Customer Form Frontend
// ============================================

let LETTER_HINTS = {};
let DEFAULT_CARDS = {};
let WORD_SUGGESTIONS = {};
let R_WARNING_LETTERS = [];

const state = {};
let debounceTimers = {};
let orderNumber = "";
let dataLoaded = false;

// ---- Init ----

document.addEventListener("DOMContentLoaded", async () => {
  // Parse order number from URL
  const params = new URLSearchParams(window.location.search);
  orderNumber = params.get("order") || "";
  if (orderNumber) {
    document.getElementById("orderNumber").value = orderNumber;
  }

  // Load letter data from server
  await loadLetterData();

  // Build UI
  buildHelperSheet();
  buildGrid();

  // Event listeners
  document.getElementById("validateAllBtn").addEventListener("click", validateAll);
  document.getElementById("submitBtn").addEventListener("click", submitOrder);

  // Helper sheet toggle
  document.getElementById("helperToggle").addEventListener("click", () => {
    const content = document.getElementById("helperContent");
    const arrow = document.getElementById("toggleArrow");
    content.classList.toggle("open");
    arrow.classList.toggle("open");
  });
});

async function loadLetterData() {
  try {
    const res = await fetch("/api/letter-data");
    if (!res.ok) throw new Error("Failed to load letter data");
    const data = await res.json();
    LETTER_HINTS = data.letterHints;
    DEFAULT_CARDS = data.defaultCards;
    WORD_SUGGESTIONS = data.wordSuggestions;
    R_WARNING_LETTERS = data.rWarningLetters;
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
            <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
              <rect width="60" height="60" rx="8" fill="#f5e6b8"/>
              <text x="30" y="28" text-anchor="middle" font-family="Comic Neue, cursive" font-size="18" font-weight="700" fill="#3d3224">${letter}</text>
              <text x="30" y="48" text-anchor="middle" font-family="Comic Neue, cursive" font-size="11" fill="#7a6e5e">${defaultWord}</text>
            </svg>
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
    updateCard(letter, "empty", "");
    updateSubmitButton();
    return;
  }

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

async function validateSingle(letter, word) {
  if (!word) return;

  updateCard(letter, "validating", '<span class="spinner"></span> Checking...');

  try {
    const res = await fetch("/api/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ letter, word }),
    });

    if (!res.ok) throw new Error("Validation failed");

    const result = await res.json();

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
    console.error("Validation error:", err);
    updateCard(letter, "invalid", "\u26A0\uFE0F Could not validate. Please try again.");
    state[letter].status = "error";
  }

  updateSubmitButton();
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

function updateSubmitButton() {
  // Enable submit if there's some content
  const hasAnyContent = Object.values(state).some(
    (s) => s.word || s.photo || s.isDefault
  );
  document.getElementById("submitBtn").disabled = !hasAnyContent;
}

async function submitOrder() {
  const customerName = document.getElementById("customerName").value.trim();
  const customerEmail = document.getElementById("customerEmail").value.trim();
  const letterStyle =
    document.querySelector('input[name="casePreference"]:checked')?.value || "mix";

  // Validation
  if (!orderNumber) {
    alert("No order number found. Please use the link from your purchase email.");
    return;
  }
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

    const result = await res.json();

    // Show confirmation
    document.getElementById("confirmOrderNumber").textContent = orderNumber;
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

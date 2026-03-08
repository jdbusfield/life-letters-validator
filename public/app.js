// ============================================
// Life Letters Validator — Frontend
// ============================================

const LETTER_HINTS = {
  A: '/a/ like in apple',
  B: '/b/ like in ball',
  C: '/k/ like in cat (hard C)',
  D: '/d/ like in dog',
  E: '/e/ like in elephant',
  F: '/f/ like in fish',
  G: '/g/ like in goat (hard G)',
  H: '/h/ like in hat',
  I: '/i/ like in igloo',
  J: '/j/ like in jump',
  K: '/k/ like in kite',
  L: '/l/ like in lion',
  M: '/m/ like in moon',
  N: '/n/ like in nest',
  O: '/o/ like in octopus',
  P: '/p/ like in pig',
  Q: '/kw/ like in queen',
  R: '/r/ like in rain',
  S: '/s/ like in sun',
  T: '/t/ like in tiger',
  U: '/u/ like in umbrella',
  V: '/v/ like in van',
  W: '/w/ like in water',
  X: '/ks/ like in x-ray',
  Y: '/y/ like in yellow',
  Z: '/z/ like in zebra',
};

// State
const state = {};
let debounceTimers = {};

// Build the letter grid
function buildGrid() {
  const grid = document.getElementById('lettersGrid');
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  letters.forEach(letter => {
    state[letter] = { word: '', status: 'empty', feedback: '', photo: null, photoUrl: null };

    const card = document.createElement('div');
    card.className = 'letter-card';
    card.id = `card-${letter}`;
    card.innerHTML = `
      <div class="letter-badge">${letter}</div>
      <div class="letter-body">
        <div class="letter-hint">${LETTER_HINTS[letter]}</div>
        <input
          type="text"
          class="letter-input"
          id="input-${letter}"
          placeholder="Enter a word for ${letter}..."
          data-letter="${letter}"
          autocomplete="off"
        >
        <div class="letter-feedback" id="feedback-${letter}"></div>
      </div>
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
    `;
    grid.appendChild(card);
  });

  // Attach event listeners — text input
  grid.addEventListener('input', handleInput);
  grid.addEventListener('focusout', handleBlur);

  // Attach event listeners — photo upload
  grid.addEventListener('click', handlePhotoClick);
  grid.addEventListener('change', handleFileSelect);

  // Drag and drop on each dropzone
  letters.forEach(letter => {
    const dropzone = document.getElementById(`dropzone-${letter}`);
    dropzone.addEventListener('dragover', handleDragOver);
    dropzone.addEventListener('dragleave', handleDragLeave);
    dropzone.addEventListener('drop', handleDrop);

    const removeBtn = document.getElementById(`remove-${letter}`);
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removePhoto(letter);
    });
  });
}

// ---- Text Input Handlers ----

function handleInput(e) {
  if (!e.target.classList.contains('letter-input')) return;
  const letter = e.target.dataset.letter;
  const word = e.target.value.trim();
  state[letter].word = word;

  if (debounceTimers[letter]) clearTimeout(debounceTimers[letter]);

  if (!word) {
    updateCard(letter, 'empty', '');
    updateExportButton();
    return;
  }

  debounceTimers[letter] = setTimeout(() => {
    validateSingle(letter, word);
  }, 800);
}

function handleBlur(e) {
  if (!e.target.classList.contains('letter-input')) return;
  const letter = e.target.dataset.letter;
  const word = e.target.value.trim();

  if (debounceTimers[letter]) clearTimeout(debounceTimers[letter]);

  if (word && state[letter].status !== 'valid') {
    validateSingle(letter, word);
  }
}

// ---- Photo Handlers ----

function handlePhotoClick(e) {
  // Click on dropzone or placeholder opens file picker
  const dropzone = e.target.closest('.photo-dropzone');
  if (!dropzone) return;
  // Don't open if clicking the remove button
  if (e.target.closest('.photo-remove')) return;
  const letter = dropzone.dataset.letter;
  document.getElementById(`file-${letter}`).click();
}

function handleFileSelect(e) {
  if (!e.target.classList.contains('photo-file-input')) return;
  const letter = e.target.dataset.letter;
  const file = e.target.files[0];
  if (file) {
    processPhoto(letter, file);
  }
}

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');

  const letter = e.currentTarget.dataset.letter;
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    processPhoto(letter, file);
  }
}

function processPhoto(letter, file) {
  // Validate file size (10 MB max)
  if (file.size > 10 * 1024 * 1024) {
    setPhotoStatus(letter, 'error', 'File too large (max 10 MB)');
    return;
  }

  // Show local preview immediately
  const reader = new FileReader();
  reader.onload = (e) => {
    showPhotoPreview(letter, e.target.result);
  };
  reader.readAsDataURL(file);

  // Upload to server
  uploadPhoto(letter, file);
}

function showPhotoPreview(letter, dataUrl) {
  const placeholder = document.getElementById(`placeholder-${letter}`);
  const previewWrap = document.getElementById(`preview-wrap-${letter}`);
  const preview = document.getElementById(`preview-${letter}`);

  preview.src = dataUrl;
  placeholder.style.display = 'none';
  previewWrap.style.display = 'flex';
}

function removePhoto(letter) {
  const placeholder = document.getElementById(`placeholder-${letter}`);
  const previewWrap = document.getElementById(`preview-wrap-${letter}`);
  const fileInput = document.getElementById(`file-${letter}`);

  placeholder.style.display = 'flex';
  previewWrap.style.display = 'none';
  fileInput.value = '';
  state[letter].photo = null;
  state[letter].photoUrl = null;
  setPhotoStatus(letter, '', '');
  updateExportButton();
}

async function uploadPhoto(letter, file) {
  setPhotoStatus(letter, 'uploading', 'Uploading...');

  const formData = new FormData();
  formData.append('photo', file);

  try {
    const res = await fetch(`/api/upload/${letter}`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Upload failed');
    }

    const result = await res.json();
    state[letter].photo = result.filename;
    state[letter].photoUrl = result.url;

    const sizeMB = (result.size / (1024 * 1024)).toFixed(1);
    setPhotoStatus(letter, 'success', `Uploaded (${sizeMB} MB)`);
  } catch (err) {
    console.error('Upload error:', err);
    setPhotoStatus(letter, 'error', err.message || 'Upload failed');
  }

  updateExportButton();
}

function setPhotoStatus(letter, type, message) {
  const el = document.getElementById(`photo-status-${letter}`);
  el.className = `photo-status ${type}`;
  el.textContent = message;
}

// ---- Validation ----

async function validateSingle(letter, word) {
  if (!word) return;

  updateCard(letter, 'validating', '<span class="spinner"></span> Checking...');

  try {
    const res = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ letter, word }),
    });

    if (!res.ok) throw new Error('Validation failed');

    const result = await res.json();

    if (result.valid) {
      const msg = `${result.emoji || '\u2705'} ${result.message}`;
      updateCard(letter, 'valid', msg);
      state[letter].status = 'valid';
      state[letter].feedback = result.message;
    } else {
      let msg = `${result.emoji || '\u274C'} ${result.message}`;
      if (result.suggestion) {
        msg += ` Try: ${result.suggestion}`;
      }
      updateCard(letter, 'invalid', msg);
      state[letter].status = 'invalid';
      state[letter].feedback = result.message;
    }
  } catch (err) {
    console.error('Validation error:', err);
    updateCard(letter, 'invalid', '\u26A0\uFE0F Could not validate. Please try again.');
    state[letter].status = 'error';
  }

  updateExportButton();
}

function updateCard(letter, status, feedbackHtml) {
  const card = document.getElementById(`card-${letter}`);
  const feedback = document.getElementById(`feedback-${letter}`);

  card.classList.remove('valid', 'invalid', 'validating');

  if (status === 'valid') {
    card.classList.add('valid');
    feedback.className = 'letter-feedback success';
  } else if (status === 'invalid' || status === 'error') {
    card.classList.add('invalid');
    feedback.className = 'letter-feedback error';
  } else if (status === 'validating') {
    card.classList.add('validating');
    feedback.className = 'letter-feedback loading';
  } else {
    feedback.className = 'letter-feedback';
  }

  feedback.innerHTML = feedbackHtml;
}

// ---- Validate All ----

async function validateAll() {
  const btn = document.getElementById('validateAllBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Validating...';

  const entries = [];
  for (const letter of Object.keys(state)) {
    const word = state[letter].word || document.getElementById(`input-${letter}`).value.trim();
    state[letter].word = word;
    if (word) {
      entries.push({ letter, word });
      updateCard(letter, 'validating', '<span class="spinner"></span> Checking...');
    }
  }

  if (entries.length === 0) {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">\u26A1</span> Validate All Words';
    return;
  }

  try {
    const res = await fetch('/api/validate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });

    if (!res.ok) throw new Error('Batch validation failed');

    const { results } = await res.json();

    for (const { letter } of entries) {
      const result = results[letter];
      if (!result) {
        updateCard(letter, 'invalid', '\u26A0\uFE0F No result returned. Try validating individually.');
        state[letter].status = 'error';
        continue;
      }

      if (result.valid) {
        const msg = `${result.emoji || '\u2705'} ${result.message}`;
        updateCard(letter, 'valid', msg);
        state[letter].status = 'valid';
        state[letter].feedback = result.message;
      } else {
        let msg = `${result.emoji || '\u274C'} ${result.message}`;
        if (result.suggestion) {
          msg += ` Try: ${result.suggestion}`;
        }
        updateCard(letter, 'invalid', msg);
        state[letter].status = 'invalid';
        state[letter].feedback = result.message;
      }
    }
  } catch (err) {
    console.error('Batch validation error:', err);
    for (const { letter } of entries) {
      if (state[letter].status === 'validating' || !state[letter].status) {
        updateCard(letter, 'invalid', '\u26A0\uFE0F Validation failed. Try again.');
        state[letter].status = 'error';
      }
    }
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">\u26A1</span> Validate All Words';
  updateExportButton();
}

// ---- Export ----

function updateExportButton() {
  const hasAnyContent = Object.values(state).some(s => s.word || s.photo);
  document.getElementById('exportBtn').disabled = !hasAnyContent;
}

function showExport() {
  const caseChoice = document.querySelector('input[name="casePreference"]:checked')?.value || 'mix';
  const caseLabel = { lower: 'Lower Case Only', upper: 'Upper Case Only', mix: 'Mix (Aa)' }[caseChoice];

  let text = `LIFE LETTERS - Custom Pack Summary\n`;
  text += `${'='.repeat(42)}\n\n`;
  text += `Letter Style: ${caseLabel}\n\n`;
  text += `${'─'.repeat(42)}\n`;

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  let validCount = 0;
  let filledCount = 0;
  let photoCount = 0;

  for (const letter of letters) {
    const s = state[letter];
    const word = s.word || document.getElementById(`input-${letter}`).value.trim();
    const hasPhoto = !!s.photo;
    if (hasPhoto) photoCount++;

    if (word) {
      filledCount++;
      const wordStatus = s.status === 'valid' ? '\u2705' : s.status === 'invalid' ? '\u274C' : '\u2753';
      if (s.status === 'valid') validCount++;
      const photoTag = hasPhoto ? ' \uD83D\uDCF7' : '';
      text += `${letter}: ${word} ${wordStatus}${photoTag}\n`;
    } else {
      const photoTag = hasPhoto ? ' \uD83D\uDCF7' : '';
      text += `${letter}: (using default)${photoTag}\n`;
    }
  }

  text += `${'─'.repeat(42)}\n\n`;
  text += `${validCount}/${filledCount} words validated successfully\n`;
  text += `${photoCount}/26 photos uploaded\n`;
  text += `${26 - filledCount} letters using default words\n`;
  text += `${26 - photoCount} letters using default photos\n`;

  document.getElementById('exportText').value = text;
  document.getElementById('exportModal').classList.add('show');
}

function copyExport() {
  const textarea = document.getElementById('exportText');
  textarea.select();
  navigator.clipboard.writeText(textarea.value).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.innerHTML = '<span class="btn-icon">\u2705</span> Copied!';
    setTimeout(() => {
      btn.innerHTML = '<span class="btn-icon">\uD83D\uDCCB</span> Copy to Clipboard';
    }, 2000);
  });
}

// ---- Init ----

document.addEventListener('DOMContentLoaded', () => {
  buildGrid();

  document.getElementById('validateAllBtn').addEventListener('click', validateAll);
  document.getElementById('exportBtn').addEventListener('click', showExport);
  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('exportModal').classList.remove('show');
  });
  document.getElementById('copyBtn').addEventListener('click', copyExport);
  document.getElementById('exportModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('exportModal')) {
      document.getElementById('exportModal').classList.remove('show');
    }
  });
});

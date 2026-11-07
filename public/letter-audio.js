// One shared player keeps repeated taps and different letters from overlapping.
export function createLetterSoundPlayer(audio, onStateChange = () => {}) {
  let currentLetter = null;
  let requestId = 0;

  function finish(status = "idle") {
    requestId += 1;
    const letter = currentLetter;
    currentLetter = null;
    if (letter) onStateChange(letter, status);
  }

  function stop() {
    audio.pause();
    if (audio.currentTime > 0) audio.currentTime = 0;
    finish();
  }

  async function play(letter) {
    const key = String(letter).toUpperCase() === "QU" ? "Q" : String(letter).toUpperCase();
    if (!/^[A-Z]$/.test(key)) return;

    stop();
    const id = ++requestId;
    currentLetter = key;
    const file = key === "Q" ? "qu" : key.toLowerCase();
    audio.src = `/audio/phonemes/${file}.mp3`;
    onStateChange(key, "loading");

    try {
      // Called directly from the tap, which permits playback on mobile Safari.
      await audio.play();
      if (id === requestId) onStateChange(key, "playing");
    } catch {
      // Switching letters can reject the previous play promise with AbortError.
      if (id === requestId) finish("error");
    }
  }

  audio.addEventListener("ended", () => finish());
  audio.addEventListener("error", () => {
    if (audio.error) finish("error");
  });

  return { play, stop };
}

if (typeof document !== "undefined") {
  const audio = document.getElementById("letterSoundAudio");
  const player = createLetterSoundPlayer(audio, (letter, status) => {
    const button = document.getElementById(`sound-btn-${letter}`);
    const feedback = document.getElementById(`sound-status-${letter}`);
    if (!button || !feedback) return;

    button.classList.toggle("is-playing", status === "playing");
    button.setAttribute("aria-busy", String(status === "loading"));
    feedback.textContent = {
      idle: "", loading: "Loading sound…", playing: "Playing sound…",
      error: "Couldn't play the sound. Please try again.",
    }[status];
  });

  document.addEventListener("click", event => {
    const button = event.target.closest(".letter-sound-btn");
    if (button) {
      event.preventDefault();
      void player.play(button.dataset.letter);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) player.stop();
  });
  window.addEventListener("pagehide", () => player.stop());
}

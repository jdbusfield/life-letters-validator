import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createLetterSoundPlayer } from "../public/letter-audio.js";

function fixture() {
  const events = {};
  const states = [];
  const pending = [];
  const audio = {
    currentTime: 0, error: null, pauses: 0,
    addEventListener(name, callback) { events[name] = callback; },
    pause() { this.pauses++; },
    play() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
  };
  return { audio, events, states, pending, player: createLetterSoundPlayer(audio, (...state) => states.push(state)) };
}

test("all 26 letter buttons map to bundled single-pronunciation clips, including qu", async () => {
  const { audio, player, pending } = fixture();
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const playing = player.play(letter);
    const file = letter === "Q" ? "qu" : letter.toLowerCase();
    assert.equal(audio.src, `/audio/phonemes/${file}.wav`);
    const bytes = await readFile(new URL(`../public/audio/phonemes/${file}.wav`, import.meta.url));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert(bytes.length > 1000, `${letter} clip is missing or empty`);
    pending.at(-1).resolve();
    await playing;
  }
});

test("switching letters ignores the previous aborted request", async () => {
  const { player, audio, pending, states } = fixture();
  const first = player.play("G");
  const second = player.play("X");
  assert.equal(audio.src, "/audio/phonemes/x.wav");
  pending[0].reject(new Error("AbortError"));
  pending[1].resolve();
  await Promise.all([first, second]);
  assert.deepEqual(states.at(-1), ["X", "playing"]);
  assert(!states.some(([letter, status]) => letter === "G" && status === "error"));
  assert.equal(audio.pauses, 2);
});

test("replaying the same letter restarts it, and ending clears playing state", async () => {
  const { player, audio, pending, states, events } = fixture();
  const first = player.play("G"); pending[0].resolve(); await first;
  audio.currentTime = 0.5;
  const second = player.play("G");
  assert.equal(audio.currentTime, 0);
  pending[1].resolve(); await second;
  events.ended();
  assert.deepEqual(states.at(-1), ["G", "idle"]);
});

test("failed playback offers a clean retry and stop cancels pending playback", async () => {
  const { player, pending, states } = fixture();
  const failed = player.play("Q"); pending[0].reject(new Error("NotAllowedError")); await failed;
  assert.deepEqual(states.at(-1), ["Q", "error"]);
  const retried = player.play("qu"); pending[1].resolve(); await retried;
  assert.deepEqual(states.at(-1), ["Q", "playing"]);
  const stopped = player.play("A"); player.stop(); pending[2].resolve(); await stopped;
  assert.deepEqual(states.at(-1), ["A", "idle"]);
});

test("decoding errors reset the active button", async () => {
  const { player, audio, pending, events, states } = fixture();
  const playing = player.play("E"); pending[0].resolve(); await playing;
  audio.error = { code: 3 }; events.error();
  assert.deepEqual(states.at(-1), ["E", "error"]);
});

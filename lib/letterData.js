// Phonetic data for each letter - primary sound, example, and known tricky cases
export const LETTER_DATA = {
  A: {
    sound: "/a/ (short a as in apple)",
    example: "apple",
    avoid:
      "words where A is followed by R (like 'art', 'arm') because it changes the vowel sound",
  },
  B: { sound: "/b/ (as in ball)", example: "ball", avoid: "" },
  C: {
    sound: "/k/ (hard C as in cat)",
    example: "cat",
    avoid:
      "soft C words like 'city', 'circle', 'celery' (those start with an /s/ sound)",
  },
  D: { sound: "/d/ (as in dog)", example: "dog", avoid: "" },
  E: {
    sound: "/e/ (short e as in elephant)",
    example: "elephant",
    avoid:
      "words where E is followed by R (like 'earth', 'ear') because it changes the vowel sound",
  },
  F: { sound: "/f/ (as in fish)", example: "fish", avoid: "" },
  G: {
    sound: "/g/ (hard G as in go)",
    example: "goat",
    avoid:
      "soft G words like 'giraffe', 'gem', 'giant', 'George' (those start with a /j/ sound)",
  },
  H: {
    sound: "/h/ (as in hat)",
    example: "hat",
    avoid: "silent H words like 'hour', 'honest', 'heir'",
  },
  I: {
    sound: "/i/ (short i as in igloo)",
    example: "igloo",
    avoid:
      "words where I is followed by R (like 'iron', 'ire') because it changes the vowel sound. Also avoid long-I words like 'ice' or 'island' for young learners",
  },
  J: { sound: "/j/ (as in jump)", example: "jump", avoid: "" },
  K: {
    sound: "/k/ (as in kite)",
    example: "kite",
    avoid: "silent K words like 'knife', 'knee', 'knight', 'know'",
  },
  L: { sound: "/l/ (as in lion)", example: "lion", avoid: "" },
  M: { sound: "/m/ (as in moon)", example: "moon", avoid: "" },
  N: { sound: "/n/ (as in nest)", example: "nest", avoid: "" },
  O: {
    sound: "/o/ (short o as in octopus)",
    example: "octopus",
    avoid:
      "words where O is followed by R (like 'orange', 'orbit') because it changes the vowel sound. Also avoid words starting with 'one' or 'once' (start with /w/ sound)",
  },
  P: {
    sound: "/p/ (as in pig)",
    example: "pig",
    avoid:
      "'ph' words like 'phone', 'photo' (those start with /f/ sound), and silent P words like 'psalm', 'pneumonia', 'pterodactyl'",
  },
  Q: {
    sound: "/kw/ (as in queen)",
    example: "queen",
    avoid: "",
  },
  R: { sound: "/r/ (as in rain)", example: "rain", avoid: "" },
  S: {
    sound: "/s/ (as in sun)",
    example: "sun",
    avoid:
      "'sh' words like 'shoe', 'ship' (those start with /sh/ sound) and words where S sounds like /z/ like 'sure'",
  },
  T: {
    sound: "/t/ (as in tiger)",
    example: "tiger",
    avoid: "'th' words like 'the', 'think' (those start with /th/ sound)",
  },
  U: {
    sound: "/u/ (short u as in umbrella)",
    example: "umbrella",
    avoid:
      "words where U is followed by R (like 'urchin') because it changes the vowel sound. Also avoid words starting with 'uni-' (start with /y/ sound)",
  },
  V: { sound: "/v/ (as in van)", example: "van", avoid: "" },
  W: {
    sound: "/w/ (as in water)",
    example: "water",
    avoid: "silent W words like 'write', 'wrong', 'wreck', 'wrist'",
  },
  X: {
    sound: "/ks/ (as in box) — note: very few English words start with the /ks/ sound",
    example: "x-ray or fox",
    avoid:
      "words like 'xylophone' (starts with /z/ sound). For X, the word just needs to prominently feature the X sound or start with X",
  },
  Y: { sound: "/y/ (as in yellow)", example: "yellow", avoid: "" },
  Z: { sound: "/z/ (as in zebra)", example: "zebra", avoid: "" },
};

// Default card words for each letter (used when customer picks "Use Default")
export const DEFAULT_CARDS = {
  A: "apple",
  B: "bike",
  C: "cat",
  D: "dog",
  E: "elephant",
  F: "fish",
  G: "gorilla",
  H: "horse",
  I: "itch",
  J: "jump",
  K: "kite",
  L: "lemon",
  M: "monkey",
  N: "nest",
  O: "octopus",
  P: "pig",
  Q: "queen",
  R: "rabbit",
  S: "sun",
  T: "tomato",
  U: "umbrella",
  V: "van",
  W: "watch",
  X: "box",
  Y: "yoga",
  Z: "zebra",
};

// Common word suggestions per letter from the PRD
export const WORD_SUGGESTIONS = {
  A: ["apple", "alligator", "astronaut", "Allison", "Abbey", "Addy", "Alex"],
  B: ["bike", "brother", "baby", "ball", "Bluey", "bed", "book", "bear", "bake", "blue"],
  C: ["cat", "car", "cake", "cow", "clap", "cut", "color", "cook", "candy", "coin", "corn"],
  D: ["dog", "donut", "duck", "deer", "dolphin", "daisy", "door", "doll", "dance", "dig"],
  E: ["elephant", "egg", "engine", "energy", "exit", "elevator", "Elle", "Emma"],
  F: ["fish", "friend", "fox", "flower", "frog", "feather", "fork", "fun", "fan", "flag"],
  G: ["gorilla", "goat", "goose", "garden", "Grandpa", "gift", "guitar", "green", "Grandma", "gum"],
  H: ["horse", "head", "hockey", "hippo", "hen", "honey", "hamburger", "hotdog", "hug", "happy", "hammer"],
  I: ["itch", "inchworm", "igloo", "insect", "Italy", "imagine", "invisible", "incredible"],
  J: ["jump", "jaguar", "jellyfish", "jam", "jar", "juice", "jumprope", "juggle", "job", "joy"],
  K: ["kite", "kangaroo", "kiss", "key", "kiwi", "ketchup", "kick", "kitchen", "kid", "karate"],
  L: ["lemon", "lamp", "leg", "lip", "love", "look", "library", "lake", "lighthouse"],
  M: ["monkey", "mom", "money", "map", "mall", "market", "museum", "mountain"],
  N: ["nest", "nose", "nap", "neck", "nut", "nine", "new", "night", "Nana"],
  O: ["octopus", "ox", "on", "off", "olive", "Oliver", "office"],
  P: ["pig", "popsicle", "party", "popcorn", "pizza", "playground", "park", "pond", "palace", "pool"],
  Q: ["queen", "quilt", "quiet", "quit", "quick", "quack", "Quinn"],
  R: ["rabbit", "racecar", "ride", "rat", "run", "rain", "river", "road", "ranch", "rash"],
  S: ["sun", "sing", "sister", "school", "sock", "swing", "store", "sea", "sick", "sand"],
  T: ["tomato", "table", "toe", "towel", "toy", "tub", "tunnel", "tool", "toast", "tongue"],
  U: ["umbrella", "up", "under", "uncle", "upset"],
  V: ["van", "vase", "vest", "volcano", "vegetable", "vacuum", "violin", "vacation"],
  W: ["watch", "wallaby", "win", "wing", "wag", "wall", "wood", "water", "wish", "walk", "wave"],
  X: ["box", "fox", "mix", "six", "fix", "x-box"],
  Y: ["yoga", "yellow", "yo-yo", "yam", "yard", "yogurt", "yawn", "yarn", "yell", "yummy"],
  Z: ["zebra", "zoo", "zipper", "zero", "zucchini", "zoom", "zap"],
};

// Letters where we warn "avoid words with an R right after the initial letter".
// This only matters for vowels — an R right after a vowel creates an
// R-controlled vowel that changes the sound (art, earth, orange). For
// consonants the R is just a blend (brother, crab) and the initial sound is
// unchanged, so the note should not appear.
export const R_WARNING_LETTERS = new Set(["A", "E", "I", "O", "U"]);

// Frontend-friendly hint strings
export const LETTER_HINTS = {
  A: "/a/ like in apple",
  B: "/b/ like in ball",
  C: "/k/ like in cat (hard C)",
  D: "/d/ like in dog",
  E: "/e/ like in elephant",
  F: "/f/ like in fish",
  G: "/g/ like in goat (hard G)",
  H: "/h/ like in hat",
  I: "/i/ like in igloo",
  J: "/j/ like in jump",
  K: "/k/ like in kite",
  L: "/l/ like in lion",
  M: "/m/ like in moon",
  N: "/n/ like in nest",
  O: "/o/ like in octopus",
  P: "/p/ like in pig",
  Q: "/kw/ like in queen",
  R: "/r/ like in rain",
  S: "/s/ like in sun",
  T: "/t/ like in tiger",
  U: "/u/ like in umbrella",
  V: "/v/ like in van",
  W: "/w/ like in water",
  X: "/ks/ like in x-ray",
  Y: "/y/ like in yellow",
  Z: "/z/ like in zebra",
};

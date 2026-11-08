// Shared phonics reference for suggestions, parent tips, and validation.
export const WORD_SUGGESTIONS = {
  A: ["apple", "astronaut", "alligator", "attic", "abacus", "act", "add", "Africa", "axe"],
  B: ["baby", "brother", "ball", "banana", "bear", "bed", "bee", "bike", "bird", "book"],
  C: ["cat", "car", "cup", "cake", "cow", "cookie", "candy", "carrot", "coat", "crayon"],
  D: ["dad", "daddy", "dog", "duck", "doll", "door", "dinosaur", "donut", "drum", "dress"],
  E: ["egg", "elephant", "elbow", "elf", "elevator", "exit", "exercise", "empty", "envelope", "engine"],
  F: ["father", "family", "fish", "frog", "food", "foot", "flower", "fire", "fork", "farm"],
  G: ["grandma", "grandpa", "girl", "goat", "grapes", "gift", "game", "gorilla", "garden", "gum"],
  H: ["head", "house", "hat", "horse", "hand", "heart", "hair", "hen", "hammer", "hippo"],
  I: ["igloo", "insect", "itch", "in", "inside", "inch", "instrument", "invitation"],
  J: ["jacket", "jam", "jar", "juice", "jelly", "jump", "jeep", "jet", "jeans", "jellyfish"],
  K: ["kid", "kiss", "kite", "key", "king", "kangaroo", "kitten", "kitchen", "kick", "koala"],
  L: ["love", "lion", "leg", "lamp", "leaf", "lemon", "ladybug", "lollipop", "lunch", "ladder"],
  M: ["mom", "mommy", "mother", "milk", "moon", "mouse", "monkey", "mouth", "muffin", "mittens"],
  N: ["nose", "nest", "net", "nail", "nap", "night", "nut", "necklace", "noodle", "nurse"],
  O: ["octopus", "ox", "otter", "ostrich", "olive", "on", "off", "office"],
  P: ["papa", "puppy", "pig", "pizza", "pencil", "pumpkin", "penguin", "popcorn", "park", "pear"],
  Q: ["queen", "quilt", "quack", "quiet", "question", "quail", "quick", "quill"],
  R: ["rabbit", "rain", "red", "ring", "robot", "rock", "rainbow", "rice", "rocket", "rug"],
  S: ["sister", "sun", "sock", "snake", "star", "sandwich", "swing", "soap", "spoon", "snow"],
  T: ["teddy", "toy", "tiger", "turtle", "tree", "train", "truck", "table", "tooth", "tomato"],
  U: ["up", "under", "umbrella", "uncle", "upset", "us", "ugly", "umpire", "underwear", "upstairs"],
  V: ["van", "vet", "vest", "violin", "volcano", "vase", "vegetable", "vacuum", "valentine", "village"],
  W: ["water", "window", "wagon", "whale", "worm", "watch", "wheel", "watermelon", "wall", "wolf"],
  X: ["fox", "box", "mix", "six", "fix", "x-box"],
  Y: ["yellow", "yes", "yo-yo", "yogurt", "yarn", "yard", "yawn", "yak", "yell", "yummy"],
  Z: ["zebra", "zoo", "zipper", "zigzag", "zero", "zoom", "zucchini", "zip", "zookeeper"],
};

export const DEFAULT_CARDS = {
  A: "apple", B: "bike", C: "cat", D: "dog", E: "egg", F: "fish",
  G: "gorilla", H: "horse", I: "itch", J: "jump", K: "kite", L: "lemon",
  M: "monkey", N: "nest", O: "octopus", P: "pig", Q: "queen", R: "rabbit",
  S: "sun", T: "tomato", U: "umbrella", V: "van", W: "watch", X: "fox",
  Y: "yellow", Z: "zebra",
};

export const LETTER_HINTS = {
  A: "/a/ like in apple", B: "/b/ like in ball", C: "/k/ like in cat (hard c)",
  D: "/d/ like in dog", E: "/e/ like in egg", F: "/f/ like in fish",
  G: "/g/ like in goat (hard g)", H: "/h/ like in hat", I: "/i/ like in igloo",
  J: "/j/ like in jump", K: "/k/ like in kite", L: "/l/ like in lion",
  M: "/m/ like in moon", N: "/n/ like in nest", O: "/o/ like in octopus",
  P: "/p/ like in pig", Q: "/kw/ like in queen", R: "/r/ like in rain",
  S: "/s/ like in sun", T: "/t/ like in tiger", U: "/u/ like in umbrella",
  V: "/v/ like in van", W: "/w/ like in water", X: "/ks/ like at the end of fox",
  Y: "/y/ like in yellow", Z: "/z/ like in zebra",
};

const vowelEncouragement = "Vowels can be tricky!";
export const LETTER_TIPS = {
  A: `${vowelEncouragement} Listen for the short /a/ in apple. Avoid long-a words like acorn and r-controlled words like arm. Before m or n, a can sound different.`,
  C: "Listen for /k/ as in cat. Before e, i, or y, c usually sounds like /s/ (city, celery, cycle). Avoid ch words like chair, too.",
  E: `${vowelEncouragement} Listen for the short /e/ in egg. Avoid long-e words like eagle and r-controlled words like earth.`,
  G: "Listen for /g/ as in goat. Before e, i, or y, g often sounds like /j/ (gem, giraffe, gym). Gift and girl still have the hard /g/ sound - listen to the word!",
  I: `${vowelEncouragement} Listen for the short /i/ in itch. Avoid long-i words like ice and r-controlled words like irk.`,
  O: `${vowelEncouragement} Listen for the short /o/ in octopus. Avoid long-o words like oval, r-controlled words like orbit, and one (which starts with /w/).`,
  Q: "Qu can be tricky! Listen for /kw/ as in queen. A suggested word or the default queen photo is a great choice.",
  U: `${vowelEncouragement} Listen for the short /u/ in umbrella. Avoid unicorn (which starts with /y/) and r-controlled words like urn.`,
  X: "Think of words that end in /ks/, like fox, box, or six. Words that start with x rarely make this sound. Avoid xylophone (/z/) and x-ray (the letter name).",
};

const AVOID = {
  A: "Use short a as in apple; avoid long a (acorn), schwa (about, address), and r-controlled a (arm, art). Do not reject words solely because a is followed by m or n; judge the sound.",
  C: "Use hard /k/, not soft /s/ (city, celery, circle, cycle) or /ch/ (chair).",
  E: "Use short e as in egg; avoid long e (eagle) and r-controlled vowels (earth, ear).",
  G: "Use hard /g/ (goat, gift, girl), not soft /j/ (giraffe, gem, giant, George, gym). Check sound, not a blanket e/i/y spelling rule.",
  H: "Avoid silent h words like hour, honest, heir.",
  I: "Use short i as in itch; avoid long i (ice, island) and r-controlled vowels (iron, irk).",
  K: "Avoid silent k words like knife, knee, knight, know.",
  O: "Use short o as in octopus; avoid long o (oval), r-controlled vowels (orbit), and /w/ words (one, once). Allow ordinary regional short-o pronunciation differences.",
  P: "Avoid /f/ words like phone and photo, and silent p words like psalm or pterodactyl.",
  Q: "Use the /kw/ sound of qu as in queen, not /k/ alone as in quay.",
  S: "Use /s/, not /sh/ (shoe, shoes, ship, sure, sugar) or a /z/ starting sound.",
  T: "Avoid th words like the and think.",
  U: "Use short u as in umbrella, not /y/ (unicorn, uniform), long u (ukulele), or r-controlled vowels (urn, urchin).",
  W: "Avoid silent w words like write, wrong, wreck, wrist.",
  X: "The word must END in the /ks/ sound as in fox, box, mix, six, fix, or x-box. Reject xylophone (/z/), x-ray (letter name), and words merely containing a written x without final /ks/.",
};

export const LETTER_DATA = Object.fromEntries(
  Object.keys(DEFAULT_CARDS).map(letter => [letter, {
    sound: LETTER_HINTS[letter],
    example: DEFAULT_CARDS[letter],
    avoid: AVOID[letter] || "",
  }])
);

// Retained for older clients; new clients use the fuller LETTER_TIPS guidance.
export const R_WARNING_LETTERS = new Set(["A", "E", "I", "O", "U"]);

// Bump when phonics rules change so saved custom words are checked again.
export const PHONICS_VERSION = 2;

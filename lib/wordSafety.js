// Whole-word matching avoids blocking innocent words such as class and butterfly.
// The phonics model also reviews meaning/context for unlisted adult expressions.
const terms = [
  'fuck','fucks','fucked','fucking','fucker','fuckers','motherfucker','motherfuckers',
  'shit','shits','shitty','bullshit','bitch','bitches','bastard','bastards','ass','asses','asshole','assholes',
  'damn','goddamn','crap','piss','pissed','dick','dicks','cock','cocks','cunt','cunts','twat','prick',
  'slut','sluts','whore','whores','porn','porno','pornography','pornographic','xxx',
  'sex','sexy','sexual','sexuality','sexualized','sexualised','sexting','erotic','erotica',
  'nude','nudes','nudity','naked','nakedness','stripper','stripclub','lingerie',
  'penis','penises','vagina','vaginas','vulva','testicle','testicles','scrotum','genitals',
  'boob','boobs','tits','titties','nipple','nipples','butthole','anus','anal',
  'orgasm','orgasms','masturbate','masturbation','ejaculate','ejaculation','semen','sperm',
  'dildo','dildos','vibrator','blowjob','handjob','fellatio','cunnilingus','intercourse',
  'hentai','fetish','bdsm','onlyfans','rape','rapist','incest','pedophile','paedophile',
  'nigger','nigga','faggot','fag','retard',
];
function normalize(value) {
  return String(value ?? '').normalize('NFKC').normalize('NFD').replace(/\p{M}/gu,'')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,'').toLowerCase();
}
const patterns=terms.map(term=>new RegExp(`(?:^|[^a-z])${[...term].join('[^a-z0-9]*')}(?:$|[^a-z])`,'i'));
export function isInappropriateWord(value) {
  const text=normalize(value);
  const decoded=text.replace(/[013457@$!]/g, c=>({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s','!':'i'}[c]));
  return patterns.some(pattern=>pattern.test(text)||pattern.test(decoded));
}
export function wordSafetyVerdict(word) {
  return isInappropriateWord(word) ? {valid:false,emoji:'❌',message:'Please choose a different word suitable for a young child’s alphabet cards.',suggestion:'Try a family-friendly person, pet, place, object, or activity.'} : null;
}

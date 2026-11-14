export type Lang = 'hi' | 'en'

export const STRINGS = {
  enter: { hi: 'Padharo!', en: 'Come in' },
  tagline: { hi: 'Jaipur ki gali, aapke phone mein', en: "Jaipur's lanes, on your phone" },
  stampGot: { hi: 'Jaipur Darshan · stamp mila: {place}', en: 'Stamp collected: {place}' },
  stampButton: { hi: 'Stamp lo', en: 'Collect stamp' },
  stampHave: { hi: 'Stamp mil chuka hai', en: 'Stamp already collected' },
  stampCount: { hi: 'Jaipur Darshan stamps', en: 'Jaipur Darshan stamps' },
  loading: { hi: 'Ruko zara, gali khul rahi hai…', en: 'One moment, the lane is opening…' },
  noWebgl: {
    hi: 'Is phone/browser pe 3D nahi chal raha. Chrome mein kholo — wahan chalega.',
    en: "3D doesn't run on this phone/browser. Open in Chrome and it should work.",
  },
  loadFailed: {
    hi: 'Gali nahi khul payi. Page reload karo.',
    en: "Couldn't open the lane. Reload the page.",
  },
  crashed: {
    hi: 'Kuch gadbad ho gayi. Page reload karo.',
    en: 'Something went wrong. Reload the page.',
  },
  reload: { hi: 'Reload karo', en: 'Reload' },
  weatherUnknown: { hi: '—', en: '—' },
  langToggle: { hi: 'English', en: 'हिन्दी' },
  langToggleLabel: { hi: 'Bhasha badlo: English', en: 'Switch language: Hinglish' },
  festivalSankranti: {
    hi: 'Makar Sankranti mubarak! Aasmaan dekho 🪁',
    en: 'Happy Makar Sankranti! Look up 🪁',
  },
  festivalHoli: { hi: 'Holi mubarak! Rang barse 🎨', en: 'Happy Holi! Colours in the air 🎨' },
  festivalGangaur: { hi: 'Gangaur ki shubhkamnayein! 🌸', en: 'Happy Gangaur! 🌸' },
  festivalTeej: { hi: 'Teej ki shubhkamnayein! 🌿', en: 'Happy Teej! 🌿' },
  festivalDiwali: { hi: 'Diwali mubarak! Diye jagmagaye 🪔', en: 'Happy Diwali! The diyas are lit 🪔' },
  festivalJlf: { hi: 'Jaipur Literature Festival ki dhoom! 📚', en: 'Jaipur Literature Festival is on! 📚' },
  npcNotReal: {
    hi: 'Ye ek kirdaar hai, asli insaan nahi — asli log jald aa rahe hain.',
    en: 'This is a character, not a real person. Real people are coming soon.',
  },
  npcClose: { hi: 'Band karo', en: 'Close' },
  npcBadge: { hi: 'Kirdaar', en: 'Character' },
  joystickLabel: { hi: 'Chalne ka joystick', en: 'Walking joystick' },
  metro: { hi: 'Metro', en: 'Metro' },
  metroTitle: { hi: 'Kahan chalein?', en: 'Where to?' },
  metroClose: { hi: 'Band karo', en: 'Close' },
  metroFailed: {
    hi: '{place} tak nahi pahunch paaye. Dobara try karo.',
    en: "Couldn't get to {place}. Try again.",
  },
  signInButton: { hi: 'Dikhna hai? Login karo', en: 'Want to be seen? Sign in' },
  signInTitle: { hi: 'Gali mein apni jagah banao', en: 'Take your place in the lane' },
  signInName: { hi: 'Aapka naam', en: 'Your name' },
  signInGo: { hi: 'Andar aao', en: 'Come in' },
  signInFailed: { hi: 'Login nahi ho paya. Dobara try karo.', en: "Couldn't sign in. Try again." },
  signInClose: { hi: 'Baad mein', en: 'Not now' },
  inAppHint: {
    hi: 'Google se login ke liye Chrome mein kholo',
    en: 'To sign in with Google, open this in Chrome',
  },
  inAppHintDismiss: { hi: 'Ye line hatao', en: 'Dismiss this tip' },
  profileTitle: { hi: 'Apni pehchaan banao', en: 'Make your profile' },
  profileOpen: { hi: 'Profile', en: 'Profile' },
  profileName: { hi: 'Naam', en: 'Name' },
  profileLook: { hi: 'Avatar', en: 'Avatar' },
  profileSkin: { hi: 'Rang', en: 'Skin' },
  profileOutfit: { hi: 'Kapde', en: 'Outfit' },
  profileHead: { hi: 'Sar pe', en: 'Head' },
  headNone: { hi: 'Kuch nahi', en: 'None' },
  headSafa: { hi: 'Safa', en: 'Safa' },
  headCap: { hi: 'Topi', en: 'Cap' },
  headDupatta: { hi: 'Dupatta', en: 'Dupatta' },
  headBun: { hi: 'Joorha', en: 'Bun' },
  profileArea: { hi: 'Kaun si jagah se ho?', en: 'Where in Jaipur are you from?' },
  profileAreaPick: { hi: 'Chuno…', en: 'Pick one…' },
  profileStatus: { hi: 'Status', en: 'Status' },
  profileStatusHint: { hi: 'Kis baare mein baat karni hai?', en: 'What do you want to talk about?' },
  profileHereFor: { hi: 'Yahan kis liye? (zaroori nahi)', en: 'Here for? (optional)' },
  hereForFriends: { hi: 'Dost', en: 'Friends' },
  hereForStudy: { hi: 'Padhai', en: 'Study' },
  hereForWork: { hi: 'Kaam', en: 'Work' },
  hereForArt: { hi: 'Kala', en: 'Art' },
  profileAbout: { hi: 'Apne baare mein', en: 'About you' },
  profileAdult: { hi: 'Main 18 saal ya usse bada/badi hoon', en: 'I am 18 or older' },
  profilePledge: {
    hi: 'Sab ki izzat karunga/karungi. Koi harassment, hate ya spam nahi.',
    en: "I'll treat everyone with respect. No harassment, hate or spam.",
  },
  profileSave: { hi: 'Save karo', en: 'Save' },
  profileSaving: { hi: 'Save ho raha hai…', en: 'Saving…' },
  profileNotNow: { hi: 'Baad mein', en: 'Not now' },
  profileSaveFailed: { hi: 'Save nahi ho paya. Dobara try karo.', en: "Couldn't save. Try again." },
  profileFieldsFailed: { hi: 'Laal wale khaane theek karo.', en: 'Fix the highlighted fields.' },
  profileSignOut: { hi: 'Logout karo', en: 'Sign out' },
  visibilityGhost: { hi: 'Abhi koi tumhe dekh nahi sakta', en: 'Nobody can see you yet' },
  visibilityResident: { hi: 'Jaipur tumhe dekh sakta hai', en: 'Jaipur can see you' },
  visibilityFinish: { hi: 'Profile poora karo', en: 'Finish your profile' },
  liveReplaced: {
    hi: 'Tum ek aur tab mein bhi khule ho. Log tumhe ab wahin dekhenge, yahan se nahi.',
    en: "You're open in another tab too. People see you there now, not here.",
  },
} as const satisfies Record<string, Record<Lang, string>>

export type StringKey = keyof typeof STRINGS

export function t(key: StringKey, lang: Lang, vars?: Record<string, string | number>): string {
  const template: string = STRINGS[key][lang]
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

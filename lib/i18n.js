// Interface texts (English). Works in the page and in the worker (no DOM here).
// Static texts in index.html name their key with data-i18n (plain text) or data-i18n-html (text with markup).

export const LANGUAGES = [
  { code: 'en', name: 'English', flag: 'uk' },
];

const SPHAIRA = '<a href="https://github.com/NaGaa95/sphaira/releases" target="_blank" rel="noopener">Sphaira</a>';
const GAME_PACKAGE = '<code>C3474230481B764B60F5BA68D5280641D9EDA1D858</code>';
const GAME_PATH = '<code>Content/0000000000000000/584111E9/000D0000</code>';

const TEXTS = {
  en: {
    legal:
      'Zuma’s Revenge is a trademark of PopCap Games / Electronic Arts; the icon artwork is © PopCap Games. zumasrevenge-nx is an unofficial fan project and is not affiliated with, endorsed or sponsored by PopCap Games, Electronic Arts, Nintendo or Microsoft. Nintendo Switch is a trademark of Nintendo; Xbox 360 and Xbox Live Arcade are trademarks of Microsoft. This site does not host or distribute game data or the original game executable: your game is read only inside your browser, is never uploaded, and what is made from it is written straight into the zumasrevenge-nx.zip saved on your computer. You need your own legally obtained copy of the game.',
    sourceCode: 'Source code',
    signature: 'a ChanseyIsTheBest project',
    lead:
      'Builds the <strong>Nintendo Switch</strong> package of <strong>Zuma’s Revenge</strong> (Xbox Live Arcade) from your ' +
      'own copy of the game. Everything runs in <strong>this browser</strong>.',
    languageBar: 'Language',
    step1: '1. Choose your game files',
    addFiles: 'Add files',
    addFolder: 'Add a folder',
    clear: 'Clear',
    ownCopy:
      '<strong>Important:</strong> you need your own copy of the game, dumped from your own console. The installer reads it to make the package; it supplies no game files of its own. Only the Xbox Live Arcade game (title 584111E9) is supported.',
    formatHint:
      '<strong>The game:</strong> its content package ' + GAME_PACKAGE + ' (on the console in ' + GAME_PATH + '), or a folder it was extracted into (with <code>default.xex</code> and <code>main.rsb</code>). ' +
      'You can add it as a file, or choose a folder that holds it.',
    nothingChosen: 'Nothing chosen yet.',
    chosenGame: 'Game: {name}',
    chosenNoGame: 'Game: not found yet',
    step2: '2. Create the package',
    step2First: 'If you are installing the game for the first time, use:',
    create: 'Create zumasrevenge-nx.zip',
    step2Update:
      'If the game is already installed and you only want to update it (<code>zumasrevenge.nro</code>; your game is still checked to choose the build), use:',
    createUpdate: 'Create zumasrevenge-nx-update.zip',
    step3: '3. Copy it to the Switch',
    step3Extract: 'Extract the downloaded zip into <code>sdmc:/switch/</code>.',
    step3Start:
      'Start <code>zumasrevenge.nro</code> from the Homebrew Menu in title takeover mode (<strong>launch</strong> a game installed on the Switch ' +
      `<strong>while holding R</strong>) or create a <strong>39-bit forwarder</strong> with ${SPHAIRA}. The album applet does not give the game enough memory.`,
    step3First:
      'The game writes its settings file, <code>zumasrevenge.toml</code>, at its first start (language and controls; by default the language follows the console\'s). The first time you play, the game\'s shaders are compiled for the console, so the start can stutter a little.',
    checking: 'Checking your game…',
    supported: 'Zuma’s Revenge · supported',
    unsupported: 'This version of the game is not supported.',
    notGame: 'Not the game',
    noGame: 'The game was not found: choose its content package, or a folder with default.xex and main.rsb.',
    otherTitle: '{name} is not Zuma’s Revenge.',
    gameDifferent: "the game's files are not the tested ones (modified or damaged?); nothing was written",
    noStreaming: 'this browser window cannot stream downloads. Use a normal (not private) window.',
    downloadStarted: 'Download started ({size}). Keep this page open until it finishes.',
    finished: 'Finished in {seconds} s.',
    error: 'Error: {message}',
    cancelled: 'the download was cancelled',
    readingFiles: 'Reading your game',
    downloadingBuild: 'Downloading the Switch build',
    logBuild: 'Supported: Zuma’s Revenge for Xbox Live Arcade (build {version})',
    logUpdate: 'Update package: zumasrevenge.nro',
    checksumming: 'Checking the {count} game files for the game pack',
    packing: 'Writing the package',
    done: 'Done: extract the zip into sdmc:/switch/',
    notSupportedYet: 'this version of the game is not supported. Executable fingerprint: {hash}',
    buildMismatch: 'the downloaded {name} is not the published one ({hash}); try again later',
    downloadFailed: 'could not download {url} ({status})',
  },
};

let current = 'en';

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  current = TEXTS[code] ? code : 'en';
  return current;
}

// The visitor's choice (saved in their browser), else the browser's language when it is one of ours, else English.
export function preferredLanguage(saved, browser = []) {
  if (saved && TEXTS[saved]) {
    return saved;
  }
  for (const tag of browser) {
    const code = String(tag).toLowerCase().split('-')[0];
    if (TEXTS[code]) {
      return code;
    }
  }
  return 'en';
}

export function t(key, params = {}) {
  const text = TEXTS[current][key] ?? TEXTS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`));
}

// Sizes as Windows Explorer shows them, so the page and the file's properties agree: units of 1024 bytes (which
// Windows calls KB, MB and GB) and three significant digits, truncated. 7,834,892,288 bytes is 7.29 GB, not 7.83.
const SIZE_UNITS = {};

export function formatSize(bytes) {
  const units = SIZE_UNITS[current] ?? ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const scale = 10 ** decimals;
  // The small epsilon keeps values such as 7.3 from becoming 7.29 through floating point.
  const shown = Math.floor(value * scale + 1e-9) / scale;
  const number = new Intl.NumberFormat(current, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${number.format(shown)} ${units[unit]}`;
}

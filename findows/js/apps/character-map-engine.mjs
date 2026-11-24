/**
 * Character Map catalog and search — pure logic only.
 *
 * Every glyph is one Unicode scalar with a plain-text name. Nothing here reads
 * the DOM, fetches data, or produces markup: the UI renders records with
 * textContent so glyphs can never become active content. Names and ranges are
 * curated from the blocks below; no codepoint is invented just to fill a grid.
 */

export const MAX_SEARCH_RESULTS = 200;

const MAX_CODE_POINT = 0x10ffff;

function formatCode(point) {
  if (!Number.isInteger(point) || point < 0 || point > MAX_CODE_POINT ||
      (point >= 0xd800 && point <= 0xdfff)) {
    throw new RangeError(`Not a Unicode scalar value: ${String(point)}`);
  }
  return `U+${point.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Build [code, name] pairs from a name list beginning at `start`. */
function namedRange(start, names, prefix = "") {
  return names.map((name, index) => [start + index, `${prefix}${name}`.trim()]);
}

const NUMBER_WORDS = [
  "ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
  "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
  "SEVENTEEN", "EIGHTEEN", "NINETEEN", "TWENTY",
];

const A_TO_Z = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const a_to_z = "abcdefghijklmnopqrstuvwxyz".split("");

const BASIC_LATIN = [
  ...namedRange(0x21, [
    "EXCLAMATION MARK", "QUOTATION MARK", "NUMBER SIGN", "DOLLAR SIGN",
    "PERCENT SIGN", "AMPERSAND", "APOSTROPHE", "LEFT PARENTHESIS",
    "RIGHT PARENTHESIS", "ASTERISK", "PLUS SIGN", "COMMA", "HYPHEN-MINUS",
    "FULL STOP", "SOLIDUS",
  ]),
  ...namedRange(0x30, NUMBER_WORDS.slice(1, 10).map((word) => `DIGIT ${word}`)),
  ...namedRange(0x3a, [
    "COLON", "SEMICOLON", "LESS-THAN SIGN", "EQUALS SIGN",
    "GREATER-THAN SIGN", "QUESTION MARK", "COMMERCIAL AT",
  ]),
  ...namedRange(0x41, A_TO_Z.map((letter) => `LATIN CAPITAL LETTER ${letter}`)),
  ...namedRange(0x5b, [
    "LEFT SQUARE BRACKET", "REVERSE SOLIDUS", "RIGHT SQUARE BRACKET",
    "CIRCUMFLEX ACCENT", "LOW LINE", "GRAVE ACCENT",
  ]),
  ...namedRange(0x61, a_to_z.map((letter) => `LATIN SMALL LETTER ${letter}`)),
  ...namedRange(0x7b, [
    "LEFT CURLY BRACKET", "VERTICAL LINE", "RIGHT CURLY BRACKET", "TILDE",
  ]),
];

const LATIN_1 = [
  [0x00a1, "INVERTED EXCLAMATION MARK"], [0x00a2, "CENT SIGN"],
  [0x00a3, "POUND SIGN"], [0x00a4, "CURRENCY SIGN"], [0x00a5, "YEN SIGN"],
  [0x00a6, "BROKEN BAR"], [0x00a7, "SECTION SIGN"], [0x00a8, "DIAERESIS"],
  [0x00a9, "COPYRIGHT SIGN"], [0x00aa, "FEMININE ORDINAL INDICATOR"],
  [0x00ab, "LEFT-POINTING DOUBLE ANGLE QUOTATION MARK"], [0x00ac, "NOT SIGN"],
  [0x00ad, "SOFT HYPHEN"], [0x00ae, "REGISTERED SIGN"], [0x00af, "MACRON"],
  [0x00b0, "DEGREE SIGN"], [0x00b1, "PLUS-MINUS SIGN"], [0x00b2, "SUPERSCRIPT TWO"],
  [0x00b3, "SUPERSCRIPT THREE"], [0x00b4, "ACUTE ACCENT"], [0x00b5, "MICRO SIGN"],
  [0x00b6, "PILCROW SIGN"], [0x00b7, "MIDDLE DOT"], [0x00b8, "CEDILLA"],
  [0x00b9, "SUPERSCRIPT ONE"], [0x00ba, "MASCULINE ORDINAL INDICATOR"],
  [0x00bb, "RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK"],
  [0x00bc, "VULGAR FRACTION ONE QUARTER"], [0x00bd, "VULGAR FRACTION ONE HALF"],
  [0x00be, "VULGAR FRACTION THREE QUARTERS"], [0x00bf, "INVERTED QUESTION MARK"],
  [0x00c5, "LATIN CAPITAL LETTER A WITH RING ABOVE"],
  [0x00c6, "LATIN CAPITAL LETTER AE"],
  [0x00d7, "MULTIPLICATION SIGN"],
  [0x00d8, "LATIN CAPITAL LETTER O WITH STROKE"],
  [0x00df, "LATIN SMALL LETTER SHARP S"],
  [0x00e5, "LATIN SMALL LETTER A WITH RING ABOVE"],
  [0x00e6, "LATIN SMALL LETTER AE"],
  [0x00f7, "DIVISION SIGN"],
  [0x00f8, "LATIN SMALL LETTER O WITH STROKE"],
];

const GREEK = [
  ...namedRange(0x391, [
    "ALPHA", "BETA", "GAMMA", "DELTA", "EPSILON", "ZETA", "ETA", "THETA",
    "IOTA", "KAPPA", "LAMDA", "MU", "NU", "XI", "OMICRON", "PI", "RHO",
    "SIGMA", "TAU", "UPSILON", "PHI", "CHI", "PSI", "OMEGA",
  ], "GREEK CAPITAL LETTER "),
  ...namedRange(0x3b1, [
    "ALPHA", "BETA", "GAMMA", "DELTA", "EPSILON", "ZETA", "ETA", "THETA",
    "IOTA", "KAPPA", "LAMBDA", "MU", "NU", "XI", "OMICRON", "PI", "RHO",
    "SIGMA", "TAU", "UPSILON", "PHI", "CHI", "PSI", "OMEGA",
  ], "GREEK SMALL LETTER "),
  [0x384, "GREEK TONOS"], [0x387, "GREEK ANO TELEIA"],
  [0x3c2, "GREEK SMALL LETTER FINAL SIGMA"],
  [0x3dc, "GREEK LETTER DIGAMMA"], [0x3f4, "GREEK CAPITAL THETA SYMBOL"],
];

const CYRILLIC_NAMES = [
  "A", "BE", "VE", "GHE", "DE", "IE", "ZHE", "ZE", "I", "SHORT I", "KA",
  "EL", "EM", "EN", "O", "PE", "ER", "ES", "TE", "U", "EF", "HA", "TSE",
  "CHE", "SHA", "SHCHA", "HARD SIGN", "YERU", "SOFT SIGN", "E", "YU", "YA",
];
const CYRILLIC = [
  ...namedRange(0x410, CYRILLIC_NAMES, "CYRILLIC CAPITAL LETTER "),
  ...namedRange(0x430, CYRILLIC_NAMES, "CYRILLIC SMALL LETTER "),
  [0x400, "CYRILLIC CAPITAL LETTER IE WITH GRAVE"],
  [0x401, "CYRILLIC CAPITAL LETTER IO"],
  [0x450, "CYRILLIC SMALL LETTER IE WITH GRAVE"],
  [0x451, "CYRILLIC SMALL LETTER IO"],
];

const HEBREW_NAMES = [
  "ALEF", "BET", "GIMEL", "DALET", "HE", "VAV", "ZAYIN", "HET", "TET",
  "YOD", "FINAL KAF", "KAF", "LAMED", "FINAL MEM", "MEM", "FINAL NUN",
  "NUN", "SAMEKH", "AYIN", "FINAL PE", "PE", "FINAL TSADI", "TSADI", "QOF",
  "RESH", "SHIN", "TAV",
];
const HEBREW = [...namedRange(0x5d0, HEBREW_NAMES, "HEBREW LETTER "),
  [0x5b0, "HEBREW POINT SHEVA"], [0x5b1, "HEBREW POINT HATAF SEGOL"],
  [0x5b2, "HEBREW POINT SEGOL"], [0x5b4, "HEBREW POINT HOLAM"],
  [0x5b7, "HEBREW POINT QAMETS"], [0x5bc, "HEBREW POINT DAGESH OR MAPIQ"]];

const ARABIC_NAMES = [
  "ALEF", "BEH", "TEH", "THEH", "JEEM", "HAH", "KHAH", "DAL", "THAL",
  "RAH", "ZAIN", "SEEN", "SHEEN", "SAD", "DAD", "TAH", "ZAH", "AIN",
  "GHAIN", "FAH", "QAF", "KAF", "LAM", "MEEM", "NOON", "HEH", "WAW", "YEH",
];
const ARABIC = [
  ...namedRange(0x627, ARABIC_NAMES, "ARABIC LETTER "),
  ...namedRange(0x660, NUMBER_WORDS.slice(1, 10).map((word) => `ARABIC-INDIC DIGIT ${word}`)),
  [0x60c, "ARABIC COMMA"], [0x61b, "ARABIC SEMICOLON"],
  [0x61f, "ARABIC QUESTION MARK"],
];

const ARROWS = [
  [0x2190, "LEFTWARDS ARROW"], [0x2191, "UPWARDS ARROW"],
  [0x2192, "RIGHTWARDS ARROW"], [0x2193, "DOWNWARDS ARROW"],
  [0x2194, "LEFT RIGHT ARROW"], [0x2195, "UP DOWN ARROW"],
  [0x2196, "NORTH WEST ARROW"], [0x2197, "NORTH EAST ARROW"],
  [0x2198, "SOUTH EAST ARROW"], [0x2199, "SOUTH WEST ARROW"],
  [0x219a, "LEFTWARDS ARROW WITH STROKE"], [0x219b, "RIGHTWARDS ARROW WITH STROKE"],
  [0x219c, "LEFTWARDS WAVE ARROW"], [0x219d, "RIGHTWARDS WAVE ARROW"],
  [0x21a0, "RIGHTWARDS TWO HEADED ARROW"], [0x21a2, "LEFTWARDS ARROW WITH TAIL"],
  [0x21a3, "RIGHTWARDS ARROW WITH TAIL"], [0x21a6, "RIGHTWARDS ARROW FROM BAR"],
  [0x21a9, "LEFTWARDS ARROW WITH HOOK"], [0x21aa, "RIGHTWARDS ARROW WITH HOOK"],
  [0x21b0, "UPWARDS ARROW WITH TIP LEFTWARDS"],
  [0x21b1, "UPWARDS ARROW WITH TIP RIGHTWARDS"],
  [0x21b3, "DOWNWARDS ARROW WITH TIP RIGHTWARDS"],
  [0x21c4, "RIGHTWARDS ARROW OVER LEFTWARDS ARROW"],
  [0x21c5, "UPWARDS ARROW LEFTWARDS OF DOWNWARDS ARROW"],
  [0x21c6, "LEFTWARDS ARROW OVER RIGHTWARDS ARROW"],
  [0x21cb, "LEFTWARDS HARPOON OVER RIGHTWARDS HARPOON"],
  [0x21cc, "RIGHTWARDS HARPOON OVER LEFTWARDS HARPOON"],
  [0x21d0, "LEFTWARDS DOUBLE ARROW"], [0x21d1, "UPWARDS DOUBLE ARROW"],
  [0x21d2, "RIGHTWARDS DOUBLE ARROW"], [0x21d3, "DOWNWARDS DOUBLE ARROW"],
  [0x21d4, "LEFT RIGHT DOUBLE ARROW"], [0x21d5, "UP DOWN DOUBLE ARROW"],
  [0x21e0, "DASHED LEFTWARDS ARROW"], [0x21e2, "DASHED RIGHTWARDS ARROW"],
  [0x21e4, "LEFTWARDS ARROW TO BAR"], [0x21e5, "RIGHTWARDS ARROW TO BAR"],
];

const MATH = [
  [0x2200, "FOR ALL"], [0x2201, "COMPLEMENT"], [0x2202, "PARTIAL DIFFERENTIAL"],
  [0x2203, "THERE EXISTS"], [0x2204, "THERE DOES NOT EXIST"], [0x2205, "EMPTY SET"],
  [0x2206, "INCREMENT"], [0x2207, "NABLA"], [0x2208, "ELEMENT OF"],
  [0x2209, "NOT AN ELEMENT OF"], [0x220b, "CONTAINS AS MEMBER"],
  [0x220f, "N-ARY PRODUCT"], [0x2211, "N-ARY SUMMATION"],
  [0x2212, "MINUS SIGN"], [0x2213, "MINUS OR PLUS SIGN"],
  [0x2219, "BULLET OPERATOR"], [0x221a, "SQUARE ROOT"],
  [0x221d, "PROPORTIONAL TO"], [0x221e, "INFINITY"],
  [0x2223, "DIVIDES"], [0x2225, "PARALLEL TO"], [0x2220, "ANGLE"],
  [0x22a5, "UP TACK"], [0x2229, "INTERSECTION"], [0x222a, "UNION"],
  [0x2228, "LOGICAL OR"], [0x2227, "LOGICAL AND"],
  [0x2260, "NOT EQUAL TO"], [0x2261, "IDENTICAL TO"],
  [0x2245, "APPROXIMATELY EQUAL TO"], [0x2264, "LESS-THAN OR EQUAL TO"],
  [0x2265, "GREATER-THAN OR EQUAL TO"], [0x226a, "MUCH LESS-THAN"],
  [0x226b, "MUCH GREATER-THAN"], [0x2282, "SUBSET OF"],
  [0x2283, "SUPERSET OF"], [0x2286, "SUBSET OF OR EQUAL TO"],
  [0x2287, "SUPERSET OF OR EQUAL TO"], [0x2295, "CIRCLED PLUS"],
  [0x2297, "CIRCLED TIMES"], [0x2308, "LEFT CEILING"], [0x2309, "RIGHT CEILING"],
  [0x230a, "LEFT FLOOR"], [0x230b, "RIGHT FLOOR"],
];

const MISC_SYMBOLS = [
  [0x2600, "BLACK SUN WITH RAYS"], [0x2601, "CLOUD"], [0x2602, "UMBRELLA"],
  [0x2603, "SNOWMAN"], [0x2604, "COMET"], [0x260e, "BLACK TELEPHONE"],
  [0x260f, "WHITE TELEPHONE"], [0x2610, "BALLOT BOX"], [0x2611, "BALLOT BOX WITH CHECK"],
  [0x2612, "BALLOT BOX WITH X"], [0x2614, "UMBRELLA WITH RAIN DROPS"],
  [0x2615, "HOT BEVERAGE"], [0x2618, "SHAMROCK"], [0x2620, "SKULL AND CROSSBONES"],
  [0x2622, "RADIOACTIVE SIGN"], [0x2623, "BIOHAZARD SIGN"],
  [0x2626, "ORTHODOX CROSS"], [0x2627, "CHI RHO"], [0x2628, "CROSS OF LORRAINE"],
  [0x262a, "STAR AND CRESCENT"], [0x262e, "PEACE SIGN"],
  [0x2630, "TRIGRAM FOR HEAVEN"], [0x263a, "WHITE SMILING FACE"],
  [0x263b, "BLACK SMILING FACE"], [0x263c, "WHITE SUN WITH RAYS"],
  [0x263d, "CIRCLE WITH HORIZONTAL BAR"], [0x263e, "MOON PHASE"],
  [0x2640, "FEMALE SIGN"], [0x2642, "MALE SIGN"],
  [0x2660, "BLACK SPADE SUIT"], [0x2663, "BLACK CLUB SUIT"],
  [0x2665, "BLACK HEART SUIT"], [0x2666, "BLACK DIAMOND SUIT"],
  [0x2691, "BLACK FLAG"], [0x2693, "ANCHOR"], [0x2699, "GEAR"],
  [0x26a1, "HIGH VOLTAGE SIGN"], [0x26a2, "DOUBLED DAGGED PERCENT SIGN"],
  [0x26a3, "DIPPED PERCENT SIGN"], [0x26a4, "HORIZONTAL BAR WITH SLOWLY MOVING WATER"],
  [0x26aa, "MEDAL FOR FIRST PLACE"], [0x26ab, "MEDAL FOR SECOND PLACE"],
];

const DINGBATS = [
  ...namedRange(0x2701, [
    "UPPER BLADE SCISSORS", "BLACK SCISSORS", "LOWER BLADE SCISSORS",
    "STRAIGHT KNIFE", "CHECK MARK", "WHITE TELEPHONE", "ROTATED WHITE TELEPHONE",
    "AIRPLANE", "ENVELOPE", "FISTED HAND SIGN", "RAISED HAND WITH FINGERS SPLAYED",
    "VICTORY HAND", "WRITING HAND", "LOWER RIGHT PENCIL", "UPPER LEFT PENCIL",
    "LOWER LEFT PENCIL", "UPPER RIGHT PENCIL", "LATIN SMALL LETTER N",
    "BLACK PENCIL", "CHECK MARK WITH STEM", "HEAVY CHECK MARK",
    "HEAVY BALLOT X", "CIRCLED CHECK MARK", "BALLOT BOX WITH BOLD CHECK",
  ]),
  [0x271d, "LATIN CROSS"], [0x2720, "MALTESE CROSS"], [0x2728, "SPARKLES"],
  [0x2733, "EIGHT POINTED BLACK STAR"], [0x2740, "CIRCLED WHITE STAR"],
  [0x2744, "SNOWFLAKE"], [0x2747, "SPARKLE"], [0x274c, "CROSS MARK"],
  [0x274e, "NEGATIVE SQUARED CROSS MARK"], [0x2753, "BLACK QUESTION MARK ORNAMENT"],
  [0x2754, "WHITE QUESTION MARK ORNAMENT"], [0x2755, "WHITE EXCLAMATION MARK ORNAMENT"],
  [0x2757, "HEAVY EXCLAMATION MARK SYMBOL"],
  [0x2764, "HEAVY BLACK HEART"], [0x2795, "HEAVY PLUS SIGN"],
  [0x2796, "HEAVY MINUS SIGN"], [0x2797, "HEAVY DIVISION SIGN"],
  [0x27a1, "BLACK RIGHTWARDS ARROW"], [0x27b0, "CURLY LOOP"],
  [0x27bf, "DOUBLE CURLY LOOP"],
];

const EMOTICONS = [
  [0x1f600, "GRINNING FACE"], [0x1f601, "BEAMING FACE WITH SMILING EYES"],
  [0x1f602, "FACE WITH TEARS OF JOY"], [0x1f603, "SMILING FACE WITH OPEN MOUTH"],
  [0x1f604, "SMILING FACE WITH OPEN MOUTH AND SMILING EYES"],
  [0x1f605, "SMILING FACE WITH OPEN MOUTH AND COLD SWEAT"],
  [0x1f606, "SMILING FACE WITH OPEN MOUTH AND TIGHTLY-CLOSED EYES"],
  [0x1f609, "WINKING FACE"], [0x1f60a, "SMILING FACE WITH SMILING EYES"],
  [0x1f60b, "FACE SAVOURING DELICIOUS FOOD"],
  [0x1f60d, "SMILING FACE WITH HEART-SHAPED EYES"],
  [0x1f60e, "SMILING FACE WITH SUNGLASSES"],
  [0x1f610, "NEUTRAL FACE"], [0x1f612, "UNAMUSED FACE"],
  [0x1f613, "FACE WITH COLD SWEAT"], [0x1f614, "PENSIVE FACE"],
  [0x1f618, "FACE BLOWING A KISS"], [0x1f61a, "KISSING FACE WITH CLOSED EYES"],
  [0x1f61c, "FACE WITH STUCK-OUT TONGUE AND WINKING EYE"],
  [0x1f621, "ENRAGED FACE"], [0x1f622, "CRYING FACE"],
  [0x1f623, "PERSEVERING FACE"], [0x1f625, "DISAPPOINTED BUT RELIEVED FACE"],
  [0x1f628, "FEARFUL FACE"], [0x1f62d, "LOUDLY CRYING FACE"],
  [0x1f630, "FACE WITH OPEN MOUTH AND COLD SWEAT"],
  [0x1f631, "FACE SCREAMING IN FEAR"], [0x1f633, "FLUSHED FACE"],
  [0x1f634, "SLEEPING FACE"], [0x1f637, "FACE WITH MEDICAL MASK"],
  [0x1f60c, "RELIEVED FACE"], [0x1f620, "ANGRY FACE"],
  [0x1f641, "SLIGHTLY FROWNING FACE"], [0x1f642, "SLIGHTLY SMILING FACE"],
  [0x1f913, "NERD FACE"], [0x1f914, "THINKING FACE"],
  [0x1f917, "HUGGING FACE"],
  [0x1f44d, "THUMBS UP SIGN"], [0x1f44e, "THUMBS DOWN SIGN"],
  [0x1f44f, "CLAPPING HANDS SIGN"], [0x1f64c, "PERSON RAISING BOTH HANDS IN CELEBRATION"],
  [0x1f64f, "PERSON WITH FOLDED HANDS"],
];

const LETTERLIKE = [
  [0x2102, "DOUBLE-STRUCK CAPITAL C"], [0x2107, "EULER CONSTANT"],
  [0x210a, "SCRIPT SMALL G"], [0x210b, "SCRIPT CAPITAL H"],
  [0x210c, "BLACK-LETTER CAPITAL H"], [0x210d, "DOUBLE-STRUCK CAPITAL H"],
  [0x210e, "PLANCK CONSTANT OVER TWO PI"], [0x210f, "PLANCK CONSTANT"],
  [0x2110, "SCRIPT CAPITAL I"], [0x2111, "BLACK-LETTER CAPITAL I"],
  [0x2112, "SCRIPT CAPITAL L"], [0x2113, "SCRIPT SMALL L"],
  [0x2115, "DOUBLE-STRUCK CAPITAL N"], [0x2116, "NUMERO SIGN"],
  [0x2117, "SOUND RECORDING COPYRIGHT"], [0x2118, "SCRIPT CAPITAL P"],
  [0x2119, "DOUBLE-STRUCK CAPITAL P"], [0x211a, "DOUBLE-STRUCK CAPITAL Q"],
  [0x211b, "SCRIPT CAPITAL R"], [0x211c, "BLACK-LETTER CAPITAL R"],
  [0x211d, "DOUBLE-STRUCK CAPITAL R"], [0x2120, "SERVICE MARK"],
  [0x2121, "TELEPHONE SIGN"], [0x2122, "TRADE MARK SIGN"],
  [0x2124, "DOUBLE-STRUCK CAPITAL Z"], [0x2126, "OHM SIGN"],
  [0x2128, "BLACK-LETTER CAPITAL Z"], [0x212a, "KELVIN SIGN"],
  [0x212b, "ANGSTROM SIGN"], [0x2135, "ALEF SYMBOL"],
  [0x2136, "BET SYMBOL"], [0x2137, "GIMEL SYMBOL"], [0x2138, "DALET SYMBOL"],
];

const ENCLOSED = [
  ...namedRange(0x2460, NUMBER_WORDS.slice(1, 21).map((word) => `CIRCLED NUMBER ${word}`)),
  [0x24ea, "CIRCLED DIGIT ZERO"],
  ...namedRange(0x24b6, A_TO_Z.map((letter) => `CIRCLED LATIN CAPITAL LETTER ${letter}`)),
  ...namedRange(0x24d0, a_to_z.map((letter) => `CIRCLED LATIN SMALL LETTER ${letter}`)),
];

const CURRENCY = [
  [0x20a0, "EURO-CURRENCY SIGN"], [0x20a1, "COLON SIGN"],
  [0x20a2, "CRUZEIRO SIGN"], [0x20a3, "FRENCH FRANC SIGN"],
  [0x20a4, "LIRA SIGN"], [0x20a5, "MILL SIGN"], [0x20a6, "NAIRA SIGN"],
  [0x20a7, "PESETA SIGN"], [0x20a8, "RUPEE SIGN"], [0x20a9, "WON SIGN"],
  [0x20aa, "NEW SHEQEL SIGN"], [0x20ab, "DONG SIGN"], [0x20ac, "EURO SIGN"],
  [0x20ad, "KIP SIGN"], [0x20ae, "TUGRIK SIGN"], [0x20af, "DRACHMA SIGN"],
  [0x20b0, "GERMAN PENNY SIGN"], [0x20b1, "PESO SIGN"],
  [0x20b2, "GUARANI SIGN"], [0x20b3, "AUSTRAL SIGN"],
  [0x20b4, "HRYVNIA SIGN"], [0x20b5, "CEDI SIGN"],
  [0x20b6, "LIVRE TOURNOIS SIGN"], [0x20b7, "SPANISH PESETA SIGN"],
  [0x20b8, "TENGE SIGN"], [0x20b9, "INDIAN RUPEE SIGN"],
];

const CJK_PUNCTUATION = [
  [0x3000, "IDEOGRAPHIC SPACE"], [0x3001, "IDEOGRAPHIC COMMA"],
  [0x3002, "IDEOGRAPHIC FULL STOP"],
  [0x300c, "LEFT CORNER BRACKET"], [0x300d, "RIGHT CORNER BRACKET"],
  [0x300e, "LEFT WHITE CORNER BRACKET"], [0x300f, "RIGHT WHITE CORNER BRACKET"],
  [0x3010, "LEFT BLACK LENTICULAR BRACKET"],
  [0x3011, "RIGHT BLACK LENTICULAR BRACKET"],
  [0x300a, "LEFT DOUBLE ANGLE BRACKET"], [0x300b, "RIGHT DOUBLE ANGLE BRACKET"],
  [0x3006, "IDEOGRAPHIC CLOSING MARK"], [0x3007, "IDEOGRAPHIC NUMBER ZERO"],
  [0x3012, "POSTAL MARK"], [0x3013, "GETA MARK"],
];

const HIRAGANA_PAIRS = [
  [0x3042, "A"], [0x3044, "I"], [0x3046, "U"], [0x3048, "E"], [0x304a, "O"],
  [0x304b, "KA"], [0x304c, "KI"], [0x304d, "KU"], [0x304e, "KE"], [0x304f, "KO"],
  [0x3050, "SA"], [0x3051, "SHI"], [0x3052, "SU"], [0x3053, "SE"], [0x3054, "SO"],
  [0x3055, "TA"], [0x3056, "CHI"], [0x3057, "TSU"], [0x3058, "TE"], [0x3059, "TO"],
  [0x305a, "NA"], [0x305b, "NI"], [0x305c, "NU"], [0x305d, "NE"], [0x305e, "NO"],
  [0x305f, "HA"], [0x3060, "HI"], [0x3061, "FU"], [0x3062, "HE"], [0x3063, "HO"],
  [0x3064, "MA"], [0x3065, "MI"], [0x3066, "MU"], [0x3067, "ME"], [0x3068, "MO"],
  [0x3069, "YA"], [0x306b, "YU"], [0x306c, "YO"],
  [0x306d, "RA"], [0x306e, "RI"], [0x306f, "RU"], [0x3070, "RE"], [0x3071, "RO"],
  [0x3072, "WA"], [0x3073, "WO"], [0x3093, "N"],
];
const HIRAGANA = HIRAGANA_PAIRS.map(([code, roman]) =>
  [code, `HIRAGANA LETTER ${roman}`]);

const KATAKANA_PAIRS = [
  [0x30a2, "A"], [0x30a4, "I"], [0x30a6, "U"], [0x30a8, "E"], [0x30aa, "O"],
  [0x30ab, "KA"], [0x30ac, "KI"], [0x30ad, "KU"], [0x30ae, "KE"], [0x30af, "KO"],
  [0x30b0, "SA"], [0x30b1, "SHI"], [0x30b2, "SU"], [0x30b3, "SE"], [0x30b4, "SO"],
  [0x30b5, "TA"], [0x30b6, "CHI"], [0x30b7, "TSU"], [0x30b8, "TE"], [0x30b9, "TO"],
  [0x30ba, "NA"], [0x30bb, "NI"], [0x30bc, "NU"], [0x30bd, "NE"], [0x30be, "NO"],
  [0x30bf, "HA"], [0x30c0, "HI"], [0x30c1, "FU"], [0x30c2, "HE"], [0x30c3, "HO"],
  [0x30c4, "MA"], [0x30c5, "MI"], [0x30c6, "MU"], [0x30c7, "ME"], [0x30c8, "MO"],
  [0x30e4, "YA"], [0x30e6, "YU"], [0x30e7, "YO"],
  [0x30e8, "RA"], [0x30e9, "RI"], [0x30ea, "RU"], [0x30eb, "RE"], [0x30ec, "RO"],
  [0x30ef, "WA"], [0x30f2, "WO"], [0x30f3, "N"], [0x30f4, "VU"],
];
const KATAKANA = KATAKANA_PAIRS.map(([code, roman]) =>
  [code, `KATAKANA LETTER ${roman}`]);

const GEOMETRIC = [
  [0x25a0, "BLACK SQUARE"], [0x25a1, "WHITE SQUARE"],
  [0x25a2, "WHITE SQUARE WITH ROUNDED CORNERS"],
  [0x25a3, "WHITE SQUARE CONTAINING BLACK SMALL SQUARE"],
  [0x25a4, "SQUARE WITH HORIZONTAL FILL"], [0x25a5, "SQUARE WITH VERTICAL FILL"],
  [0x25a6, "SQUARE WITH ORTHOGONAL CROSSHATCH FILL"],
  [0x25a7, "SQUARE WITH UPPER LEFT TO LOWER RIGHT FILL"],
  [0x25a8, "SQUARE WITH UPPER RIGHT TO LOWER LEFT FILL"],
  [0x25a9, "SQUARE WITH DIAGONAL CROSSHATCH FILL"],
  [0x25aa, "BLACK SMALL SQUARE"], [0x25ab, "WHITE SMALL SQUARE"],
  [0x25ac, "BLACK RECTANGLE"], [0x25ad, "WHITE RECTANGLE"],
  [0x25ae, "BLACK VERTICAL RECTANGLE"], [0x25af, "WHITE VERTICAL RECTANGLE"],
  [0x25b0, "BLACK PARALLELOGRAM"], [0x25b1, "WHITE PARALLELOGRAM"],
  [0x25b2, "BLACK UP-POINTING TRIANGLE"], [0x25b3, "WHITE UP-POINTING TRIANGLE"],
  [0x25b4, "BLACK UP-POINTING SMALL TRIANGLE"],
  [0x25b5, "WHITE UP-POINTING SMALL TRIANGLE"],
  [0x25b6, "BLACK RIGHT-POINTING TRIANGLE"],
  [0x25b7, "WHITE RIGHT-POINTING TRIANGLE"],
  [0x25b8, "BLACK RIGHT-POINTING SMALL TRIANGLE"],
  [0x25b9, "WHITE RIGHT-POINTING SMALL TRIANGLE"],
  [0x25bc, "BLACK DOWN-POINTING TRIANGLE"], [0x25bd, "WHITE DOWN-POINTING TRIANGLE"],
  [0x25be, "BLACK DOWN-POINTING SMALL TRIANGLE"],
  [0x25c0, "BLACK LEFT-POINTING TRIANGLE"],
  [0x25c1, "WHITE LEFT-POINTING TRIANGLE"],
  [0x25c6, "BLACK DIAMOND"], [0x25c7, "WHITE DIAMOND"],
  [0x25cb, "WHITE CIRCLE"], [0x25cf, "BLACK CIRCLE"],
  [0x25ce, "BULLSEYE"], [0x25d0, "CIRCLE WITH LEFT HALF BLACK"],
  [0x25d1, "CIRCLE WITH RIGHT HALF BLACK"], [0x25d2, "CIRCLE WITH LOWER HALF BLACK"],
  [0x25d3, "CIRCLE WITH UPPER HALF BLACK"],
  [0x25e6, "WHITE BULLET"], [0x25ef, "LARGE CIRCLE"],
];

const BLOCK_DEFINITIONS = [
  ["basic-latin", "Basic Latin", "U+0021", "U+007E", BASIC_LATIN],
  ["latin-1", "Latin-1 Supplement", "U+00A1", "U+00F8", LATIN_1],
  ["greek", "Greek and Coptic", "U+0384", "U+03F4", GREEK],
  ["cyrillic", "Cyrillic", "U+0400", "U+0451", CYRILLIC],
  ["hebrew", "Hebrew", "U+05B0", "U+05EA", HEBREW],
  ["arabic", "Arabic", "U+060C", "U+0669", ARABIC],
  ["currency", "Currency Symbols", "U+20A0", "U+20B9", CURRENCY],
  ["letterlike", "Letterlike Symbols", "U+2102", "U+2138", LETTERLIKE],
  ["arrows", "Arrows", "U+2190", "U+21E5", ARROWS],
  ["math", "Mathematical Operators", "U+2200", "U+230B", MATH],
  ["geometric", "Geometric Shapes", "U+25A0", "U+25EF", GEOMETRIC],
  ["misc-symbols", "Miscellaneous Symbols", "U+2600", "U+26AB", MISC_SYMBOLS],
  ["dingbats", "Dingbats", "U+2701", "U+27BF", DINGBATS],
  ["enclosed", "Enclosed Alphanumerics", "U+2460", "U+24EA", ENCLOSED],
  ["cjk-punctuation", "CJK Symbols and Punctuation", "U+3000", "U+3013", CJK_PUNCTUATION],
  ["hiragana", "Hiragana", "U+3042", "U+3093", HIRAGANA],
  ["katakana", "Katakana", "U+30A2", "U+30F4", KATAKANA],
  ["emoticons", "Emoticons", "U+1F44D", "U+1F64F", EMOTICONS],
];

const ALL_GLYPHS = [];
const GLYPHS_BY_CODE = new Map();
const BLOCKS_BY_ID = new Map();
const GLYPHS_BY_BLOCK = new Map();

for (const [id, label, start, end, entries] of BLOCK_DEFINITIONS) {
  const seen = new Set();
  const glyphs = [];
  for (const [code, name] of entries) {
    if (seen.has(code)) continue;
    seen.add(code);
    const glyph = Object.freeze({
      code,
      char: String.fromCodePoint(code),
      name,
      hex: formatCode(code),
      blockId: id,
    });
    glyphs.push(glyph);
    if (!GLYPHS_BY_CODE.has(code)) GLYPHS_BY_CODE.set(code, glyph);
  }
  glyphs.sort((left, right) => left.code - right.code);
  const block = Object.freeze({
    id, label, range: `${start}\u2013${end}`,
    count: glyphs.length,
  });
  BLOCKS_BY_ID.set(id, block);
  GLYPHS_BY_BLOCK.set(id, Object.freeze(glyphs));
  ALL_GLYPHS.push(...glyphs);
}

const BLOCKS = Object.freeze(Array.from(BLOCKS_BY_ID.values()));
const BY_CODE = Object.freeze(GLYPHS_BY_CODE);

function listBlocks() {
  return BLOCKS;
}

function getBlock(id) {
  return typeof id === "string" && BLOCKS_BY_ID.has(id) ? BLOCKS_BY_ID.get(id) : null;
}

function glyphsInBlock(id) {
  return typeof id === "string" && GLYPHS_BY_BLOCK.has(id) ? GLYPHS_BY_BLOCK.get(id) : null;
}

function findByCode(code) {
  if (!Number.isInteger(code)) return null;
  return BY_CODE.get(code) || null;
}

function labelFor(glyph) {
  if (!glyph || typeof glyph.name !== "string" || typeof glyph.hex !== "string") {
    throw new TypeError("labelFor needs a catalog glyph");
  }
  return `${glyph.name}, ${glyph.hex}`;
}

/** Turn a codepoint-looking query into a number, or return null. */
function parseCodePoint(text) {
  let match = /^U\+([0-9A-Fa-f]{1,6})$/.exec(text);
  if (match) return parseInt(match[1], 16);
  match = /^(?:0x|#)([0-9A-Fa-f]{1,6})$/.exec(text);
  if (match) return parseInt(match[1], 16);
  match = /^([0-9]{1,7})$/.exec(text);
  if (match) return Number(match[1]);
  match = /^([0-9A-Fa-f]{4,6})$/.exec(text);
  if (match && /[A-Fa-f]/.test(match[1])) return parseInt(match[1], 16);
  const scalars = Array.from(text);
  if (scalars.length === 1) {
    const point = text.codePointAt(0);
    if (point >= 0x20 && point !== 0x7f && !(point >= 0xd800 && point <= 0xdfff)) return point;
  }
  return null;
}

function search(query) {
  if (typeof query !== "string") {
    throw new TypeError("Character search query must be a string");
  }
  const text = query.trim();
  if (text === "") {
    return Object.freeze({ query: "", results: Object.freeze([]), totalMatches: 0, truncated: false });
  }

  const needle = text.toLowerCase();
  const codePoint = parseCodePoint(text);
  const exact = codePoint === null ? null : findByCode(codePoint);
  const matches = [];
  const seen = new Set();
  const add = (glyph) => {
    if (!glyph || seen.has(glyph.code)) return;
    seen.add(glyph.code);
    matches.push(glyph);
  };

  add(exact);
  for (const glyph of ALL_GLYPHS) {
    if (glyph.name.toLowerCase().includes(needle) || glyph.hex.toLowerCase().includes(needle)) {
      add(glyph);
    }
  }

  const totalMatches = matches.length;
  const results = matches.slice(0, MAX_SEARCH_RESULTS);
  return Object.freeze({
    query: text,
    results: Object.freeze(results),
    totalMatches,
    truncated: totalMatches > results.length,
  });
}

export {
  formatCode,
  listBlocks,
  getBlock,
  glyphsInBlock,
  findByCode,
  labelFor,
  search,
};

export default {
  MAX_SEARCH_RESULTS, formatCode, listBlocks, getBlock, glyphsInBlock,
  findByCode, labelFor, search,
};
